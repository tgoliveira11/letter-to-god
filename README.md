# SelahKeep — Private Encrypted Notes MVP

> **Product:** **SelahKeep** — a private encrypted space for prayers, reflections, and notes. Former working name: LTG Vault. Primary UI accent: **purple** (`docs/UI_UX_DIRECTION.md`). Vault setup: `/vault/setup` (vault password + BIP39 recovery phrase). See [`docs/TDR_LTG_Vault_MVP.md`](./docs/TDR_LTG_Vault_MVP.md), [`docs/LTG_VAULT_IMPLEMENTATION_PLAN.md`](./docs/LTG_VAULT_IMPLEMENTATION_PLAN.md), and [`CHANGELOG.md`](./CHANGELOG.md).

Web-first responsive MVP for private encrypted notes in a personal vault.

## Privacy Promise

> Your private notes are protected on your device before they are saved. Our systems are designed so our team does not have access to the keys required to read them.

## Stack

- Next.js + TypeScript + React
- PostgreSQL + Drizzle ORM
- **Account authentication:** [`@tgoliveira/secure-auth@0.10.1`](https://www.npmjs.com/package/@tgoliveira/secure-auth) (experimental — security review before production)
- Web Crypto API (AES-GCM) + Argon2id recovery KDF
- WebAuthn passkeys (@simplewebauthn) — account authentication and portable broker vault authorization are separate ceremonies

Account auth env vars are documented in `.env.example` (`AUTH_*` names). **Vercel deploy:** see [`docs/VERCEL_ENVIRONMENT_VARIABLES.md`](./docs/VERCEL_ENVIRONMENT_VARIABLES.md). Health check after starting the dev server:

```bash
curl http://localhost:3001/api/auth/package-health
```

Migration history: [`docs/AUTH_RESET_TO_SECURE_AUTH.md`](./docs/AUTH_RESET_TO_SECURE_AUTH.md).

**Admin platform and secure-auth 0.10.1:** set `AUTH_ADMIN_ENABLED=true` and `ADMIN_BOOTSTRAP_EMAIL` in `.env.local`, then run `npm run db:migrate`. In **production**, set `AUTH_RATE_LIMIT_STORE=postgres` and `RATE_LIMIT_STORE=postgres`; on Vercel, set `AUTH_TRUST_FORWARDED_HEADERS=true`. Open `/admin` when signed in as an admin user.

Documentation index: [`docs/README.md`](./docs/README.md).

## Contributing and releases

- **[Contributing](docs/contributing.md)** — branches, PRs, commits, changelog
- **[Releasing](docs/releasing.md)** — manual version cuts (`package.json` ⟺ `vX.Y.Z` tag ⟺ GitHub Release)
- **[Product surface](docs/CURRENT_PRODUCT_SURFACE.md)** — live routes, APIs, integrations
- **[Repo settings](docs/repo-settings.md)** — GitHub branch protection checklist

Agents: see [`AGENTS.md`](./AGENTS.md) and `.cursor/rules/branch-pr-release.mdc`.

## Quick Start

```bash
# Install dependencies (CI / clean checkout)
npm ci

# Start PostgreSQL
docker compose up -d

# Configure environment (required for migrations and the app)
cp .env.example .env.local
# Ensure DATABASE_URL is set in .env.local, e.g.:
# DATABASE_URL=postgresql://letters:letters_dev@localhost:5435/letters_to_god
# NEXTAUTH_URL=http://localhost:3001
# TWO_FACTOR_SECRET_ENCRYPTION_KEY=<openssl rand -base64 32>  # required for account 2FA

# Generate and run migrations (reads .env.local automatically)
npm run db:generate   # after schema changes
npm run db:migrate    # required after pulling schema updates

# Start dev server (port 3001)
npm run dev
```

Migration `0024_portable_vault_broker.sql` adds secure-auth 0.10+ broker operations, portable
mapping state, and cleanup epochs. Apply it before enabling the broker.

Open [http://localhost:3001](http://localhost:3001).

## UI / UX

Design direction and navigation:

- [`docs/DESIGN_SYSTEM.md`](./docs/DESIGN_SYSTEM.md) — **visual design system ("Stillness")**: tokens, Schibsted Grotesk type, components, light + dark mode (source specs in [`docs/design/`](./docs/design/))
- [`docs/UI_UX_DIRECTION.md`](./docs/UI_UX_DIRECTION.md) — tone, purple brand, public page sections
- [`docs/LOGGED_IN_NAVIGATION_AUDIT.md`](./docs/LOGGED_IN_NAVIGATION_AUDIT.md) — logged-in nav structure
- [`docs/README.md`](./docs/README.md) — documentation index

Shared UI components live under `src/components/ui/`. Route groups `(public)`, `(auth)`, and `(vault)` wrap pages in `SiteShell` (header + footer). Page content uses `PageLayout` for width and spacing.

## API reference (Swagger UI)

Browse REST endpoints in Swagger UI during local development:

1. Run `npm run dev`
2. Open [http://localhost:3001/api-docs](http://localhost:3001/api-docs)
3. Sign in to the app in the **same browser** before trying authenticated routes

OpenAPI spec: `docs/openapi.yaml` (JSON at `GET /api/openapi`). Full details: [docs/API_REFERENCE.md](./docs/API_REFERENCE.md).

Production hides `/api-docs` unless `ENABLE_API_DOCS=true` in `.env.local`.

## Passkeys (sign-in and vault unlock)

- **Sign in with passkey** on `/login` — phishing-resistant account authentication; an account with TOTP enabled still completes TOTP before receiving a full session
- **Account settings → Passkeys** — register and manage account sign-in credentials through secure-auth
- **`/vault/settings` → Passkey vault unlock** — while the vault is already open, enable, test, or revoke portable access for an existing synced account passkey
- **`/vault/security`** — vault security review: health summary, protection status, recovery phrase drill (local-only), passkey compatibility, and recent safe vault security events (entry from Vault settings)
- **`/vault/recovery`** — recovery phrase management; optional link to vault settings for passkey vault unlock
- **Passkey sign-in** authenticates only the account. Vault unlock always requires its own explicit
  grant ceremony after the final session exists.
- Details: [`docs/PORTABLE_PASSKEY_VAULT.md`](docs/PORTABLE_PASSKEY_VAULT.md)

Run `npm run db:migrate` after pulling schema updates. The current baseline is vault-core 1.8.1,
secure-auth 0.10.1, and migration `0024`. Legacy PRF reads remain only for dual-run cutover.

## Two-factor authentication (optional)

Account-level TOTP 2FA can be enabled from **Account settings**. It adds an extra sign-in code when signing in with **email and password** and does **not** replace vault password, recovery phrase, or passkey vault unlock. **Passkeys** use device verification and do not require a separate one-time code for account sign-in.

Requires `TWO_FACTOR_SECRET_ENCRYPTION_KEY` in `.env.local` (see `.env.example`). Run `npm run db:migrate` after pulling 2FA schema updates.

## GitHub sign-in (account authentication only)

GitHub sign-in uses the NextAuth **GitHub** provider. It authenticates the **account only** — it does **not** unlock the vault.

| Setting | Value |
|---------|--------|
| Provider ID | `github` |
| Env vars | `AUTH_GITHUB_CLIENT_ID`, `AUTH_GITHUB_CLIENT_SECRET` (legacy `GITHUB_*` also supported) |
| Local callback | `http://localhost:3001/api/auth/callback/github` |

**GitHub OAuth app (summary)**

1. [GitHub Developer settings](https://github.com/settings/developers) → **OAuth Apps** → **New OAuth App**.
2. **Authorization callback URL** must match exactly (local example): `http://localhost:3001/api/auth/callback/github`
3. Copy **Client ID** and generate a **Client secret** → set env vars in `.env.local`, restart the app.
4. Verify: `curl http://localhost:3001/api/auth/providers` should include a `github` entry.

## Microsoft sign-in (account authentication only)

Microsoft sign-in uses the NextAuth **Azure AD** provider (`azure-ad`) against Microsoft Entra ID / the Microsoft identity platform. It authenticates the **account only** — it does **not** unlock the private notes vault or replace passkey PRF vault unlock or the recovery phrase.

| Setting | Value |
|---------|--------|
| Provider ID | `azure-ad` |
| Scopes | `openid`, `email`, `profile` only (no Microsoft Graph mail/calendar/files scopes) |
| Env vars | `AUTH_AZURE_AD_ID` (Application/client ID **GUID**), `AUTH_AZURE_AD_SECRET` (client secret value), `AUTH_AZURE_AD_TENANT_ID` (default `common`) |
| Local callback | `http://localhost:3001/api/auth/callback/azure-ad` |

**Microsoft Entra app registration (summary)**

1. [Microsoft Entra admin center](https://entra.microsoft.com/) → **App registrations** → **New registration**.
2. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts** if using `AUTH_AZURE_AD_TENANT_ID=common` (alternatives: `consumers`, `organizations`, or a specific tenant GUID).
3. **Authentication** → add **Web** platform redirect URIs (must match exactly; do not use SPA-only for this server-side flow):
   - Local: `http://localhost:3001/api/auth/callback/azure-ad`
   - Staging: `https://<staging-host>/api/auth/callback/azure-ad`
   - Production: `https://<production-host>/api/auth/callback/azure-ad`
   - The app enables PKCE automatically (required by Microsoft Entra for code redemption).
4. **Certificates & secrets** → create a client secret → set `AUTH_AZURE_AD_SECRET` (never commit).
5. Set env vars in `.env.local`, restart the app.

**Account linking:** no automatic linking across providers. If an email is already registered with email/password (or another OAuth provider), Microsoft sign-in is rejected with a safe error.

**OAuth/passkey + TOTP:** when account 2FA is enabled, OAuth and passkey sign-in require the package TOTP completion flow before a full session is created. Automatic vault unlock is never attempted from the partial session. See [`docs/TWO_FACTOR_MOBILE_FLOW_AUDIT.md`](docs/TWO_FACTOR_MOBILE_FLOW_AUDIT.md).

## Email verification and account passwords

Email/password accounts are **unverified by default** until the user opens the link sent after registration (`/check-email` → `/verify-email?token=…`).

| Flow | Page / API |
|------|------------|
| Register + verify prompt | `/register` → `/check-email` |
| Verify email | `/verify-email?token=…`, `POST /api/auth/verify-email/confirm` |
| Resend verification | `POST /api/auth/verify-email/resend` |
| Forgot password | `/forgot-password`, `POST /api/auth/forgot-password` |
| Reset password | `/reset-password?token=…`, `POST /api/auth/reset-password` |
| Change password | `/settings/account`, `POST /api/account/change-password` |
| Passkeys & TOTP 2FA | `/settings/account#security` (package `PasskeySettings`, `TwoFactorSettings`) |

**Vault separation:** changing or resetting the account password does **not** unlock, recover, or rotate your vault. Users still need a vault password, recovery phrase, or passkey PRF for vault access.

**Vault client status** (`GET /api/vault/status` + in-browser UVK session):

| Status | Meaning | Primary CTA |
|--------|---------|-------------|
| `not_configured` | Signed in, no vault record | Set up vault → `/vault/setup` |
| `setup_incomplete` | Vault record started, missing required pieces | Continue setup → `/vault/setup` |
| `locked` | Setup complete, UVK not in this browser session | Expand **Vault Status Dock** → inline unlock; fallback `/vault/unlock` |
| `unlocked` | Setup complete, UVK in session | **Lock now** in expanded dock; countdown on collapsed handle |

`/notes` and `/vault/settings` show state-specific prompts instead of unlock panels when no vault exists.

**Vault setup password UI:** `/vault/setup` uses `PasswordSetupFields` from `@tgoliveira/secure-auth` with an app-owned vault password policy (`VAULT_PASSWORD_*` env vars → `src/lib/config/vault-password-policy.ts`). The vault password is validated client-side only and never sent to the server; Argon2id wraps the User Vault Key after validation.

**Vault inactivity lock:** while the vault is unlocked, **15 minutes** of inactivity (configurable via `NEXT_PUBLIC_VAULT_AUTO_LOCK_MINUTES` or `VAULT_AUTO_LOCK_MINUTES`) auto-locks the vault, runs registered before-lock hooks (encrypted draft save on note pages), clears decrypted note bodies from memory, and shows a calm banner. Activity includes editor input via document capture listeners and explicit `touchVaultActivity()` from the note editor. Manual **Lock now** in the expanded **Vault Status Dock** locks without the inactivity banner. See [`docs/VAULT_AUTO_LOCK_NORMALIZATION.md`](docs/VAULT_AUTO_LOCK_NORMALIZATION.md).

**Vault Status Dock:** on every authenticated page, a small header-attached handle shows vault state (`Vault` when locked, `mm:ss` countdown when open). Expand it for **quick unlock** with vault password or passkey PRF (when configured). Recovery phrase unlock is on **`/vault/unlock`** only. Navigating to `/vault/unlock` keeps the dock collapsed. Authenticated route changes scroll to the top unless the URL includes a hash anchor. Locked vault surfaces use **Unlock here** (expands dock) and **Open full unlock page** via `VaultLockedState` — context-specific copy on `/notes`, `/notes/new`, `/notes/[id]`, `/vault/settings`, and `/vault/security`.

**Import / export:** bulk import and export of decrypted notes are **not available** in this MVP. See `/vault/settings` and the public home page.

**Account deletion:** permanently removes your vault, all encrypted notes, vault envelopes, and passkey credentials. Warnings appear on `/settings/account` before deletion.

**Email delivery** (account verification and password reset only — never private note content):

| Mode | `EMAIL_PROVIDER` | Use |
|------|------------------|-----|
| Console debug | `console` | Logs links to server console; **never use in production** |
| Local SMTP (Mailpit) | `smtp` | Real delivery to [Mailpit](http://localhost:8025) |
| Staging / production | `smtp` | Brevo or other SMTP relay |

**Console (quick local debug):**

```bash
EMAIL_PROVIDER=console
EMAIL_FROM=noreply@localhost
APP_BASE_URL=http://localhost:3001
```

**Mailpit (local real SMTP):**

```bash
docker compose up -d mailpit   # SMTP :1025, UI http://localhost:8025
```

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURE=false
SMTP_USER=
SMTP_PASSWORD=
EMAIL_FROM="SelahKeep <noreply@localhost>"
APP_BASE_URL=http://localhost:3001
```

**Brevo SMTP (staging example — do not commit credentials):**

```env
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<brevo-smtp-login>
SMTP_PASSWORD=<brevo-smtp-key>
EMAIL_FROM="SelahKeep <noreply@selahkeep.com>"
APP_BASE_URL=https://your-staging-url
```

For real sending, configure SPF/DKIM/DMARC on your domain per your provider. Never commit SMTP credentials.

**Password policy:** set `AUTH_PASSWORD_MIN_LENGTH` (preferred) or `PASSWORD_MIN_LENGTH` in `.env.local`. The value is passed once into `@tgoliveira/secure-auth` through `buildSecureAuthConfigFromEnv` and exposed to all package password forms (register, reset, change password) via `SecureAuthUIProvider`. Default minimum length is **12** when unset. Do not hardcode password rules in local UI components.

Run `npm run db:migrate` after pulling account-auth schema updates (`0006_account_email_verification_password_reset.sql`).

## Active sessions

From **Account settings → Active sessions**, users can see browsers/devices signed in to the account, revoke one session, sign out of all other sessions, or sign out everywhere.

Account sessions are separate from **vault unlock**. Revoking a session signs out the account on that browser; it does not unlock the vault.

Run `npm run db:migrate` after pulling session schema updates (`0007_account_sessions.sql`).

Run `npm run db:migrate` after pulling vault schema updates (`0008`–`0011`, including `0010_drop_letters.sql` and `0011_drop_trusted_devices.sql`).

## Notes (SelahKeep Phase 2–3)

Primary UI: **`/notes`**, **`/notes/new`**, **`/notes/:id`**, **`/notes/remembrance`**, **`/notes/weekly-reflection`**, **`/vault/settings`**, **`/vault/security`**.

- **Resolved status** — user-facing “resolved” maps to internal encrypted `answered` metadata; optional reflection dialog on mark-resolved; timeline on detail; icon toggle on list cards and detail view; edit-mode toggle in category fields; filters use resolved/unresolved
- **Note editor** — polished visual editor card (grouped toolbar, canvas, status) by default via Tiptap; Markdown remains canonical encrypted body; discreet **Markdown** toggle for source + collapsible preview. **Quick insert**, **focus mode**, **14 templates**, **daily note**, encrypted local drafts, and save/draft status. See `docs/EDITOR_IMPLEMENTATION_DECISION.md`.
- **Notes list** — created + updated dates on every card, sort (last modified/created/title; pinned notes first within groups), filtered counter (`4 of 12 notes`), resolved/unresolved badges, **smart local filters**, **saved views** (encrypted in vault index), **cards/list view toggle** (`selahkeep:notes:view-mode`)
- **Note lifecycle** — pin, favorite, archive, move to trash, restore, permanent delete (with confirmation), duplicate note (new id + Note Key). See `SECURITY.md` and `docs/UI_UX_DIRECTION.md`.
- **Vault indicator** on `/notes` and `/notes/[id]` — open/closed state with real inactivity countdown (`Auto-locks in 14:32`); lock control here only (not top nav); unlock links preserve safe `returnTo` for post-unlock navigation (`/notes`, `/vault/settings`, `/vault/recovery`, `/settings/account`)
- **Encrypted local drafts** — autosaved in IndexedDB wrapped by User Vault Key (`note_draft` field); never plaintext
- **Title required** on `/notes/new` (trimmed, non-empty); still encrypted in metadata at rest
- **Encrypted metadata** (title, category, tags, answered, pinned, favorite, archived, trashed) + **encrypted body** per note
- **Answered** marker on list/detail icon toggle and edit fields; new notes default to `answered: false`
- **Vault index v3** (`GET/PATCH /api/vault/index`) — note entries (with lifecycle fields), encrypted category/tag definitions, encrypted saved views
- **Tags** normalized client-side (`normalizeTagInput`, max **32** chars); displayed with `#`, stored without `#`
- **Category vs tags:** category pill (no `#`); tag chips with `#`
- **Client-side search/filters** after unlock — full-text search over title, body, category, and tags; compact toolbar with smart filter chips (including **Recently viewed**); saved views and reflective routes in **Views ▾** menu (Remembrance, Weekly reflection); no server search. See `SECURITY.md` and `docs/UI_UX_DIRECTION.md`.
- **Reflective workflows** — resolved reflection (encrypted metadata), note timeline, `/notes/remembrance`, `/notes/weekly-reflection`, static prompt cards (local only, no AI)
- **Vault status dock:** `VaultStatusDock` in `AppHeaderChrome` / authenticated `Nav` header (collapsed handle + expanded panel, signed-in only) — compact handle when locked/unlocked; full panel for setup states and on expand; inactivity countdown in handle (`mm:ss`) and expanded copy; **Lock now** / unlock only when expanded; unlock links use safe `returnTo` (`safe-return-to.ts`).
- **Unlock behavior** (`GET/PATCH /api/vault/settings`): `metadata_only` (default) or `decrypt_all`
- **Version history & compare** — every content save appends an immutable, encrypted snapshot. On a note's detail page, open **Version history** to browse previous versions, **compare any two in a GitHub-style line diff**, and **restore** a version (restore appends a new version; history is never rewritten). Snapshots reuse the note's Note Key, are AAD-bound per version, and never travel in plaintext. Retention via `NOTE_VERSION_HISTORY_LIMIT` (default 50/note). Run `npm run db:migrate` after pulling `0012_note_versions.sql`. See [`docs/TDR_Note_Version_History.md`](./docs/TDR_Note_Version_History.md).
- **Voice notes (on-device)** — on `/notes/new` and when editing a note, **Dictate** records the mic and transcribes to text **entirely in the browser** (Whisper via transformers.js, Web Worker) in **English, Portuguese, or Spanish**. Transcription is **near real-time**: a live transcript updates while you speak (the accumulated audio is re-transcribed every ~2.5s on-device), with a final pass on Stop. Audio and transcript never leave the device — only model weights download once, and they are **pre-fetched in the background** when you enter the app so the first dictation is instant. Review/edit the transcript before it is inserted into the encrypted editor. See [`docs/TDR_Local_Voice_Notes.md`](./docs/TDR_Local_Voice_Notes.md).
- **API:** `POST/GET /api/notes`, `GET/PUT/DELETE /api/notes/:id`, `GET/POST /api/notes/:id/versions`, `GET /api/notes/:id/versions/:versionId` — encrypted payloads only
- **Removed (Phase 3):** `/letters`, `/api/letters`, `letters` table

## AI integrations (Cursor, Claude, Codex)

Opt-in MCP access to **selected** notes and Kanban boards (never the whole vault by default). Requires `INTEGRATIONS_ENABLED=true` and migration `0018_integrations.sql`.

1. Unlock your vault and open **`/settings/integrations`**.
2. Create an integration (e.g. "Cursor MacBook") — copy the **one-time** token and integration key.
3. Choose notes/boards and read or read+write permissions.
4. Connect:
   - **Local handoff:** run `node tools/selahkeep-bridge/index.mjs`, then use **Connect locally** in the UI (writes `~/.selahkeep/mcp-credentials.json`).
   - **Manual:** copy the generated `mcp.json` snippet into Cursor / Claude Desktop config.

MCP server package: `packages/selahkeep-mcp` (`npm install && npm run build` in that directory). Env vars: `SELAHKEEP_API_URL`, `SELAHKEEP_INTEGRATION_TOKEN`, `SELAHKEEP_INTEGRATION_KEY`.

**Privacy:** the server stays zero-knowledge; decrypted content is available only to tools you connect. AI providers may process plaintext once an agent reads a shared note.

See [`docs/TDR_AI_Integrations.md`](./docs/TDR_AI_Integrations.md) and [`docs/ADR-007_Integration_Grants_MCP.md`](./docs/ADR-007_Integration_Grants_MCP.md).

## Deploy (Vercel)

See [`docs/VERCEL_ENVIRONMENT_VARIABLES.md`](./docs/VERCEL_ENVIRONMENT_VARIABLES.md) and [`docs/LTG_VAULT_MVP_ACCEPTANCE_CHECKLIST.md`](./docs/LTG_VAULT_MVP_ACCEPTANCE_CHECKLIST.md).

**Production requirements:**

- `DATABASE_URL`, `NEXTAUTH_SECRET`, `TWO_FACTOR_SECRET_ENCRYPTION_KEY`, `APP_BASE_URL`
- `EMAIL_PROVIDER=smtp` with `EMAIL_FROM` — **never** `EMAIL_PROVIDER=console` in production
- OAuth callback URLs: `{APP_BASE_URL}/api/auth/callback/{provider}`
- Run `npm run db:migrate` after pulling Kanban schema updates (`0016_note_kanban.sql`). Verify with `npm run db:check-kanban` if `/kanban` or `GET /api/kanban` returns 503 ("Kanban boards are not available yet").
- Run `npm run db:migrate` after pulling vault admin schema updates (`0017_vault_admin_platform.sql`). Verify with `npm run db:check-vault-admin` if `/admin/vault/config` or `GET /api/vault/admin/config` fails on missing table.
- Run `npm run db:migrate` after pulling integrations schema updates (`0018_integrations.sql`). Set `INTEGRATIONS_ENABLED=true` to enable `/settings/integrations`.
- Run `npm run db:migrate` before serving traffic
- MVP acceptance: [`docs/LTG_VAULT_MVP_ACCEPTANCE_CHECKLIST.md`](./docs/LTG_VAULT_MVP_ACCEPTANCE_CHECKLIST.md)

## Commands

| Command | Description |
|---------|-------------|
| `npm ci` | Clean install from lockfile (CI / fresh checkout) |
| `npm run dev` | Start development server (port 3001) |
| `npm run build` | Production build |
| `npm run lint` | ESLint (`eslint .`) |
| `npm run test` | Run all Vitest tests |
| `npm run test:coverage` | Vitest with coverage thresholds (≥90% lines/statements/functions/branches) |
| `npm run test:all` | Alias for `npm run test:coverage` |
| `npm run validate` | Lint + typecheck + coverage + production build (pre-PR gate) |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:migrate` | Apply migrations to PostgreSQL |
| `docker compose up -d` | Start local PostgreSQL |

## Testing

All tests run through **Vitest** (`src/test/`). Browser E2E (Playwright) was intentionally removed; see `docs/TESTING_STRATEGY.md`.

| Type | Location | What it covers |
|------|----------|----------------|
| **Unit** | `src/test/unit/` | Crypto helpers, vault unlock, PRF/WebAuthn option preparation, validation, rate limits, API client, logger, env loading |
| **Security** | `src/test/security/` | Plaintext rejection, boundaries, sentinel phrase (static + runtime integration), AAD, WebAuthn challenges, audit redaction |
| **Services** | `src/test/services/` | Business logic with mocked repositories (notes, vault, passkeys, admin) |
| **API routes** | `src/test/api/` | Route handlers with mocked auth + services (notes, vault, passkeys, recovery, register, admin) |
| **Features** | `src/test/features/` | Client feature flows (passkey unlock, site layout shell, UI pages, accessibility) |

Recent passkey-related coverage includes:

- Touch ID vs QR vault unlock transport preservation and platform registration (`docs/archive/PASSKEY_TOUCH_ID_QR_PROMPT_FIX.md`, `passkey-transports.test.ts`, `vault-unlock-authenticate.test.ts`)
- Vault passkey lifecycle disable/re-register (`docs/archive/PASSKEY_VAULT_LIFECYCLE.md`, `passkey-vault-lifecycle.test.ts`)
- Dual account + vault passkey unlock filtering (`CHANGELOG.md`, `src/test/security/dual-passkey-vault-unlock.test.ts`)
- Passkey account-login / vault-unlock separation (`docs/archive/PASSKEY_LOGIN_VAULT_UNLOCK.md`, `src/test/security/passkey-login-vault-unlock.test.ts`)
- PRF salt derivation (`src/test/security/passkey-prf.test.ts`)
- PRF support pre-check (`src/test/unit/prf-support.test.ts`)
- Passkey setup UX when PRF unavailable (`src/test/features/passkey-setup.test.tsx`)
- Passkey vault unlock settings (`src/test/features/passkey-vault-unlock-settings.test.tsx`)
- PRF diagnostics (`src/test/unit/passkey-prf-diagnostics.test.ts`, `docs/archive/PASSKEY_VAULT_UNLOCK_DIAGNOSTIC_AUDIT.md`)
- WebAuthn JSON → `ArrayBuffer` conversion for PRF extensions (`src/test/unit/prepare-webauthn-options.test.ts`)
- Passkey registration/authentication services and routes
- Passkey removal (`DELETE /api/passkeys`)

Coverage is enforced on core application code (`src/lib`, `src/server/services`, `src/server/policies`, `src/app/api`, `src/features/passkey`). Repository adapters and UI pages are covered indirectly via service/API/feature tests.

```bash
npm run validate        # lint + typecheck + coverage + build (pre-PR)
npm ci                  # clean install
npm run lint            # ESLint
npm run test:coverage   # must pass before merge (≥90% lines/statements/functions/branches)
npm run build           # production build
npm run db:migrate      # apply migrations (requires PostgreSQL)
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md), [SECURITY.md](./SECURITY.md), [AGENTS.md](./AGENTS.md), and [docs/UTILITY_EXTRACTION_INVENTORY.md](./docs/UTILITY_EXTRACTION_INVENTORY.md) (Phase 2 internal utilities).

## Beta readiness

Before any **real beta**, complete the gates in [`docs/LGPD_BETA_GATES.md`](./docs/LGPD_BETA_GATES.md) and review [`docs/THREAT_MODEL_Private_Letters_Vault.md`](./docs/THREAT_MODEL_Private_Letters_Vault.md).

Production rate limiting: set `RATE_LIMIT_STORE=postgres` and run migrations (`rate_limit_buckets`, WebAuthn indexes in `0003_*`).

**Account deletion:** `/settings/account` — requires phrase `DELETE MY ACCOUNT` and password re-auth (credentials accounts).

**Autosave:** explicitly disabled for MVP (encrypted autosave out of scope).

## Documentation

See [`docs/README.md`](./docs/README.md) for the full index. Active source of truth:

- [TDR — SelahKeep MVP](./docs/TDR_LTG_Vault_MVP.md)
- [ADR-005 — Vault crypto & note keys](./docs/ADR-005_LTG_Vault_Cryptography_Argon2id_Recovery_Phrase_Note_Keys.md)
- [ADR-006 — Passkey PRF unlock](./docs/archive/ADR-006_LTG_Vault_Passkey_PRF_Unlock.md)
- [MVP acceptance checklist](./docs/LTG_VAULT_MVP_ACCEPTANCE_CHECKLIST.md)
- [API Reference (Swagger / OpenAPI)](./docs/API_REFERENCE.md)

Superseded letters-era ADRs and one-off implementation audits were removed; use ADR-005/006 and the TDR for current guidance.
