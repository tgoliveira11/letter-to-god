# API Reference (OpenAPI / Swagger)

The Private Letters Vault MVP exposes a REST API under `/api/*`. You can browse it in a **Swagger UI** locally or import the OpenAPI spec into other tools.

## Swagger UI (local)

1. Start the app:

   ```bash
   npm run dev
   ```

2. Open **[http://localhost:3001/api-docs](http://localhost:3001/api-docs)**

   Swagger UI assets are served from `/swagger-ui/*` (copied from `swagger-ui-dist` on `npm install`) so they work with the app's Content-Security-Policy.

3. For authenticated routes, **sign in to the web app first** in the same browser (NextAuth session cookie). Then use **Try it out** in Swagger UI.

Swagger UI is **disabled in production** unless you set:

```bash
ENABLE_API_DOCS=true
```

The `/api-docs` page intentionally **does not use `SiteShell`** (`Nav` / `SiteFooter`) so Swagger UI can use the full viewport. It still inherits the root skip link and sets `id="main-content"` on its `<main>`. See `ARCHITECTURE.md` for rationale.

## OpenAPI spec file

| Resource | URL / path |
|----------|------------|
| YAML source (repo) | `docs/openapi.yaml` |
| JSON at runtime | `GET http://localhost:3001/api/openapi` |

Import `docs/openapi.yaml` or the JSON URL into:

- [Postman](https://www.postman.com/) (Import → OpenAPI)
- [Insomnia](https://insomnia.rest/)
- [Swagger Editor](https://editor.swagger.io/) (paste YAML or import file)

## Authentication in Swagger / Postman

Most routes require a **NextAuth session cookie**:

- Local dev cookie name: `next-auth.session-token`
- Production (HTTPS): often `__Secure-next-auth.session-token`

After logging in via the browser, copy the cookie from DevTools → Application → Cookies, or use Swagger UI in the same browser session so cookies are sent automatically.

Registration (`POST /api/auth/register`) and NextAuth OAuth/credentials flows are documented in ADR-005 and `docs/API_REFERENCE.md`. Interactive OAuth is easiest through the web login page. Microsoft/GitHub sign-in is account authentication only and does not unlock the vault.

### Account two-factor authentication (TOTP)

Optional account-level 2FA protects **sign-in only** — it does not decrypt private notes or replace the vault recovery phrase.

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/api/account/2fa/status` | Session |
| `POST` | `/api/account/2fa/setup/start` | Session |
| `POST` | `/api/account/2fa/setup/verify` | Session |
| `POST` | `/api/account/2fa/disable` | Session + TOTP or backup code |
| `POST` | `/api/account/2fa/backup-codes/regenerate` | Session + TOTP or backup code |
| `POST` | `/api/auth/login/start` | Public (email/password) |
| `POST` | `/api/auth/login/verify-2fa` | Public (challenge token + code) |
| `POST` | `/api/auth/login/verify-2fa-oauth` | Partial OAuth session |

Credentials login: `login/start` → optional `verify-2fa` → one-time `login-token` NextAuth provider. OAuth users (Google, Apple, Microsoft) with 2FA enabled receive a partial session until `verify-2fa-oauth` completes.

**Passkey sign-in still completes TOTP** when account 2FA is enabled. No vault hook runs from a partial session.

### Passkey account sign-in and management

Passkeys authenticate the account separately from vault decryption. A passkey unlocks private letters only when it has a valid PRF-based vault envelope.

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/api/auth/passkey/login/options` | Public |
| `POST` | `/api/auth/passkey/login/verify` | Public |
| `GET` | `/api/account/passkeys` | Session |
| `POST` | `/api/account/passkeys/register` | Session |
| `POST` | `/api/account/passkeys/:id/enable-sign-in` | Session; package-owned exact-credential promotion |
| `DELETE` | `/api/account/passkeys/:id` | Session |
| `POST` | `/api/account/passkeys/:id/enable-vault-unlock` | Session (actions `options`, `verify`, `persist`; persist requires locally unlocked vault) |
| `GET` | `/api/account/passkeys/:id/vault-unlock` | Session |
| `DELETE` | `/api/account/passkeys/:id/vault-unlock` | Session + opaque proof for locally matched variant |
| `GET` | `/api/passkeys/vault-unlock` | Session |
| `DELETE` | `/api/passkeys/vault-unlock` | Fully authenticated session; bulk-remove vault passkey capabilities/envelopes/bindings, preserving account sign-in passkeys |
| `POST` | `/api/passkeys/authenticate` | Session (actions `options`, `verify`, `bind`; `purpose: vault_unlock`) |
| `POST` | `/api/passkeys/account-registration-vault` | Fully authenticated session + short-lived HttpOnly registration proof; ciphertext only |
| `POST` | `/api/passkeys/account-login-vault-candidates` | Fully authenticated final session; encrypted candidates only |
| `DELETE` | `/api/passkeys/authenticate` | Session; unbind current browser only |
| `DELETE` | `/api/passkeys` | Legacy alias for bulk vault-passkey removal; never removes account sign-in capability |

Account authentication and vault unlock remain independent security domains, but the same credential may opt into both. `verify` returns the verified credential ID, an opaque short-lived proof, and at most five encrypted envelope candidates. PRF output stays in the browser: clients sanitize WebAuthn responses, confirm PRF against the verified ID, unwrap candidates locally, and call `bind` only after `status: matched`. Missing binding cookies use an explicit credential allow-list; quick unlock requires an exact browser binding. Compatibility repair requires local password/recovery authorization and the server never evicts an active variant implicitly.

### Vault recovery phrase

vault setup (`POST /api/vault/setup`) always creates a `recovery_phrase` envelope. Replacement while the vault is unlocked on the client:

| Method | Path | Auth | Body |
|--------|------|------|------|
| `GET` | `/api/vault/status` | Session | — includes `recoveryPhrase.createdAt`, `recoveryPhrase.replacedAt`, `phraseLength` when configured |
| `POST` | `/api/vault/recovery-phrase` | Session | `encryptedVaultKey`, `kdfMetadata`, optional `publicMetadata.phraseLength` — **no plaintext phrase** |

`POST /api/vault/recovery-phrase` atomically revokes the previous active `recovery_phrase` envelope and creates a new one. Legacy `POST /api/recovery-code` remains for older `recovery_code` envelopes only; SelahKeep `/vault/recovery` does not generate new recovery codes.

### Vault password envelope upgrades

`PUT /api/vault/password-envelope` persists a stronger Argon2id ciphertext envelope after a successful client-side password unlock recommends a KDF upgrade. The route accepts only `encryptedVaultKey` and `kdfMetadata`, validates vault AAD, and atomically revokes/replaces the prior password envelope. The vault password and UVK never leave the browser.

See `docs/ADR-005_LTG_Vault_Cryptography_Argon2id_Recovery_Phrase_Note_Keys.md` and `SECURITY.md`.

### Email verification and account passwords

Account-only flows — **no private letter content**, **no vault keys**.

| Method | Path | Auth |
|--------|------|------|
| `POST` | `/api/auth/verify-email/resend` | Public (email in body) or session |
| `POST` | `/api/auth/verify-email/confirm` | Public (`token` in body) |
| `POST` | `/api/auth/forgot-password` | Public (`email`) — generic response |
| `POST` | `/api/auth/reset-password` | Public (`action: validate` \| `reset`, `token`, `newPassword?`) |
| `POST` | `/api/account/change-password` | Session + current password |
| `GET` | `/api/account/auth-status` | Session |

Registration (`POST /api/auth/register`) creates credentials users with `email_verified_at` null and sends a verification email. Password reset updates `password_updated_at` and invalidates older JWT sessions. TOTP remains enabled after password reset.

### Account sessions

Account sessions (sign-in state) are separate from vault unlock.

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/api/account/sessions` | Session |
| `DELETE` | `/api/account/sessions/:id` | Session |
| `POST` | `/api/account/sessions/revoke-current` | Session — used on sign out |
| `POST` | `/api/account/sessions/revoke-others` | Session |
| `POST` | `/api/account/sessions/revoke-all` | Session |
| `POST` | `/api/account/sessions/ping` | Session |

Responses include masked IP and coarse browser/platform metadata only — never raw session tokens or private letter content.

### Account preferences

Preferences are package-owned account configuration and require a fully authenticated session. SelahKeep uses the namespaced vault auto-lock preference only; these routes never receive vault keys or private note content.

| Method | Path | Auth |
|--------|------|------|
| `GET`, `PATCH` | `/api/account/preferences` | Fully authenticated session |
| `GET`, `PUT`, `DELETE` | `/api/account/preferences/:key?namespace=...` | Fully authenticated session |
| `GET` | `/api/account/preferences/export` | Fully authenticated session |

**Email delivery:** transactional messages use `sendEmail()` with `EMAIL_PROVIDER=console` (dev debug), `smtp` (Mailpit locally or Brevo/staging), or future providers. Emails contain account-auth links only — never private letter content. See `README.md` for Mailpit and Brevo SMTP configuration.

### AI integrations (MCP)

User-scoped MCP access for Cursor, Claude Desktop, and Codex. Requires `INTEGRATIONS_ENABLED=true`. Session routes manage integrations; MCP routes use Bearer `sk_int_...` tokens. Server stores token hashes and encrypted grant blobs only — never IEK or plaintext note/board content.

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/api/integrations` | Session |
| `POST` | `/api/integrations` | Session — returns one-time token |
| `DELETE` | `/api/integrations/:id` | Session |
| `GET` | `/api/integrations/:id/grants` | Session |
| `PUT` | `/api/integrations/:id/grants` | Session + vault unlocked (client sends encrypted grants) |
| `GET` | `/api/integrations/mcp/notes` | Bearer integration token |
| `GET` | `/api/integrations/mcp/notes/:id` | Bearer |
| `PUT` | `/api/integrations/mcp/notes/:id` | Bearer + write grant |
| `GET` | `/api/integrations/mcp/kanban` | Bearer |
| `GET` | `/api/integrations/mcp/kanban/:boardId` | Bearer |
| `PUT` | `/api/integrations/mcp/kanban/:boardId` | Bearer + write grant |

See `docs/TDR_AI_Integrations.md` and `docs/ADR-007_Integration_Grants_MCP.md`.

### Encrypted Kanban boards

Kanban board APIs store and return encrypted blobs only. Note-bound boards reuse the note wrapped key; standalone boards use a wrapped Kanban board key. No card titles, descriptions, labels, due dates, priorities, or columns are accepted in plaintext.

| Method | Path | Auth |
|--------|------|------|
| `GET` | `/api/kanban?noteId=:noteId` | Session |
| `GET` | `/api/kanban?scope=standalone` | Session |
| `POST` | `/api/kanban` | Session |
| `GET` | `/api/kanban/:boardId` | Session |
| `PUT` | `/api/kanban/:boardId` | Session |
| `DELETE` | `/api/kanban/:boardId` | Session |
| `GET` | `/api/kanban/:boardId/versions` | Session |
| `POST` | `/api/kanban/:boardId/versions` | Session |
| `GET` | `/api/kanban/:boardId/versions/:versionId` | Session |

Missing Kanban tables return `503` via `KanbanUnavailableError` / `KanbanVersionsUnavailableError`, matching the note-version graceful migration behavior.

## Security notes

- **Never** send plaintext `title`, `body`, or similar fields — only structured `encrypted*` payloads.
- The OpenAPI spec describes **contracts**, not decrypted content. The server never decrypts private letters.
- Admin routes return metadata only (no letter ciphertext in admin summary responses beyond normal encrypted storage).

## Keeping the spec updated

When adding or changing API routes:

1. Update `docs/openapi.yaml`
2. Verify at `/api-docs` after `npm run dev`
3. Align with `docs/ADR-005_LTG_Vault_Cryptography_Argon2id_Recovery_Phrase_Note_Keys.md`

Contract tests in `src/test/api/` and security tests should remain the source of truth for behavior; OpenAPI is for human discovery and external tooling.
