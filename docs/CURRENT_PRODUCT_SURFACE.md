# Current product surface — SelahKeep

Living inventory of what the app exposes **today**. Update this file when routes, APIs, jobs, integrations, or shipped/planned status changes.

**Last reviewed:** 2026-07-25 · **Version in repo:** see `package.json`

---

## Product scope

Private encrypted notes vault (web). Account auth via `@tgoliveira/secure-auth`; note title/body encrypted client-side only. Former working name: LTG Vault (retired).

**Not shipped / out of scope:** public letters, admin note content access, server-side AI on note plaintext, npm package publish.

---

## User-facing routes (pages)

| Route | Auth | Status | Purpose |
|-------|------|--------|---------|
| `/` | Public | Shipped | Marketing / landing |
| `/register` | Guest | Shipped | Account registration |
| `/login` | Guest | Shipped | Sign in |
| `/login/2fa` | Partial session | Shipped | TOTP step (secure-auth `LoginTwoFactorPage`) |
| `/login/2fa/complete` | Partial session | Shipped | OAuth 2FA completion (secure-auth 0.5.0+) |
| `/login/magic-link` | Guest | Shipped (when `AUTH_MAGIC_LINK_ENABLED`) | Magic-link verify landing |
| `/login/complete` | Session | Shipped | Post-login handoff |
| `/forgot-password` | Guest | Shipped | Password reset request |
| `/reset-password` | Guest | Shipped | Password reset confirm |
| `/verify-email` | Guest / session | Shipped | Email verification |
| `/check-email` | Guest | Shipped | Post-register notice |
| `/account-deleted` | Public | Shipped | Post-deletion confirmation |
| `/home` | Session | Shipped | Vault-free landing: fixed-height hero (locked/unlocked) + always-visible features/privacy section |
| `/notes` | Session + vault | Shipped | Notes list |
| `/notes/new` | Session + vault | Shipped | Create note |
| `/notes/[id]` | Session + vault | Shipped | View / edit note |
| `/kanban` | Session + vault | Shipped | Standalone encrypted Kanban boards list |
| `/kanban/[boardId]` | Session + vault | Shipped | Encrypted Kanban board detail, mobile move controls, version history |
| `/notes/remembrance` | Session + vault | Shipped | Remembrance workflow |
| `/notes/weekly-reflection` | Session + vault | Shipped | Weekly reflection |
| `/vault/setup` | Session | Shipped | Vault + recovery phrase setup |
| `/vault/unlock` | Session (no vault gate) | Shipped | Vault unlock |
| `/vault/settings` | Session + vault | Shipped | Vault passkeys (including bulk reset that preserves account sign-in passkeys), recovery |
| `/vault/security` | Session + vault | Shipped | Security events |
| `/vault/recovery` | Session | Shipped | Recovery phrase unlock |
| `/settings/account` | Session | Shipped | Profile, delete account |
| `/settings/security` | Session | Shipped | 2FA, sessions, passkeys |
| `/settings/integrations` | Session + vault | Shipped (when `INTEGRATIONS_ENABLED`) | MCP integrations: create/revoke, share notes/boards, handoff |
| `/admin` | Session + admin role | Shipped (when `AUTH_ADMIN_ENABLED`) | Secure-auth admin overview |
| `/admin/users` | Session + admin role | Shipped | User management |
| `/admin/waitlist` | Session + admin role | Shipped | Pending registrations |
| `/admin/invites` | Session + admin role | Shipped | Invite codes |
| `/admin/locks` | Session + admin role | Shipped | Account lockouts |
| `/admin/api-keys` | Session + admin role | Shipped | M2M API keys |
| `/admin/config` | Session + admin role | Shipped | Runtime config overrides |
| `/admin/outpost` | Session + platform admin | Shipped (when `OUTPOST_ADMIN_ENABLED`) | Outpost email outbox overview |
| `/admin/outpost/queue` | Session + platform admin | Shipped | Outbox queue + manual worker |
| `/admin/outpost/config` | Session + platform admin | Shipped | Outpost runtime config |
| `/admin/outpost/observability` | Session + platform admin | Shipped | Outbox metrics and worker runs |
| `/admin/vault` | Session + admin role | Shipped (when `AUTH_ADMIN_ENABLED`) | Vault admin hub (vault-core) |
| `/admin/vault/config` | Session + admin role | Shipped | Effective vault configuration (env + DB overrides) |
| `/admin/vault/env-template` | Session + admin role | Shipped | Copy-ready vault env block |
| `/admin/vault/crypto-policy` | Session + admin role | Shipped | KDF and encryption policy |
| `/admin/vault/profile` | Session + admin role | Shipped | Crypto profile and PRF defaults |
| `/admin/vault/session` | Session + admin role | Shipped | Auto-lock and session policy |
| `/admin/vault/password-policy` | Session + admin role | Shipped | Vault password rules |
| `/admin/vault/security` | Session + admin role | Shipped | Zero-knowledge boundaries |
| `/api-docs` | Dev / `ENABLE_API_DOCS` | Shipped | Swagger UI (off in prod by default) |

---

## API surface (`/api/*`)

