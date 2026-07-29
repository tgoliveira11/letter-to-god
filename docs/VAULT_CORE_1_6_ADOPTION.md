# Account and vault passkey package adoption

This document is the SelahKeep-specific contract. Cryptographic behavior remains owned by the
published `@tgoliveira/vault-core` documentation.

## Package gate and migration

- Current published pins: `@tgoliveira/vault-core@1.6.1` and
  `@tgoliveira/secure-auth@0.8.0`.
- The source integration is validated against the release candidates for
  `@tgoliveira/vault-core@1.7.0` and `@tgoliveira/secure-auth@0.9.0`. Do not merge it with the old
  lockfile: update both exact pins and regenerate the lockfile only after both versions are
  published.
- `0021_vault_passkey_multi_device_variants.sql` remains the envelope/binding schema.
- `0023_secure_auth_passkey_counter_revision.sql` adds `passkey_credentials.counter_revision`
  (`integer NOT NULL DEFAULT 0`) for compare-and-set counter updates. It is additive and does not
  rewrite credential IDs, counters, public keys, envelopes, bindings, or ciphertext.

The application readiness check requires this column before secure-auth routes serve traffic. An
application rollback may leave it in place. Do not drop it in an automated rollback.

## Ownership boundary

| Concern | Owner |
|---|---|
| Account registration/login assertion sanitization, WebAuthn verification, login challenge, TOTP decision, authoritative counter CAS, login integration result/redirect | secure-auth |
| Vault-only WebAuthn challenges and verification, encrypted envelope persistence, browser-binding cookie, candidate ordering | SelahKeep |
| Public PRF input derivation, browser hydration/extraction/capability confirmation, candidate unwrap, compatibility repair crypto, session ownership | vault-core and vault-core/browser |
| Database transactions, routes, cookies, UI, production migration | SelahKeep |

Vault passwords, recovery phrases, PRF output, UVKs, and decrypted notes never cross an API. Account
login and vault unlock remain independently successful even when one credential has both
capabilities.

## Registration and reuse

Vault-only setup prepares `create()` options with
`prepareVaultPasskeyPrfRegistrationOptions()`. Registration establishes the credential and may
detect PRF capability, but its PRF output is never authoritative for a durable envelope.
`resolvePasskeyPrfEnrollmentAfterRegistration()` returns `authentication_required` with exact
credential selection. The app then runs one user-mediated `get()`, sanitizes the assertion before
server verification, confirms PRF capability against the verified credential ID, and only then
wraps, persists, locally matches, and binds the first variant.

In Account settings, **Also use the next passkey for vault unlock** is explicit, defaults off, and
is available only while the vault is open. secure-auth still owns account registration; its local
verified hook starts an exact authentication ceremony for the same credential. The app-owned route
mints a single-use persistence proof only after server verification of that assertion. If the user
cancels or this optional integration fails, the sign-in passkey remains valid and vault unlock can
be confirmed later from Vault settings.

New variants store `publicMetadata.prfCeremony = "authentication"`. The marker uses the existing
JSONB column, so vault-core 1.6.1 requires no database migration. Existing variants are preserved,
remain candidate-readable, and report `needsCompatibilityConfirmation` until the same credential
has at least one authentication-confirmed variant.

A vault-only credential can be promoted to account sign-in only through secure-auth 0.8.0's
exact-credential enable-sign-in route. No product route performs account verification or counter
updates.

## Unlock selection

- `intent: "explicit"` ignores the browser binding and requests the active vault credential
  allow-list. This is used by the full unlock page, settings Test, rebind, disable, and repair.
- The full unlock page consumes its mount-time explicit prefetch directly inside the passkey button
  gesture. It refreshes only when no snapshot exists, avoiding a network boundary before WebAuthn
  on Safari/PWA.
- `intent: "quick"` requires the current HttpOnly browser binding and exact credential selection.
  The dock never broadens this auto-start optimization.
- Stored WebAuthn transports are replayed. The app does not force `internal`.
- The server returns at most five encrypted variants for the verified credential. The browser
  confirms PRF capability against that exact ID, unwraps candidates locally, and persists
  `selectedEnvelopeVariantId` only after `status: "matched"`.

For a dual-capability credential, secure-auth's server-only
`getLoginAuthenticationExtensions({ userId, credentialIds })` callback checks that the resolved
allow-list contains a vault-enabled credential. It uses vault-core's
`buildPasskeyPrfAuthenticationExtensionsJson()` and may add only the public per-user PRF salt.
The account login options route remains a pure package delegate; no app route reparses or mutates
the response. The browser hook hydrates that JSON with the package API before SimpleWebAuthn starts
the ceremony.

