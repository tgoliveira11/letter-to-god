# Architecture — SelahKeep MVP

> **Product:** **SelahKeep** — private encrypted notes. Former working name: LTG Vault. [`docs/TDR_LTG_Vault_MVP.md`](./docs/TDR_LTG_Vault_MVP.md) is the source of truth; Phases 0–5 are complete per [`docs/LTG_VAULT_IMPLEMENTATION_PLAN.md`](./docs/LTG_VAULT_IMPLEMENTATION_PLAN.md).

## Stack

- **Frontend:** Next.js, TypeScript, React
- **Backend:** Next.js API Routes
- **Database:** PostgreSQL
- **ORM:** Drizzle

## Modular monolith (Phase 1 + Phase 2)

This project uses an **internal modular monolith**. See `docs/MODULE_BOUNDARIES.md` and `docs/UTILITY_EXTRACTION_INVENTORY.md`.

- Business logic lives under `src/modules/{email,audit,rate-limit,security,vault,notes,ui}`.
- **Account auth** is not a local module — `@tgoliveira/secure-auth` via `src/lib/secure-auth.ts`.

See `docs/MODULE_BOUNDARIES.md` for responsibilities and forbidden cross-module imports.

## Layers

```text
React UI (src/app, src/components, src/features)
  -> Crypto Client Layer (`@tgoliveira/vault-core` + `src/modules/vault/`, note crypto in `src/lib/crypto-client/`)
  -> API Client (src/lib/api-client)
  -> API Route Layer (src/app/api) — thin handlers
  -> Module services (src/modules/*/services)
  -> Module repositories (src/modules/*/repositories)
  -> Database (PostgreSQL via Drizzle — src/lib/db)
```

### Deterministic application-state boundary

The root layout resolves one non-secret server snapshot (`src/lib/app-bootstrap.ts`) and seeds NextAuth, effective secure-auth UI configuration, account ownership, vault status, preferences, and admin access from that same snapshot. `AppBootstrapBoundary` hides persistent UI whenever the client session owner differs, synchronously clears private state, invalidates the vault owner, and refreshes the server tree.

Private browser work uses `AsyncOwnershipController` plus a current vault-core lease. After each relevant `await`, a consumer must still own the same account, vault epoch, resource, encrypted-key identity, and request generation before it updates UI, cache, or persistence. See [`docs/TDR_DETERMINISTIC_APPLICATION_STATE.md`](./docs/TDR_DETERMINISTIC_APPLICATION_STATE.md).

## Directory Structure

```text
src/
  modules/             # Phase 1 domain modules (see MODULE_BOUNDARIES.md)
    auth/ account/ sessions/ two-factor/ passkeys/
    email/ audit/ rate-limit/ security/ vault/ notes/ ui/
  app/
    (public)/          # Landing, marketing
    (auth)/            # Login, signup
    (vault)/           # Notes, vault, settings
    api/               # REST API routes (thin; delegate to modules)
  components/          # App shell + domain components (migrating to modules)
    ui/                # Re-exports from modules/ui
    layout/            # SiteShell, Nav, SiteFooter, PageLayout
    notes/           # NoteCard
    notes/             # NoteCard
  features/            # Client feature flows (passkey, vault, notes, voice)
    voice/             # On-device dictation: panel, hook, transcription Web Worker
  lib/
    crypto-client/     # Note + version encryption + legacy shims re-exporting src/modules/vault
    voice/             # Pure voice helpers: languages, audio PCM, transcript format, config
    modules/vault/     # Vault envelopes, session, portable passkeys (@tgoliveira/vault-core@1.8.1)
    api-client/        # HTTP client for API
    validation/        # Shared Zod schemas
    db/                # Drizzle client (server-only)
  server/              # Legacy shims re-exporting modules (Phase 1)
```

## API Routes

See also [`docs/API_REFERENCE.md`](./docs/API_REFERENCE.md) and [`docs/openapi.yaml`](./docs/openapi.yaml).

