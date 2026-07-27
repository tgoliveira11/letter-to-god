# Testing Rules

## Coverage gate (required)

- Run `npm run test:coverage` before completing any code change.
- **Minimum: 90%** lines, statements, functions, and branches on the scope defined in `vitest.config.ts`.
- Do not merge if thresholds fail. Add tests instead of lowering thresholds.

## Test layers

Place new tests in the correct folder:

| Layer | Path | Examples |
|-------|------|----------|
| Unit | `src/test/unit/` | AES-GCM, vault unlock, WebAuthn PRF prep, validation, API client |
| Security | `src/test/security/` | Plaintext rejection, schema, AAD, sentinel phrase, doc guards, no-letters |
| Services | `src/test/services/` | note/vault/passkey/admin services |
| API | `src/test/api/` | Route handlers (`/api/notes`, `/api/passkeys`, `/api/vault`, …) |
| Features | `src/test/features/` | passkey unlock, site layout, notes UI, navigation |

Use unit/service/API/feature tests for coverage. Browser E2E was removed; see `docs/TESTING_STRATEGY.md`.

## Required security tests

1. API rejects plaintext title/body on note create.
2. Database has no plaintext note title/body columns.
3. Admin APIs do not return plaintext note content.
4. Deleted notes soft-deleted (`deleted_at`); account deletion cascades vault/notes.
5. Account session alone does not unlock vault (`no-trusted-devices.test.ts`).
6. Recovery phrase never stored plaintext; legacy recovery codes hashed only.
7. Logs do not include private note content.
8. Note titles encrypted in metadata before storage.
9. Answered status in encrypted metadata/index only.
10. New-device unlock requires valid recovery method.
11. Frontend does not import database clients.
12. Note persistence goes through `/api/notes` only.
13. No active `letters` domain (`no-letters-domain.test.ts`).
14. Active docs reflect SelahKeep (`documentation-current-state.test.ts`).
15. Private async results are rejected after owner, vault epoch, resource, encrypted-key identity, or request-generation replacement.
16. Account A plaintext DOM is absent before account B renders.

### IndexedDB (when touching device storage or vault unlock)

- Device secret must be a **non-extractable** `CryptoKey`.
- Only **encrypted** vault envelopes may be persisted locally.
- Sign out must call `clearVaultClientState()`.
- See `src/test/security/indexeddb-storage.test.ts`.

### Passkey & recovery

- PRF never sent to API; passkey PRF vault unlock per ADR-006.
- Account passkey login owned by `@tgoliveira/secure-auth`.
- Recovery phrase: BIP39 client-only (ADR-005).

### Module boundaries

- `src/test/security/module-boundaries.test.ts`, `utility-module-boundaries.test.ts`
- `docs/MODULE_BOUNDARIES.md`

### Account auth (package-owned)

- Delegate route tests: `secure-auth-delegate-routes.test.ts`, `no-local-auth-implementation.test.ts`
- Do not add local auth service tests.

## Sentinel phrase test

Create note with: `SENTINEL-PRIVATE-LETTER-DO-NOT-STORE-PLAINTEXT-12345`

Verify phrase absent from: database, API responses, logs, admin endpoints.

## Documentation

When adding tests or changing coverage, update `README.md`, `AGENTS.md`, and `docs/TESTING_STRATEGY.md` as needed.