On a browser with no local login hint, the user must enter their email before choosing passkey
login. The PRF salt is user-specific, so SelahKeep deliberately does not broaden this into an
unscoped username-less ceremony. This changes neither relying-party/domain canonicalization nor
credential IDs.

secure-auth sanitizes and verifies the assertion and owns the counter CAS. Only after the final
account session exists does the local hook receive the verified credential ID, load ciphertext
candidates for that exact ID, unwrap locally, and bind after `status: "matched"`. An account-only
credential completes normally. For a vault-enabled credential, missing PRF returns
`action_required/vault_prf_unavailable`; `no_match` returns
`action_required/vault_envelope_no_match`. Both keep account sign-in successful and route to
explicit `/vault/unlock` instead of silently leaving the expected vault bootstrap incomplete.
Malformed candidate state or a cryptographic/integration failure uses secure-auth's generic
post-login integration failure, never an account-auth rollback.

When TOTP is pending, secure-auth discards the first ceremony's extension results and does not run
the vault hook from the partial session or from TOTP completion. Account authentication remains
independent; the user unlocks the vault through the normal explicit flow afterward.

## Compatibility repair

`no_match` preserves all variants and leaves the vault locked. Adding a compatibility variant from
settings requires a local vault password or recovery phrase and calls
`createPasskeyPrfEnvelopeAfterIndependentAuthorization()`. A session UVK, WebAuthn assertion, or
browser binding alone is insufficient. Test or rebind `no_match` opens this guided confirmation for
the same logical credential. The independent secret is validated locally first; WebAuthn begins
only after the user submits and remains an explicit browser-mediated prompt. Persistence is
append-only, binding occurs only after local candidate match, and the active cap fails closed
without eviction. The flow is available while the vault is locked because it does not trust a
session UVK.

## Legacy AAD

`SELAHKEEP_VAULT_PROFILE` keeps `legacyVaultKeyUnlock: true` so existing envelopes whose
`aad.context` is missing or null remain readable. New writes use
`selahkeep:vault-envelope:v1`. No legacy context string allow-list is configured, so arbitrary
explicit contexts fail closed. Disable the fallback only after a measured migration confirms that
no active password, recovery, or passkey envelope still relies on missing/null context.

## Emergency / duress mode

vault-core 1.6.x ships Emergency / Duress Mode as opt-in and disabled by default. SelahKeep passes
`emergencyModeEnabled={false}` to both dock surfaces and exposes no emergency setup, unlock, banner,
or exit workflow. `VAULT_EMERGENCY_MODE_ENABLED=false` is documented explicitly. Changing the core
env/admin flag alone is not a supported SelahKeep activation: the app-owned decoy persistence,
server-state hydration, routing, and primary-recovery exit flow must first be implemented and pass a
dedicated security review.

## Acceptance checks

- All three enrollment entry points (recovery setup, vault settings, and account settings opt-in)
  require registration followed by exact authentication before wrap/persist/bind.
- Registration PRF may differ from authentication PRF and is never used for wrapping.
- Cancelling the confirmation or receiving no authentication PRF leaves the credential without a
  new vault envelope and provides a recoverable Vault settings path.
- Explicit unlock works without a browser cookie; quick unlock does not.
- A ready explicit prefetch is used before any refresh so its WebAuthn ceremony starts within the
  initiating user gesture.
- Missing/stale cookies never broaden quick selection.
- A synced credential can match any of its bounded variants without overwriting prior ciphertext.
- Compatibility repair rejects an incorrect password/recovery phrase and does not mutate variants.
- `no_match` guides the same credential into explicit compatibility confirmation; no WebAuthn
  ceremony starts silently or before user submission.
- Account registration/login work without vault opt-in or PRF support.
- A new browser with no hint requires an email to resolve the user-specific PRF salt, then can
  unlock a dual-capability credential on that first account-passkey ceremony without a binding.
- Dual-capability account login never sends PRF output, only unlocks after the final session, and
  returns a typed explicit-unlock action for PRF absence or `no_match`.
- Account-only passkeys complete normally when no vault candidates exist.
- TOTP accounts discard the first ceremony's PRF results and never run the vault hook from a
  partial session; vault unlock remains a later explicit ceremony.
- Counterless `0 -> 0` assertions still advance `counter_revision`; concurrent verification loses
  the CAS and fails closed.
- Legacy missing/null AAD remains readable; unknown explicit contexts fail closed.
- Emergency/duress controls are absent.