- Local Swagger UI: [http://localhost:3001/api-docs](http://localhost:3001/api-docs)
- OpenAPI JSON: `GET /api/openapi`

**`/api-docs` layout:** Swagger UI intentionally renders **without** `SiteShell` (`Nav` / `SiteFooter`) so the vendor UI can use the full viewport. The page still includes the global skip link from the root layout and sets `id="main-content"` on its `<main>`. In production the route returns 404 unless `ENABLE_API_DOCS=true` (see `.env.example` and `docs/API_REFERENCE.md`).

- Portable passkey unlock is canonical. One synced account credential may authorize the broker from
  multiple browsers without PRF variants or browser binding rows.
- Account login, portable grant authorization, and vault session installation are distinct states.
  Login never issues a grant or installs a UVK.
- `vault_portable_broker_envelopes` stores only app routing metadata and opaque AAD scope. PUK and
  encrypted UVK envelope custody belongs to the broker; the browser calls it directly.
- Migration `0024` includes secure-auth broker operations and app mapping/cleanup epoch tables.
  `vault_envelopes` PRF variants and browser bindings are legacy dual-run reads only.
- WebAuthn challenge validation uses atomic `consumeValidChallenge()` only (`findValidChallenge` removed)
- WebAuthn challenge indexes: `idx_webauthn_challenges_lookup`, `idx_webauthn_challenges_expires_at`

- `POST/GET /api/notes`, `GET/PUT/DELETE /api/notes/:id` — encrypted notes (Markdown body, metadata blob)
- `GET/POST /api/notes/:id/versions`, `GET /api/notes/:id/versions/:versionId` — immutable encrypted note version snapshots (history + GitHub-style compare/restore). Client-encrypted under the note's Note Key, AAD-bound to a per-version id; retention via `NOTE_VERSION_HISTORY_LIMIT`. Table `note_versions` (migration `0012`). See `docs/TDR_Note_Version_History.md`
- `GET/POST /api/kanban`, `GET/PUT/DELETE /api/kanban/:boardId`, `GET/POST /api/kanban/:boardId/versions`, `GET /api/kanban/:boardId/versions/:versionId` — encrypted Kanban boards (note-bound or standalone). Client-only encryption; tables `note_kanban_boards`, `note_kanban_versions` (migration `0016`). Note-bound boards sync bidirectionally with source note checklists client-side (`src/lib/notes/kanban-sync.ts`, debounced hooks). See `docs/TDR_Note_Kanban_Boards.md`
- `GET/PATCH /api/vault/index` — encrypted vault index blob (v3: note lifecycle metadata, categories, tags, saved views, recently viewed)
- `GET/PATCH /api/vault/settings` — encrypted vault settings (unlock behavior, setup metadata)
- `POST/GET /api/notes`, `GET/PUT/DELETE /api/notes/:id` — encrypted note payloads only
- `POST /api/vault/setup` — vault-v2 setup (encrypted settings, index, password + recovery phrase envelopes); vault password validated client-side via `PasswordSetupFields` + `VAULT_PASSWORD_*` (never in request body)
- `POST /api/vault/init`, `GET /api/vault/status` — returns `hasVault`, `setupPhase`, `setupComplete`, and `availableUnlockMethods`; client derives `not_configured` / `setup_incomplete` / `locked` / `unlocked` via `useVaultClientStatus` + UVK session
- `POST /api/vault/unlock-envelope` — fetch encrypted envelope for password / recovery phrase unlock
- `GET/POST /api/vault/security-events` — list and record safe vault security audit events (no secrets)
- `POST /api/vault/recovery-phrase` — replace recovery phrase envelope (atomic revoke + create; client-side UVK wrap)
- `PUT /api/vault/password-envelope` — persist a client-generated Argon2id KDF upgrade by atomically replacing ciphertext only; no password/UVK crosses the API
- `POST /api/recovery-code`, `POST /api/vault/unlock-with-recovery-code` — legacy recovery code only
- `POST /api/passkeys/register`, `POST /api/passkeys/authenticate`, `DELETE /api/passkeys` — vault recovery passkey flows (authenticated)
- `POST /api/auth/passkey/login/options`, `POST /api/auth/passkey/login/verify` — passkey account sign-in (unauthenticated start; TOTP still required when enabled)
- `GET /api/account/passkeys`, `POST /api/account/passkeys/register`, `DELETE /api/account/passkeys/:id`, `POST /api/account/passkeys/:id/enable-vault-unlock`
- `DELETE /api/account` — account deletion
- `GET /api/account/2fa/status`, `POST /api/account/2fa/setup/start`, `POST /api/account/2fa/setup/verify`, `POST /api/account/2fa/disable`, `POST /api/account/2fa/backup-codes/regenerate`
- `POST /api/auth/login/start`, `POST /api/auth/login/verify-2fa`, `POST /api/auth/login/verify-2fa-oauth`
- NextAuth OAuth providers: Google, Apple, Microsoft (`azure-ad` — Microsoft identity platform; account auth only; scopes `openid email profile`)
- `POST /api/auth/verify-email/resend`, `POST /api/auth/verify-email/confirm` — email verification (hashed tokens in `account_tokens`)
- `POST /api/auth/forgot-password`, `POST /api/auth/reset-password` — password reset (generic forgot response; no vault involvement)
- `POST /api/account/change-password`, `GET /api/account/auth-status` — signed-in password change and auth capability flags
- `GET /api/account/sessions`, `DELETE /api/account/sessions/:id`, `POST /api/account/sessions/revoke-others`, `POST /api/account/sessions/revoke-all`, `POST /api/account/sessions/ping` — account session management (not vault unlock)
- `GET/PATCH /api/account/preferences`, `GET/PUT/DELETE /api/account/preferences/:key`, `GET /api/account/preferences/export` — secure-auth-owned namespaced account configuration

### Account email and password flows

```text
Register (credentials) -> unverified user + verification email -> /check-email
Verify link -> POST /api/auth/verify-email/confirm -> email_verified_at

Forgot -> POST /api/auth/forgot-password (generic) -> reset email
Reset link -> POST /api/auth/reset-password -> password_hash + password_updated_at

Settings -> POST /api/account/change-password -> password_updated_at (current session kept)
```

- Service: `src/server/services/account-auth-service.ts`
- Tokens: `src/server/repositories/account-token-repository.ts` (`email_verification`, `password_reset`)
- Email: `src/server/email/send-email.ts` dispatches by `EMAIL_PROVIDER`; `smtp-provider.ts` (nodemailer); `config.ts` (SMTP/Mailpit/Brevo env parsing)
- Password policy: `buildSecureAuthConfigFromEnv` → `@tgoliveira/secure-auth` (`passwordPolicy` + `secureAuth.uiConfig.passwordPolicy`); resolved by `@tgoliveira/secure-auth/client/password-policy` on the client
- UI: `(auth)/register`, `reset-password` (package pages); account settings uses package `ChangePasswordSettings` inside `SecureAuthUIProvider`

Changing or resetting the account password does **not** unlock, recover, or rotate the vault.

## Envelope Encryption

```text
Note metadata/body -> Note Key -> User Vault Key -> vault envelopes
Note metadata/body -> Note Key -> User Vault Key
Note version snapshot -> (same) Note Key -> User Vault Key   # note_versions, AAD bound to versionId
Vault index (titles for list) -> User Vault Key
```

App-held envelope methods are `password` and `recovery_phrase`; `passkey_prf` and `recovery_code`
are legacy. Portable UVK envelopes are broker-held and referenced by opaque mapping rows.

## UI layer

- **Design docs:** `docs/UI_UX_DIRECTION.md`, `docs/LOGGED_IN_NAVIGATION_AUDIT.md`
- **Layout:** `AuthenticatedPage` + `PageLayout` width tokens (`settings` 800px, `notes` 920px, `editor` 880px); see `src/lib/ui/authenticated-layout.ts` and `docs/UI_UX_DIRECTION.md`
- **Authenticated UI patterns:** `PageHeader`, `ToolbarButton`, `NotesListControls`, `SmartFilterChips`, `NotesListGrid`, `SettingsSection`
- **Public marketing:** Home page sections and copy in `src/lib/marketing/home-copy.ts`
- **Vault setup:** `/vault/setup` — `PasswordSetupFields` (secure-auth) + BIP39 recovery phrase wizard; policy from `src/lib/config/vault-password-policy.ts`
- **Recovery management:** `/vault/recovery` — status-gated recovery phrase replace (no initial phrase generation post-setup); link to `/vault/settings` for optional passkey vault unlock
- **Passkey vault unlock:** `/vault/settings` — `PortablePasskeyVaultSetup`; enroll/test/revoke a
  synced account credential without exposing PRF or browser-binding concepts
- **Vault security review:** `/vault/security` — health summary, protection indicators, local recovery phrase drill (`verifyRecoveryPhraseDrill`), passkey compatibility guide, safe audit event log (`GET/POST /api/vault/security-events`)
- **Vault unlock:** `VaultDockQuickUnlock` in `VaultStatusDock` shows **one primary method** when locked (passkey when configured, otherwise vault password). Recovery phrase is **only** on `/vault/unlock`. Dock is hidden before vault setup and on `/vault/unlock`. See [`docs/VAULT_DOCK_UX.md`](./docs/VAULT_DOCK_UX.md). Collapsed handle shows `Vault` or countdown; expanded open state is compact with **Lock now**; auto-collapse via `useVaultDockDismiss`.
- **Vault setup:** `/vault/setup` — recovery phrase copy/download + randomized word-position confirmation (3 words for 12-word phrase, 6 for 24-word). See [`docs/VAULT_SETUP_RECOVERY_PHRASE_CONFIRMATION.md`](./docs/VAULT_SETUP_RECOVERY_PHRASE_CONFIRMATION.md).
- **Design system:** "Stillness" — see [`docs/DESIGN_SYSTEM.md`](./docs/DESIGN_SYSTEM.md) (source specs in `docs/design/`). Schibsted Grotesk via `next/font` (`--font-sans`), outlined chips, signature animations.
- **Tokens:** CSS variables in `src/app/globals.css` (calm neutral + **purple** primary) with a full **light + dark** theme (`prefers-color-scheme`); style with tokens only, never hardcoded hex
- **Security UX:** no plaintext notes in URLs/API; recovery phrase client-only; sanitized Markdown preview; visual note editor (Tiptap) with Markdown canonical storage — see [`docs/EDITOR_IMPLEMENTATION_DECISION.md`](./docs/EDITOR_IMPLEMENTATION_DECISION.md); encrypted IndexedDB drafts (see [`docs/AUTOSAVE_BEHAVIOR.md`](./docs/AUTOSAVE_BEHAVIOR.md)); encrypted note attachments (see [`docs/ENCRYPTED_ATTACHMENTS.md`](./docs/ENCRYPTED_ATTACHMENTS.md)); client-side list excerpts after unlock; storage usage on `/vault/settings` (see [`docs/STORAGE_USAGE.md`](./docs/STORAGE_USAGE.md)); note create/edit field order (see [`docs/NOTE_CREATE_EDIT_UX.md`](./docs/NOTE_CREATE_EDIT_UX.md)); quick insert, focus mode, daily note; tag normalization before encrypted index write

## Voice notes (on-device transcription)

Dictation is a **client-only** feature with **no server surface**. The resulting note is saved through the existing encrypted `POST /api/notes` flow.

```text
/notes/new
  -> VoiceCapturePanel (src/features/voice/, lazy via next/dynamic, ssr:false)
       -> useVoiceTranscription (mic capture + worker lifecycle)
            -> transcription.worker.ts -> dynamic import("@huggingface/transformers") (Whisper, WASM/WebGPU)
       -> pure helpers in src/lib/voice/ (languages, audio PCM mixdown/resample, transcript format, config)
```

Only **model weights** are fetched (once, cached); microphone audio and the transcript never leave the browser. Languages: English, Portuguese, Spanish. Config: `NEXT_PUBLIC_VOICE_NOTES_ENABLED`, `NEXT_PUBLIC_VOICE_MODEL`, `NEXT_PUBLIC_VOICE_MODEL_HOST`. The cloud Web Speech API is **not** used for note content. See `docs/TDR_Local_Voice_Notes.md` and [`docs/DICTATION_UX.md`](./docs/DICTATION_UX.md).

## AAD binding (ADR-005)

Client generates note UUIDs and binds encrypted payloads with AAD:

- `aad.userId` — authenticated user ID
- `aad.resourceId` — note or vault resource ID
- `aad.field` — encrypted field name (`note_metadata`, `note_body`, `note_key`, `note_version_metadata`, `note_version_body`, `vault_key`, etc.)

Server validates AAD in `src/server/policies/aad-validation.ts` before storage. Client verifies AAD in `src/lib/crypto-client/aad-verify.ts` before decryption.

## Database transactions

Multi-step sensitive flows use `runInTransaction()` (`src/lib/db/transaction.ts`):

- vault initialization and LTG setup
- recovery phrase replace (`POST /api/vault/recovery-phrase`)
- legacy recovery code store/regenerate (`POST /api/recovery-code`)
- passkey register/remove

Failures roll back all related writes.

## Passkey account sign-in

Account passkey sign-in is owned by `@tgoliveira/secure-auth` (`LoginPage` and package client) and establishes only the account session.

Account passkey verification and counter CAS remain package-owned. After a final account session,
secure-auth may run a separate exact-credential portable grant ceremony. Vault-core restores the UVK
in the browser and SelahKeep installs it only after receipt finalization. Legacy PRF login hooks are
not used by the canonical login page.

See [`docs/AUTH_RESET_TO_SECURE_AUTH.md`](./docs/AUTH_RESET_TO_SECURE_AUTH.md) and [`docs/archive/PASSKEY_LOGIN_VAULT_UNLOCK.md`](./docs/archive/PASSKEY_LOGIN_VAULT_UNLOCK.md).

## Account two-factor authentication

TOTP 2FA is **account authentication only** — provided by `@tgoliveira/secure-auth` (settings UI, API routes, login `/login/2fa` flow).

Passkey sign-in follows package rules when 2FA is enabled (pending challenge until TOTP verified).

- Settings UI: `/settings/account` (`AccountSettingsPage` from package + product recovery links)
- Login challenge: `/login/2fa` (app integration: `OAuthTwoFactorChallenge` for OAuth, package `CredentialsTwoFactorForm` for credentials) + `src/proxy.ts` gate for partial sessions with safe `callbackUrl` preservation
- Storage: `user_two_factor_settings`, `user_two_factor_backup_codes`, login challenge/token tables
- NextAuth provider: `login-token` (one-time token after password + optional 2FA)

## API Routes (additional)

- `DELETE /api/account` — account deletion (cascades encrypted user data)

## Rate limiting

`src/server/policies/rate-limit/` — adapter interface, in-memory (dev/test) and PostgreSQL (production via `RATE_LIMIT_STORE=postgres`).

## Audit events

`src/server/policies/audit-sanitization.ts` + `audit-repository.ts` — non-sensitive audit trail.

## Vault session

`src/lib/vault/vault-auto-lock-config.ts` — configurable inactivity timeout (default 15 min).

`src/lib/crypto-client/vault-session.ts` — **single app-owned** in-memory UVK + lock state (manual lock, auto-lock, subscribers). `src/modules/vault/client/vault-session.ts` re-exports this module.

See [`docs/VAULT_SESSION_SINGLE_SOURCE_OF_TRUTH_FIX.md`](./docs/VAULT_SESSION_SINGLE_SOURCE_OF_TRUTH_FIX.md) and [`docs/VAULT_AUTO_LOCK_NORMALIZATION.md`](./docs/VAULT_AUTO_LOCK_NORMALIZATION.md).

## Beta documentation

- [`docs/THREAT_MODEL_Private_Letters_Vault.md`](./docs/THREAT_MODEL_Private_Letters_Vault.md)
- [`docs/LGPD_BETA_GATES.md`](./docs/LGPD_BETA_GATES.md)
- [`docs/BACKUP_RESTORE_POLICY.md`](./docs/BACKUP_RESTORE_POLICY.md)
