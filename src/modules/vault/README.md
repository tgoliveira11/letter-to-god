# SelahKeep Vault Module

Product-owned vault layer. Account authentication (`@tgoliveira/secure-auth`) and vault unlock are **separate**.

## Structure

- `@tgoliveira/vault-core` — reusable crypto and envelope primitives (no app session state)
- `src/lib/crypto-client/vault-session.ts` — SelahKeep in-memory UVK + lock/auto-lock controller
- `src/lib/crypto-client/vault-passkey-browser.ts` — approved adapter for vault-core browser PRF helpers
- `selahkeep-profile.ts` — frozen SelahKeep AAD/PRF compatibility constants
- `core/` — profile-bound envelope wrappers
- `client/` — browser session extensions (auto-lock draft flush, note cache clear), passkey PRF salt
- `services/` — encrypted persistence (server)
- `components/` — vault UI fragments

## Boundaries

- Vault crypto does **not** live in secure-auth
- Server never receives vault password, recovery phrase, UVK, PRF output, or decrypted note content
- Decrypted vault state stays in memory only (no localStorage/IndexedDB for keys or note plaintext)

## Dependency

```json
"@tgoliveira/vault-core": "^1.3.0"
```

Note encryption (title/body/metadata) remains in `src/lib/crypto-client/` — product-specific AAD fields beyond vault-core `VaultAadField`.

## UX

- Inline vault setup and unlock on `/notes` via **Vault Status Dock** (primary)
- Full-page `/vault/*` routes remain for setup, unlock, recovery, settings, and security review

## Legacy compatibility

- PRF salt prefix: `letters-passkey-prf-v1:` (unchanged)
- New vault-key envelopes require the exact canonical SelahKeep context. The 1.3 router temporarily accepts legacy missing/null context; arbitrary explicit legacy strings are not allowlisted.
- PRF output never leaves the browser. Candidate unwrap and `selectedEnvelopeVariantId` selection happen locally.
