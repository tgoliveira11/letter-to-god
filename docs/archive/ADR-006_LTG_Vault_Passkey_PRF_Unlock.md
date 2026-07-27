> **⚠️ ARCHIVED — obsolete (2026-07-03).** Superseded by `@tgoliveira/vault-core` as the single source of truth for vault and passkey PRF unlock behavior. See the package's `README.md`, `docs/IMPLEMENTATION_GUIDE.md`, and `PASSKEY_PRF_ENVELOPES.md`. Kept for historical context only — do not use for current implementation guidance.

> Current SelahKeep ceremonies are owner-operation and lease scoped under `@tgoliveira/vault-core@1.5.1`; see [`../TDR_DETERMINISTIC_APPLICATION_STATE.md`](../TDR_DETERMINISTIC_APPLICATION_STATE.md). This note does not reactivate the archived design.

---

# ADR-006 — SelahKeep Passkey PRF Unlock

| Field | Value |
|-------|--------|
| **Status** | Accepted |
| **Date** | 2026-06-17 |
| **Related** | ADR-002, ADR-005, `docs/TDR_LTG_Vault_MVP.md`, Phase 4 |

---

## 1. Passkey account authentication vs passkey vault unlock

| Operation | Owner | Purpose |
|-----------|-------|---------|
| Account passkey sign-in | `@tgoliveira/secure-auth` | Establishes account session only |
| Passkey vault unlock | SelahKeep product layer | Unwraps User Vault Key via PRF-based envelope |

The same physical passkey credential may perform both only when the user has explicitly enabled vault unlock and a valid `passkey_prf` envelope exists.

## 2. Why account login alone cannot unlock the vault

Account sessions prove identity to the server. They do not carry the User Vault Key or PRF output. Vault decryption remains client-side and requires a separate unlock method (vault password, recovery phrase, or passkey PRF envelope).

## 3. PRF-based envelope format

Envelope type: `passkey_authorized_device` (legacy method name) with `publicMetadata`:

```json
{
  "credentialId": "<webauthn-credential-id>",
  "prfRequired": true
}
```

`encryptedVaultKey` is AES-GCM over exported UVK bytes, keyed by PRF-derived AES-256 key. AAD includes `userId` and `resourceId` per ADR-001.

## 4. How PRF output is obtained client-side

During WebAuthn authentication or registration, the client requests the `prf` extension (`src/lib/passkey/prf.ts`). `extractPasskeyPrfOutput()` reads `clientExtensionResults.prf.results.first` (≥32 bytes). PRF is evaluated by the authenticator; the server never receives PRF bytes.

## 5. How PRF output wraps/unwraps the User Vault Key

1. Import first 32 PRF bytes as AES-256-GCM key (`importPrfAsAesKey`).
2. Encrypt exported UVK with that key → `encryptedVaultKey`.
3. On unlock, decrypt `encryptedVaultKey` with the same PRF output → import UVK → `unlockVaultSession`.

Implementation: `src/modules/vault/core/envelopes/passkey-prf-envelope.ts` (re-exported from `src/lib/crypto-client/passkey-vault.ts`). PRF salt prefix: `letters-passkey-prf-v1:` (`src/modules/vault/selahkeep-profile.ts`).

## 6. Credential / envelope matching

After account passkey verify, the product looks up:

1. `credentialId` from verify response
2. `passkey_credentials` row: `signInEnabled` + `vaultUnlockEnabled`
3. Active envelope where `publicMetadata.credentialId` matches

Lookup for pre-session flows uses package-issued `loginToken` via `login-token-repository` (read-only).

Vault-only passkeys use a deterministic opaque WebAuthn user handle derived specifically for the
vault credential, distinct from the account passkey user handle. This is required for Apple
platform authenticators, which replace an existing device passkey when a new credential is
registered for the same RP ID and user handle. The derived handle contains no email or plaintext
note data and is used only during vault-passkey registration.

## 7. Server-side storage

| Store | Fields |
|-------|--------|
| `passkey_credentials` | `vault_unlock_enabled`, `prf_supported`, `credential_id` |
| `vault_unlock_envelopes` | `method`, `encrypted_vault_key`, `public_metadata`, `revoked_at` |

## 8. Must never be stored or sent server-side

PRF output, User Vault Key, note keys, vault password, recovery phrase, plaintext note fields, WebAuthn signatures used as encryption keys.

API routes reject `prfOutput`, `userVaultKey`, `noteKey`, `vaultPassword`, `recoveryPhrase`, and generic plaintext note fields.

## 9. PRF unavailable

No `passkey_prf` envelope is created. UI shows calm fallback copy. Post-login: user is signed in; vault stays locked.

## 10. Passkey without vault envelope

Account sign-in succeeds. Vault remains locked. User is directed to `/vault/unlock` with messaging that the passkey is not set up for vault unlock.

## 11. Explicit post-login vault unlock

Account passkey login and vault unlock are two distinct user actions:

1. `@tgoliveira/secure-auth` authenticates the account and establishes the session.
2. The vault remains locked.
3. The signed-in user chooses **Unlock with passkey** from `/vault/unlock` or the vault dock.
4. `POST /api/passkeys/authenticate` runs a product-owned PRF ceremony.
5. The client unwraps the User Vault Key only after that explicit ceremony succeeds.

SelahKeep does not alias the package passkey login client, enrich account-login options with vault
PRF inputs, or expose login-token-gated vault metadata/options routes.

## 12. Fallback UX

| Case | Message theme |
|------|----------------|
| No envelope | Explicit unlock reports that the passkey is not set up for the vault |
| PRF unavailable | Explicit unlock reports that the browser/provider cannot unlock the vault |
| Decrypt failure | Use vault password or recovery phrase |

Copy is kept in `src/lib/passkey/messages.ts`; account login stores no vault outcome.

## 13. Browser / provider limitations

`detectPasskeyPrfSupport()` and `passkey-prf-diagnostics.ts` gate envelope creation. Pre-ceremony `getClientCapabilities()["extension:prf"]` is a hint only — **`unknown` does not block setup**. Post-ceremony `clientExtensionResults.prf` is authoritative. Safari and some providers may lack PRF — fail closed, no fake envelopes. See `docs/PASSKEY_VAULT_UNLOCK_DIAGNOSTIC_AUDIT.md`.

## 14. Vault settings UX

Primary passkey vault unlock management: `/vault/settings` (`PasskeyVaultUnlockSetup`). States: not configured, configured, unsupported (with diagnostic reason), unknown capability (try allowed). CTAs: Set up, Test, Replace, Disable.

## 15. Tests proving auth / vault separation

- `passkey-login-vault-unlock.test.ts` — package login delegation and explicit vault boundary
- `unlock-with-passkey.test.ts` — explicit signed-in PRF unlock
- `passkey-login-boundary.test.ts` — sign-in vs vault capability labels
- Security: PRF/UVK never in API payloads (`passkey-vault-plaintext-rejection.test.ts`)
- PRF diagnostics: `src/test/unit/passkey-prf-diagnostics.test.ts`, `src/test/features/passkey-vault-unlock-settings.test.tsx`

---

## Security review

Passkey PRF vault unlock implementation requires human security review before production (`SECURITY.md`).
