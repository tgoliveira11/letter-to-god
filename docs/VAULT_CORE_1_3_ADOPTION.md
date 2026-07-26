# vault-core 1.3 adoption

SelahKeep depends on `@tgoliveira/vault-core@^1.3.0`. This document is the app-owned database, HTTP, and rollout contract that complements the package documentation (`PASSKEY_PRF_ENVELOPES.md`, `docs/MIGRATING_PASSKEYS_FROM_1_2_0.md`, and `docs/CONSUMER_SECURITY_REQUIREMENTS.md`).

## Ownership boundary

vault-core owns profile-bound crypto, PRF extraction/capability helpers, WebAuthn response sanitization, credential selection, candidate validation/unwrap, result types, and legacy vault-key AAD routing. SelahKeep owns PostgreSQL schema and transactions, WebAuthn challenge/origin/RP verification, credential rows and counters, cookies, opaque proofs, API authorization/rate limits, UI, and data migration.

PRF output, vault passwords, recovery phrases, UVKs, and decrypted payloads never leave the browser. WebAuthn responses must pass through `sanitizeWebAuthnResponseForServer()`; routes also reject nested `clientExtensionResults.prf`, `prfOutput`, and `prfHash` as defense in depth.

## Migration 0021

Run `npm run db:migrate` before deploying code that writes variants.

`0021_vault_passkey_multi_device_variants.sql`:

- adds authenticator backup/device metadata to `passkey_credentials`;
- adds `vault_envelopes.passkey_credential_id` and `vault_passkey_device_bindings.selected_envelope_variant_id`;
- removes the unique credential binding index so one logical synced credential can have several browser bindings;
- maps envelopes by `(user_id, public_metadata.credentialId)`;
- only when metadata is missing/null, maps an envelope if the user has exactly one active vault-enabled, non-revoked credential; ambiguous rows remain null rather than guessed;
- maps an existing binding to the oldest active matching variant;
- enforces that a selected variant belongs to the same credential with a composite foreign key;
- preserves envelope/binding IDs, ciphertext, AAD, PRF salt-derived data, timestamps, and public metadata byte-for-byte.

Do not normalize or rewrite stored legacy AAD during this migration. Take a database backup and record pre/post counts for active passkey envelopes, unmapped passkey envelopes, credentials, and bindings. A null `passkey_credential_id` after migration is a manual-review record, not permission to infer a credential at runtime.

## Runtime contracts

### Setup or append

1. Registering a credential stores no vault envelope and no browser binding.
2. Request authentication options for the exact credential; replay stored transports and never synthesize `internal`.
3. Send a sanitized assertion. The server verifies it and returns `verifiedCredentialId` plus an opaque, single-use enrollment proof.
4. The browser confirms authentication PRF capability for that verified ID, extracts PRF locally, wraps the in-memory UVK with canonical SelahKeep AAD, and sends only the encrypted envelope plus proof.
5. Under a credential row lock, the server checks the active cap (five), appends the variant, and never revokes/evicts an existing variant.
6. The browser locally unwraps the returned variant. Only `status: matched` permits the bind call and `selectedEnvelopeVariantId` persistence.

The same sequence is used by “Add compatibility variant” for an existing synced credential. It does not register a second credential.

### Unlock, test, and rebind

A missing binding cookie receives an explicit active credential allow-list. A valid cookie selects exactly its bound credential. A stale, unknown, or inactive binding fails with 409, clears the cookie, and requires explicit selection/rebind; it never silently widens to all credentials.

After WebAuthn verification, the server returns at most five encrypted variants for the verified credential, ordered with the bound selection first. The browser confirms capability and runs `unlockVaultFromPasskeyEnvelopeCandidates()`. `matched` may bind/update routing; `no_match`, malformed candidates, PRF unavailable, Test, and failed rebind cause no binding/selection mutation. WebAuthn counter and authenticator backup metadata updates remain expected server-side verification effects.

### Disable and unbind

“Unbind this browser” deletes only its routing row and cookie. Disable requires an opaque proof issued after WebAuthn verification plus the locally matched variant ID. Under the credential lock it revalidates the active variant, revokes every variant, deletes every binding, and either clears vault capability on a sign-in credential or revokes a vault-only credential. Any failure rolls the transaction back.

SelahKeep also exposes an app-owned bulk reset from unlocked `/vault/settings`. vault-core does not own credential persistence or account-passkey deletion, so the product service performs this transaction: lock every existing passkey credential in deterministic order, re-read vault capability after the locks, revoke vault-only credentials, clear only `vaultUnlockEnabled` on dual-purpose credentials, revoke all active `passkey_authorized_device` envelopes (including orphaned legacy rows), delete all browser bindings, and clear the routing cookie. Account-only credentials and account sign-in capability are never revoked. This reset does not process PRF output or plaintext vault material.

## AAD compatibility and sunset

New `vault_key` writes must use exactly `SELAHKEEP_VAULT_PROFILE.aadContextEnvelope`. The profile keeps `legacyVaultKeyUnlock: true` so previously shipped envelopes with missing or null `aad.context` remain readable through vault-core 1.3. No `legacyVaultKeyAadContexts` strings are configured, so arbitrary explicit contexts fail closed.

Disable legacy fallback only after telemetry/database audit shows no active envelope with missing/null context and every such envelope has been rewrapped client-side after a successful unlock. Never “fix” a legacy row by injecting context into persisted JSON: AES-GCM AAD is authenticated and mutation destroys access.

## Acceptance and rollout

Required automated coverage: PRF sanitization/rejection, stored transport preservation, stale cookie fail-closed behavior, exact credential verification, five-candidate cap, append without revoke, local no-match with zero routing mutation, multi-binding unbind, atomic all-variant disable, composite variant ownership, and byte-preserving migration guards.

Manual release matrix:

- Safari macOS and Safari iOS/iPadOS 18+;
- one synced credential used in two browsers/devices, including a compatibility append to the same credential;
- missing, stale, and inactive binding cookies;
- several variants where the first does not match and a later candidate matches;
- legacy missing/null AAD envelope, canonical envelope, and an arbitrary explicit context (must fail);
- non-extractable UVK with a valid vault-core inner-key memory cache, plus lock/cache-clear behavior;
- Test, failed rebind, unbind, dual-purpose disable, vault-only revoke, and bulk reset with mixed vault-only/dual-purpose credentials while account sign-in remains usable.

Roll out migration first, then application code. Keep vault password and recovery phrase available throughout. If app rollback is necessary, do not roll back or destructively remove the additive columns/index changes; older code must not create or replace passkey envelopes until compatibility is re-evaluated.
