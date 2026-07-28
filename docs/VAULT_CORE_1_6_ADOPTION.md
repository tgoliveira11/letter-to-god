# vault-core 1.6.0 and secure-auth 0.8.0 adoption

This document is the SelahKeep-specific contract. Cryptographic behavior remains owned by the
published `@tgoliveira/vault-core` documentation.

## Pinned packages and migration

- `@tgoliveira/vault-core@1.6.0`
- `@tgoliveira/secure-auth@0.8.0`
- `0021_vault_passkey_multi_device_variants.sql` remains the envelope/binding schema.
- `0023_secure_auth_passkey_counter_revision.sql` adds `passkey_credentials.counter_revision`
  (`integer NOT NULL DEFAULT 0`) for compare-and-set counter updates. It is additive and does not
  rewrite credential IDs, counters, public keys, envelopes, bindings, or ciphertext.

The application readiness check requires this column before secure-auth routes serve traffic. An
application rollback may leave it in place. Do not drop it in an automated rollback.

## Ownership boundary

| Concern | Owner |
|---|---|
| Account registration/login assertion sanitization, WebAuthn verification, login challenge, TOTP decision, authoritative counter CAS | secure-auth |
| Vault-only WebAuthn challenges and verification, encrypted envelope persistence, browser-binding cookie, candidate ordering | SelahKeep |
| PRF preparation/extraction/capability confirmation, candidate unwrap, compatibility repair crypto, session ownership | vault-core/browser in the SelahKeep client |
| Database transactions, routes, cookies, UI, production migration | SelahKeep |

Vault passwords, recovery phrases, PRF output, UVKs, and decrypted notes never cross an API. Account
login and vault unlock remain independently successful even when one credential has both
capabilities.

## Registration and reuse

Vault-only setup prepares `create()` options with
`prepareVaultPasskeyPrfRegistrationOptions()`. When registration returns PRF output,
`resolvePasskeyPrfEnrollmentAfterRegistration()` produces `status: "ready"` and the app persists
the first variant from the same user gesture. This is the normal one-prompt path. Only typed
`authentication_required` falls back to a second `get()` ceremony.

In Account settings, **Also use the next passkey for vault unlock** is explicit, defaults off, and
is available only while the vault is open. secure-auth still owns account registration; its local
verified hook uses the same registration PRF output and a short-lived HttpOnly app receipt to append
the ciphertext envelope. If this optional integration fails, the sign-in passkey remains valid.

A vault-only credential can be promoted to account sign-in only through secure-auth 0.8.0's
exact-credential enable-sign-in route. No product route performs account verification or counter
updates.

## Unlock selection

- `intent: "explicit"` ignores the browser binding and requests the active vault credential
  allow-list. This is used by the full unlock page, settings Test, rebind, disable, and repair.
- `intent: "quick"` requires the current HttpOnly browser binding and exact credential selection.
  The dock never broadens this auto-start optimization.
- Stored WebAuthn transports are replayed. The app does not force `internal`.
- The server returns at most five encrypted variants for the verified credential. The browser
  confirms PRF capability against that exact ID, unwraps candidates locally, and persists
  `selectedEnvelopeVariantId` only after `status: "matched"`.

For a dual-capability credential, account login options may include only the public vault PRF salt.
secure-auth sanitizes and verifies the assertion and owns the counter CAS. After the final account
session exists, the local hook may load ciphertext candidates, unwrap, and bind. It does not run
before TOTP. PRF absence or `no_match` never fails account login.

## Compatibility repair

`no_match` preserves all variants and leaves the vault locked. Adding a compatibility variant from
settings requires a local vault password or recovery phrase and calls
`createPasskeyPrfEnvelopeAfterIndependentAuthorization()`. A session UVK, WebAuthn assertion, or
browser binding alone is insufficient. Persistence is append-only and the active cap fails closed
without eviction.

## Legacy AAD

`SELAHKEEP_VAULT_PROFILE` keeps `legacyVaultKeyUnlock: true` so existing envelopes whose
`aad.context` is missing or null remain readable. New writes use
`selahkeep:vault-envelope:v1`. No legacy context string allow-list is configured, so arbitrary
explicit contexts fail closed. Disable the fallback only after a measured migration confirms that
no active password, recovery, or passkey envelope still relies on missing/null context.

## Emergency / duress mode

vault-core 1.6.0 ships Emergency / Duress Mode as opt-in and disabled by default. SelahKeep passes
`emergencyModeEnabled={false}` to both dock surfaces and exposes no emergency setup, unlock, banner,
or exit workflow. `VAULT_EMERGENCY_MODE_ENABLED=false` is documented explicitly. Changing the core
env/admin flag alone is not a supported SelahKeep activation: the app-owned decoy persistence,
server-state hydration, routing, and primary-recovery exit flow must first be implemented and pass a
dedicated security review.

## Acceptance checks

- Registration-time PRF uses one prompt; typed fallback uses two only when required.
- Explicit unlock works without a browser cookie; quick unlock does not.
- Missing/stale cookies never broaden quick selection.
- A synced credential can match any of its bounded variants without overwriting prior ciphertext.
- Compatibility repair rejects an incorrect password/recovery phrase and does not mutate variants.
- Account registration/login work without vault opt-in or PRF support.
- Dual-capability account login never sends PRF output and only unlocks after the final session.
- TOTP accounts never run the vault hook from a partial session.
- Counterless `0 -> 0` assertions still advance `counter_revision`; concurrent verification loses
  the CAS and fails closed.
- Legacy missing/null AAD remains readable; unknown explicit contexts fail closed.
- Emergency/duress controls are absent.
