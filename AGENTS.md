# Agent Rules — SelahKeep MVP

> Former working name: LTG Vault. Current product name: SelahKeep.

## Source of Truth

Read and follow these documents before implementing:

- `docs/TDR_LTG_Vault_MVP.md` — foundational product direction; its passkey sections are historical
- `docs/PORTABLE_PASSKEY_VAULT.md` — **current passkey vault architecture and rollout source of truth**
- `docs/TDR_DETERMINISTIC_APPLICATION_STATE.md` — bootstrap, account boundary, vault lease, and async ownership contract
- `docs/LTG_VAULT_IMPLEMENTATION_PLAN.md` — historical phased plan (Phases 0–5 complete)
- `docs/ADR-005_LTG_Vault_Cryptography_Argon2id_Recovery_Phrase_Note_Keys.md` — vault crypto, note keys, recovery phrase
- `docs/archive/ADR-006_LTG_Vault_Passkey_PRF_Unlock.md` — superseded legacy PRF design; compatibility reads only
- `docs/MODULE_BOUNDARIES.md`
- `docs/AUTH_RESET_TO_SECURE_AUTH.md` — auth boundary (`@tgoliveira/secure-auth`)
- `docs/README.md` — documentation index

## Core Rule

**Never implement a backend path that receives or stores plaintext private note title/body/metadata.**

Note title, body, categories, and tags must be encrypted on the client before any API request.

## Architecture Boundary

```text
React UI
  -> Crypto Client Layer
  -> API Client
  -> API Route
  -> Service Layer
  -> Repository Layer
  -> PostgreSQL
```

Only the **Crypto Client Layer** may handle plaintext note title/body.

**Account authentication** is owned by `@tgoliveira/secure-auth` — do not reimplement login, OAuth, passkey account login, TOTP, sessions, or password flows locally.

React components must NOT import database clients, repositories, or ORM code.

## Deterministic private state

Follow `docs/TDR_DETERMINISTIC_APPLICATION_STATE.md` for every private async flow:

- Seed account ownership from the server bootstrap; do not reconstruct package UI/auth configuration on the client.
- On logout or owner replacement, hide prior-owner UI, synchronously clear private state, and invalidate the vault owner before refresh.
- Key-bearing work requires a current vault-core lease. Async results also require the same owner, lease epoch, resource, encrypted-key fingerprint (when applicable), and latest request generation before any UI/cache/persistence commit.
- Render `pending`, `error`, and `empty` distinctly; never infer empty from unresolved or failed work.

## Forbidden

- Plaintext `title`, `body`, `content`, `message`, `markdown` fields for notes on APIs
- Reintroducing active `letters` routes, APIs, modules, schema, or UI (`/letters`, `/api/letters`, `letters` table)
- Server Actions for private note persistence
- Frontend direct database access
- localStorage/sessionStorage/cookies for plaintext keys or note content
- Persisting raw/exportable key material in IndexedDB (store only AES-GCM ciphertext; never raw keys). Note: the in-memory session UVK and per-note keys are `extractable` by necessity (to wrap/unwrap note keys) — this is an accepted residual risk mitigated by CSP, not a license to persist raw keys
- Mock encryption, fake passkey flows, fake recovery flows
- AI APIs processing private note content
- Admin access to private note content
- Using TOTP 2FA, backup codes, or account login secrets as vault keys, note keys, or vault unlock material
- PBKDF2 fallback for **new** vault password or recovery phrase KDF paths (Argon2id only per ADR-005)
- Password reset or change flows that unlock, recover, or rotate the vault
- Confusing account sessions with vault unlock; account session does not decrypt notes
- Competing local auth/account implementation (see `no-local-auth-implementation.test.ts`)

## Design system (UI work)

The adopted visual language is **"Stillness"** — see [`docs/DESIGN_SYSTEM.md`](docs/DESIGN_SYSTEM.md) (source specs in [`docs/design/`](docs/design/)).

