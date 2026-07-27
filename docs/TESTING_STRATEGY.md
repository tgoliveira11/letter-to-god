# Testing Strategy

Last updated: 2026-07-27

## Overview

All automated tests run through **Vitest** (`npm run test`, `npm run test:coverage`). Browser **E2E tests (Playwright) were removed** — they previously lived under `e2e/` and are no longer part of CI or local workflows.

`npm run test:all` is an alias for `npm run test:coverage`.

## Vitest projects (environment split)

`vitest.config.ts` defines two projects so pure logic tests do not pay DOM startup cost:

| Project | Environment | Includes |
|---------|-------------|----------|
| **unit** | `node` | `src/**/*.test.ts` |
| **ui** | `happy-dom` | `src/**/*.test.tsx` |

A small number of `.test.ts` files that need DOM APIs keep a file-level directive:

```ts
/** @vitest-environment happy-dom */
```

Heavy SDK imports are pre-bundled via `test.deps.optimizer.ssr` (`@tgoliveira/secure-auth`, `@tgoliveira/vault-core`, `hash-wasm`).

## Shared vault crypto fixtures

Repeated Argon2/KDF work in vault tests uses lazy singleton fixtures in `src/test/helpers/vault-crypto-fixtures.ts`:

- `loadPasswordVaultFixture()` — one password envelope per worker
- `loadRecoveryPhraseVaultFixture()` — one recovery-phrase envelope per worker

Use these for read-only unwrap/drill assertions; create fresh envelopes when a test mutates state or needs a unique key.

**Avoid** combining `vi.useFakeTimers()` with a full `NotesPage` render — vault/list effects schedule real timers and can loop until the worker OOMs (`editor-track-2.test.tsx` was rewritten to test `NewNoteAction` / `findDailyNoteIdForDate` instead).

## Coverage gate

- **Minimum: 90%** lines, statements, functions, and branches on enforced scope (`vitest.config.ts`).
- Run `npm run validate` before merging (`lint`, `typecheck`, `test:coverage`, `build`).

## CI pipeline

GitHub Actions (`.github/workflows/ci.yml`) runs **parallel jobs** so wall clock ≈ the slowest step, not the sum:

| Job | Command |
|-----|---------|
| `lint` | `npm run lint` (ESLint cache in `.eslintcache`) |
| `typecheck` | `npm run typecheck` (`tsc --noEmit -p tsconfig.ci.json`, app code only; incremental cache in `.cache/tsconfig.tsbuildinfo`) |
| `test` | `npm run test:coverage` (`NODE_OPTIONS=--max-old-space-size=8192`) |
| `build` | `npm run build` |

PR branches must use the `feature/`, `fix/`, `docs/`, or `chore/` prefix (`branch-name` job).

## Test layers

| Layer | Location | Purpose |
|-------|----------|---------|
| **Unit** | `src/test/unit/` | Pure helpers, crypto, validation, clients, env |
| **Security** | `src/test/security/` | Plaintext rejection, boundaries, sentinel phrase, module guards |
| **Services** | `src/test/services/` | Business logic with mocked repositories |
| **API** | `src/test/api/` | Route handlers with mocked auth + services |
| **Features** | `src/test/features/` | Client flows (passkey unlock, layout shell, UI pages, accessibility) |

Repository adapters and most page components are covered indirectly via service/API/feature tests unless a change adds testable logic in those layers.

## Layout and shell tests

`src/test/features/site-layout.test.tsx` verifies:

- Public home renders header navigation and footer inside `SiteShell`
- Footer attribution text, URL, `target="_blank"`, and `rel="noopener noreferrer"`
- Auth package login still renders within the shell
- Mobile menu accessible name when signed in
- `package.json` has no removed E2E scripts

`src/test/features/accessibility.test.tsx` runs axe on the landing page with `SiteShell`.

## Security tests

Deterministic application-state changes must cover account replacement DOM hygiene and stale async settlement after owner, vault epoch, resource, encrypted-key identity, or request-generation changes. See [`TDR_DETERMINISTIC_APPLICATION_STATE.md`](./TDR_DETERMINISTIC_APPLICATION_STATE.md).

See `.cursor/rules/testing.md` for the full checklist (sentinel phrase, IndexedDB, passkeys, account sessions, 2FA, etc.).

Sentinel phrase: `SENTINEL-PRIVATE-LETTER-DO-NOT-STORE-PLAINTEXT-12345` must never appear in database records, API responses, logs, or admin endpoints.

## What was removed

| Item | Notes |
|------|-------|
| `e2e/` directory | Playwright specs and helpers |
| `playwright.config.ts` | Playwright configuration |
| `test:e2e`, `test:e2e:ui` scripts | Removed from `package.json` |
| `@playwright/test` dependency | Removed from devDependencies |

Vitest, Testing Library, jest-axe, and happy-dom remain in use.

## Local commands

```bash
npm ci
npm run validate
# or step-by-step:
npm run lint
npm run typecheck
npm run test
npm run test:coverage
npm run build
```