Grouped by domain. Full tables: [`API_REFERENCE.md`](./API_REFERENCE.md), OpenAPI: [`openapi.yaml`](./openapi.yaml).

| Domain | Prefix / examples | Notes |
|--------|-------------------|--------|
| **Auth (secure-auth)** | `/api/auth/*`, NextAuth catch-all | Register, login, OAuth, 2FA, OAuth 2FA complete, magic link, passkey login, email verify, password reset |
| **Auth admin (secure-auth)** | `/api/auth/admin/*` | Users, waitlist, invites, locks, API keys, config (admin role; when `AUTH_ADMIN_ENABLED`) |
| **Outpost admin** | `/api/outpost/admin/*` | Email queue, worker send, config, observability (platform admin; when `OUTPOST_ADMIN_ENABLED`) |
| **Vault admin** | `/api/vault/admin/config` | Runtime vault config overrides (platform admin; requires `vault_admin_config_overrides` table) |
| **Account** | `/api/account/*` | Profile, sessions, passkeys, 2FA, change password |
| **Vault** | `/api/vault/*` | Setup, status, settings, index, unlock envelopes, recovery phrase, storage |
| **Passkeys (vault)** | `/api/passkeys/*` | Vault passkey register/authenticate, browser binding, and scoped bulk reset |
| **Notes** | `/api/notes`, `/api/notes/[id]` | Encrypted CRUD only |
| **Note versions** | `/api/notes/[id]/versions/*` | Encrypted version history |
| **Attachments** | `/api/notes/[id]/attachments/*` | Encrypted attachments |
| **Kanban boards** | `/api/kanban`, `/api/kanban/[boardId]/versions/*` | Encrypted board CRUD + version history; React UI under `/kanban` |
| **Integrations** | `/api/integrations`, `/api/integrations/mcp/*` | User MCP integrations (session mgmt); Bearer token for scoped note/board ciphertext (when `INTEGRATIONS_ENABLED`) |
| **Recovery (legacy)** | `/api/recovery-code` | Legacy recovery codes only |
| **Admin** | `/api/admin/users/[id]` | User admin; no note plaintext |
| **Meta** | `/api/openapi`, `/api/auth/package-health` | Spec + health |

**Invariant:** No API accepts or returns plaintext note title/body or Kanban board/card content.

---

## Client-only capabilities

| Feature | Status | Notes |
|---------|--------|--------|
| On-device voice dictation | Shipped | Whisper via transformers.js; optional `NEXT_PUBLIC_VOICE_*` |
| Audio file upload transcribe | Shipped | On-device decode ladder |
| Encrypted local drafts | Shipped | IndexedDB; not server plaintext |
| Vault auto-lock | Shipped | Client session timer |
| Passkey PRF vault unlock | Shipped | vault-core 1.3 candidates; synced credentials may have bounded compatibility variants and several HttpOnly-cookie browser bindings; bulk vault reset preserves account sign-in passkeys |
| Note Kanban generation | Shipped | Deterministic on-device parsing of decrypted note markdown; no LLM/plaintext egress |
| Note ↔ Kanban bidirectional sync | Shipped | Note-bound boards sync checklist/list structure and card state client-side (debounced); encryption unchanged |
| MCP AI integrations | Shipped (when `INTEGRATIONS_ENABLED`) | Local MCP server + optional bridge; scoped read/write on shared notes/boards only |

---

## Background jobs / cron

| Job | Status |
|-----|--------|
| Server cron / scheduled tasks | **None** in this repo |
| Rate limit bucket cleanup | DB-backed when `RATE_LIMIT_STORE=postgres` |

---

## External integrations

| Integration | Purpose | Config |
|-------------|---------|--------|
| PostgreSQL | Primary datastore | `DATABASE_URL` |
| SMTP / email provider | Verification, reset | `EMAIL_*`, `SMTP_*` |
| OAuth providers | Google, Apple, GitHub, Microsoft | `AUTH_*` / provider secrets |
| Hugging Face CDN (optional) | Voice model weights | Default or `NEXT_PUBLIC_VOICE_MODEL_HOST` |
| MCP clients (Cursor, Claude, Codex) | Scoped note/board access via local stdio server | `packages/selahkeep-mcp`; credentials from `/settings/integrations` |
| Vercel (typical hosting) | Deploy | Dashboard; not in release workflow |

---

## Feature flags / env gates

| Variable | Effect |
|----------|--------|
| `NEXT_PUBLIC_VOICE_NOTES_ENABLED=false` | Hides dictation |
| `ENABLE_API_DOCS=true` | Swagger in production |
| `INTEGRATIONS_ENABLED=true` | Enables `/settings/integrations` and `/api/integrations*` |
| `EMAIL_PROVIDER=console` | Dev-only email (blocked in prod) |

---

## Planned / not on this surface

- Public letter sharing (removed; `letters` domain retired)
- Trusted devices as separate vault unlock path (removed)
- Server-side autosave of plaintext drafts
- Automated GitHub Releases or deploy on tag push

See [`LGPD_BETA_GATES.md`](./LGPD_BETA_GATES.md) for beta readiness gaps.