- **Style with design tokens only** (`src/app/globals.css`) — never hardcode hex. Every new surface must work in **light and dark** (`prefers-color-scheme`).
- Typeface is **Schibsted Grotesk** via `next/font` (`--font-sans`); headings use tight tracking.
- **Chips are outlined** (category = `--border-2`/`--primary`; tag = `--border`/`--accent`), not filled. Primary buttons use `--primary-solid`/`--on-primary`; links/icons use `--primary`. Semantic colors stay semantic.
- Reuse the canonical components/patterns (note card, vault dock, locked state, version diff, dictate panel, empty/loading/error). For screens **not** in the hero specs, **infer from the tokens and patterns** — do not invent a new language.
- Keep account sign-in vs vault unlock visually separate; no crypto jargon in copy.

## Stop Conditions

If cryptographic primitive, passkey key-wrapping, or recovery envelope design is unclear:

```text
TODO_SECURITY_REVIEW_REQUIRED:
This implementation is incomplete and must not be used in production.
```

## Documentation (required on every change)

Keep docs accurate with the code. **Do not merge behavior changes without updating the relevant docs.**

| When you change… | Update… |
|------------------|---------|
| Setup, commands, ports, env vars | `README.md` |
| Layers, directories, data flow | `ARCHITECTURE.md`, `docs/MODULE_BOUNDARIES.md` |
| Crypto, vault, passkeys, recovery | `SECURITY.md`, ADR-005, `docs/PORTABLE_PASSKEY_VAULT.md` |
| Agent workflow, testing, boundaries | `AGENTS.md`, `.cursor/rules/*.md`, `docs/contributing.md` |
| Navigation / branding | `docs/LOGGED_IN_NAVIGATION_AUDIT.md`, `docs/UI_UX_DIRECTION.md` |
| Visual language / tokens / components / dark mode | `docs/DESIGN_SYSTEM.md`, `docs/design/` |
| New API routes or contracts | `docs/API_REFERENCE.md`, `ARCHITECTURE.md`, `docs/CURRENT_PRODUCT_SURFACE.md` |

## Branch, PR, and releases

Follow **`docs/contributing.md`** and **`.cursor/rules/branch-pr-release.mdc`**:

- Work on `feature/`, `fix/`, `docs/`, or `chore/` branches — not directly on `main`.
- Run **`npm run validate`** before finishing code changes (unless trivial docs-only).
- Update **`CHANGELOG.md`** (`## [Unreleased]`) and **`docs/CURRENT_PRODUCT_SURFACE.md`** when applicable.
- Do **not** open PRs, merge, push to `main`, or run the release workflow unless explicitly asked.

Releases are **manual only** (`workflow_dispatch`). Invariant: `package.json` version ⟺ tag `vX.Y.Z` ⟺ GitHub Release. See **`docs/releasing.md`**.

## Testing (required on every change)

**Minimum coverage: 90%** for enforced scope (see `vitest.config.ts`).

Before finishing any task:

```bash
npm run validate
```

(`validate` runs `lint`, `typecheck`, `test:coverage`, and `build`. Equivalent to the steps below.)

```bash
npm ci
npm run lint
npm run test:coverage
npm run build
```

### Test layers

| Layer | Location | Use for |
|-------|----------|---------|
| Unit | `src/test/unit/` | Pure helpers, crypto, validation |
| Security | `src/test/security/` | Plaintext rejection, boundaries, sentinel, doc guards |
| Services | `src/test/services/` | Business logic with mocked repositories |
| API routes | `src/test/api/` | Route handlers with mocked auth + services |
| Features | `src/test/features/` | Client flows (passkey unlock, nav, notes UI) |

Browser E2E (Playwright) was removed; see `docs/TESTING_STRATEGY.md`.

### Security tests (always required)

Sentinel phrase: `SENTINEL-PRIVATE-LETTER-DO-NOT-STORE-PLAINTEXT-12345` — must never appear in database records, API responses, logs, or admin endpoints.

Also maintain: `no-letters-domain.test.ts`, `no-local-auth-implementation.test.ts`, `documentation-current-state.test.ts`.
