# Vercel environment variables — SelahKeep

> Former working name: LTG Vault. Current product name: SelahKeep. Production domain: `selahkeep.com`.

Complete checklist for deploying this app on [Vercel](https://vercel.com). Values were derived from the codebase (not guessed): `.env.example`, `src/lib/env/secure-auth-from-env.ts`, `src/lib/secure-auth.ts`, email modules, WebAuthn config, Drizzle, and product services.

**Configure in:** Vercel Project → **Settings** → **Environment Variables**

Set variables per target: **Production**, **Preview**, and/or **Development** (Vercel CLI). After changing variables, **redeploy** for them to take effect.

**Security:** Never commit real secrets. Use placeholders in docs and `.env.example` only.

---

## Build vs runtime

| Phase | Secrets required? |
|-------|-------------------|
| `npm run build` on Vercel | **No** — root layout uses build-safe UI config; `secureAuth` initializes lazily at runtime |
| Serving traffic (API routes, auth, DB) | **Yes** — see [Required for production runtime](#required-for-production-runtime) |

Local `drizzle-kit` (`npm run db:migrate`) reads `DATABASE_URL` from `.env.local` via `loadEnvFiles()` — that loader is **not** used by the Next.js app on Vercel.

---

## Required for production runtime

| Variable | Required? | Environments | Example value | Used by | Purpose | Notes |
|----------|-----------|--------------|---------------|---------|---------|-------|
| `DATABASE_URL` | **Required** | Production, Preview | `postgresql://USER:PASSWORD@HOST:5432/DATABASE?sslmode=require` | `src/lib/db/*`, Drizzle, `@tgoliveira/secure-auth` | PostgreSQL connection | Use a managed Postgres (Neon, Supabase, RDS, etc.). Run migrations before or as part of deploy (`npm run db:migrate`). |
| `NEXTAUTH_SECRET` | **Required** | Production, Preview | `<generated-secret>` | `buildSecureAuthConfigFromEnv`, `src/proxy.ts`, session/login hashing | NextAuth JWT signing and app security peppers | Generate: `openssl rand -base64 32`. No `AUTH_SECRET` variable is used in this repo. |
| `TWO_FACTOR_SECRET_ENCRYPTION_KEY` | **Required** | Production, Preview | `<generated-secret>` | `buildSecureAuthConfigFromEnv`, TOTP/backup-code crypto | Encrypt TOTP secrets at rest | Generate: `openssl rand -base64 32`. Required even if no user enables 2FA — `secureAuth` fails to initialize without it. Key is SHA-256 hashed before use (any non-empty string works; use a strong random value). |
| `APP_BASE_URL` | **Required** | Production, Preview | `https://www.selahkeep.com` | `buildSecureAuthConfigFromEnv`, email links, OAuth redirects | Canonical public origin (no trailing slash) | Must match the browser URL users visit. Wrong value breaks email links, OAuth callbacks, and WebAuthn. Legacy fallback: `NEXTAUTH_URL`. Default if unset: `http://localhost:3001` (wrong for Vercel). |
| `EMAIL_PROVIDER` | **Required** (not `console`) | Production | `smtp` | `src/modules/email/core/*` | Email delivery mode | **`Do not use `EMAIL_PROVIDER=console` in production.** Console only logs; no delivery. `resend` and `sendgrid` are recognized but **not implemented** — use `smtp`. |
| `EMAIL_FROM` | **Required** when `EMAIL_PROVIDER≠console` | Production, Preview | `SelahKeep <noreply@selahkeep.com>` | `secureAuth` email config, `sendEmail()` | SMTP From header | Required for non-console providers (`assertEmailDeliveryConfig`). |

---

## Required when feature is enabled

### SMTP email (`EMAIL_PROVIDER=smtp`)

| Variable | Required? | Environments | Example value | Used by | Purpose | Notes |
|----------|-----------|--------------|---------------|---------|---------|-------|
| `SMTP_HOST` | **Required** if `smtp` | Production, Preview | `smtp-relay.brevo.com` | `getSmtpConfig()` | SMTP server hostname | Throws if missing when provider is `smtp`. |
| `SMTP_PORT` | Optional | Production, Preview | `587` | `getSmtpConfig()` | SMTP port | Default `587` if unset. |
| `SMTP_SECURE` | Optional | Production, Preview | `false` | `getSmtpConfig()` | TLS mode | Set `true` for typical port `465`. |
| `SMTP_USER` | **Required** for remote hosts | Production | `<smtp-login>` | `getSmtpConfig()` | SMTP auth user | Not required for `localhost` / `127.0.0.1` (Mailpit). |
| `SMTP_PASSWORD` | **Required** for remote hosts | Production | `<smtp-password>` | `getSmtpConfig()` | SMTP auth password | Not required for local Mailpit. |

### Google OAuth

| Variable | Required? | Environments | Example value | Used by | Purpose | Notes |
|----------|-----------|--------------|---------------|---------|---------|-------|
| `AUTH_GOOGLE_CLIENT_ID` | **Required** if Google enabled | Production, Preview | `<provider-client-id>` | `buildSecureAuthConfigFromEnv` → secure-auth | Google OAuth client ID | Legacy: `GOOGLE_CLIENT_ID`. Provider is enabled only when **both** ID and secret are set. |
| `AUTH_GOOGLE_CLIENT_SECRET` | **Required** if Google enabled | Production, Preview | `<provider-client-secret>` | secure-auth | Google OAuth client secret | Legacy: `GOOGLE_CLIENT_SECRET`. |

**Callback URL (production example):**

```text
https://www.selahkeep.com/api/auth/callback/google
```

### Apple OAuth

| Variable | Required? | Environments | Example value | Used by | Purpose | Notes |
|----------|-----------|--------------|---------------|---------|---------|-------|
| `AUTH_APPLE_CLIENT_ID` | **Required** if Apple enabled | Production, Preview | `<apple-services-id>` | secure-auth config | Apple Sign In client ID | Legacy: `APPLE_CLIENT_ID`. |
| `AUTH_APPLE_CLIENT_SECRET` | **Required** if Apple enabled | Production, Preview | `<apple-client-secret-jwt>` | secure-auth config | Apple client secret | Legacy: `APPLE_CLIENT_SECRET`. This app does **not** read `AUTH_APPLE_TEAM_ID`, `AUTH_APPLE_KEY_ID`, or `AUTH_APPLE_PRIVATE_KEY` directly — NextAuth expects the secret JWT in `AUTH_APPLE_CLIENT_SECRET`. |

**Callback URL (production example):**

```text
https://www.selahkeep.com/api/auth/callback/apple
```

### Microsoft OAuth (Entra ID / Azure AD)

| Variable | Required? | Environments | Example value | Used by | Purpose | Notes |
|----------|-----------|--------------|---------------|---------|---------|-------|
| `AUTH_MICROSOFT_CLIENT_ID` | **Required** if Microsoft enabled | Production, Preview | `<application-client-id-guid>` | secure-auth | Entra application (client) ID | Legacy: `AUTH_AZURE_AD_ID`. |
| `AUTH_MICROSOFT_CLIENT_SECRET` | **Required** if Microsoft enabled | Production, Preview | `<client-secret-value>` | secure-auth | Entra client secret | Legacy: `AUTH_AZURE_AD_SECRET`. |
| `AUTH_MICROSOFT_TENANT_ID` | Optional | Production, Preview | `common` | secure-auth | Entra tenant | Default `common`. Legacy: `AUTH_AZURE_AD_TENANT_ID`. |

**Callback URL (production example)** — NextAuth provider ID is `azure-ad`, **not** `microsoft`:

```text
https://www.selahkeep.com/api/auth/callback/azure-ad
```

Register as a **Web** platform redirect URI in Microsoft Entra (not SPA-only).

### WebAuthn / passkeys (account sign-in and vault unlock)

| Variable | Required? | Environments | Example value | Used by | Purpose | Notes |
|----------|-----------|--------------|---------------|---------|---------|-------|
| `APP_BASE_URL` | **Required** | Production, Preview | `https://www.selahkeep.com` | WebAuthn origin fallback | Canonical site URL | **Must match the hostname in your browser address bar.** The apex domain redirects to `www`, so production must use the `www` origin. |
| `WEBAUTHN_RP_ID` | Optional | Production, Preview | `selahkeep.com` | secure-auth, passkeys | Relying party ID | Hostname only (no `https://`). When unset, derived from `WEBAUTHN_ORIGIN` / `APP_BASE_URL`. **Must match the site you visit** (or be a parent domain, e.g. `example.com` for `www.example.com`). |
| `WEBAUTHN_ORIGIN` | Optional | Production, Preview | `https://www.selahkeep.com` | secure-auth, passkeys | WebAuthn origin | Full origin with scheme, no trailing slash. Defaults to `APP_BASE_URL`. |
| `WEBAUTHN_RP_NAME` | Optional | Production, Preview | `SelahKeep` | passkey UI | Display name | Default `APP_NAME`. |

**Common mistake:** configuring `WEBAUTHN_ORIGIN=https://selahkeep.com` while the apex domain redirects users to `https://www.selahkeep.com`. WebAuthn origin verification is exact and rejects the `www` ceremony response. `WEBAUTHN_RP_ID=selahkeep.com` remains correct because an RP ID may be the registrable parent domain.

**Fix:** Set all of these to the **same host you actually use**:

```text
# Custom domain example
APP_BASE_URL=https://www.selahkeep.com
WEBAUTHN_ORIGIN=https://www.selahkeep.com
WEBAUTHN_RP_ID=selahkeep.com

# Default Vercel domain example (only if users open this URL)
APP_BASE_URL=https://www.selahkeep.com
WEBAUTHN_ORIGIN=https://www.selahkeep.com
WEBAUTHN_RP_ID=selahkeep.com
```

Preview deployments each have a unique `*.vercel.app` hostname unless you use a fixed staging domain. Passkeys registered on production will not work on a different preview URL.

### Portable vault broker

Apply migration `0024_portable_vault_broker.sql` before enabling these variables. Production and
Preview must use separate signing keys, receipt keys, opaque subject keys, broker registrations,
and databases.

| Variable | Required when enabled | Production value / format |
|---|---|---|
| `VAULT_PORTABLE_BROKER_ENABLED` | Yes | `true` only after migration and broker registration |
| `VAULT_PORTABLE_BROKER_URL` | Yes | `https://vault-broker-green.vercel.app` |
| `VAULT_LEGACY_PASSKEY_PRF_ENROLLMENT_ENABLED` | Recommended explicit | `false` |
| `PORTABLE_VAULT_GRANT_ISSUER` | Yes | `https://www.selahkeep.com` |
| `PORTABLE_VAULT_BROKER_APP_ID` | Yes | `selahkeep` |
| `PORTABLE_VAULT_GRANT_AUDIENCE` | Yes | Broker origin |
| `PORTABLE_VAULT_GRANT_TTL_SECONDS` | Yes | `60` |
| `PORTABLE_VAULT_SUBJECT_KEY` | Yes, sensitive | Canonical base64url for a separate 32–64 byte random key |
| `PORTABLE_VAULT_GRANT_PRIVATE_JWK_B64` | Yes, sensitive | Base64url of the private ES256 JWK JSON; never expose to the client |
| `PORTABLE_VAULT_BROKER_RECEIPT_ISSUER` | Yes | Broker origin |
| `PORTABLE_VAULT_BROKER_RECEIPT_PUBLIC_JWKS_B64` | Yes | Base64url JSON array `[publicJwk]`, not a single object |

The private grant JWK source and receipt public JWK source are operational secret material; never
paste their decoded values into documentation, logs, tickets, or client-visible variables. See
[`PORTABLE_PASSKEY_VAULT.md`](./PORTABLE_PASSKEY_VAULT.md) for deployment and cleanup order.

### Email verification gate

| Variable | Required? | Environments | Example value | Used by | Purpose | Notes |
|----------|-----------|--------------|---------------|---------|---------|-------|
| `EMAIL_VERIFICATION_REQUIRE_BEFORE_SIGN_IN` | Optional | Production, Preview | `false` | secure-auth | Block sign-in until email verified | Default `false`. Legacy: `AUTH_REQUIRE_EMAIL_VERIFICATION_BEFORE_SIGN_IN`. |

When `true`, working SMTP (`EMAIL_PROVIDER=smtp`) is effectively required.

---

## Optional (recommended defaults)

### App identity

| Variable | Required? | Environments | Example value | Used by | Purpose | Notes |
|----------|-----------|--------------|---------------|---------|---------|-------|
| `APP_NAME` | Optional | All | `SelahKeep` | secure-auth UI/email | Display name | Default `SelahKeep`. |
| `APP_SLUG` | Optional | All | `letters-to-god` | secure-auth | Stable app slug | Default `letters-to-god`. |
| `NEXTAUTH_URL` | Optional | Preview | `https://<preview-host>` | Legacy base URL fallback | Same role as `APP_BASE_URL` | Prefer `APP_BASE_URL`. Still read by email config and WebAuthn fallbacks. |
| `AUTH_AFTER_LOGIN_PATH` | Optional | All | `/notes` | secure-auth | Post-login redirect | Default `/notes`. |
| `AUTH_AFTER_LOGOUT_PATH` | Optional | All | `/login` | secure-auth | Post-logout redirect | Default `/login`. |
| `AUTH_REDIRECT_AUTHENTICATED_FROM_GUEST_PAGES` | Optional | All | `true` | secure-auth UI + `proxy.ts` | Redirect signed-in users away from `/login`, `/register`, `/forgot-password` | Default `true`. Set `false` only for intentional re-login while signed in. |
| `AUTH_AUTHENTICATED_REDIRECT_PATH` | Optional | All | `/notes` | secure-auth UI + `proxy.ts` | Destination when redirecting authenticated users off guest auth pages | Defaults to `AUTH_AFTER_LOGIN_PATH` (`/notes`). |

### API security (secure-auth 0.1.21+)

| Variable | Required? | Environments | Example value | Used by | Purpose | Notes |
|----------|-----------|--------------|---------------|---------|---------|-------|
| `EMAIL_VERIFICATION_REQUIRE_FOR_ACCOUNT_APIS` | Optional | Production, Preview | `true` | secure-auth package handlers | Reject sensitive account APIs when session email is unverified | Default `true`. Returns 403 with verification message when enabled. |
| `AUTH_SAME_ORIGIN_PROTECTION_ENABLED` | Optional | Production, Preview | `true` | secure-auth package handlers | Reject cross-origin mutating account API requests | Default `true`. Set `APP_BASE_URL` / `NEXTAUTH_URL` correctly in each environment. |
| `AUTH_ALLOWED_ORIGINS` | Optional | Preview | `https://staging.example.com` | secure-auth | Extra allowed origins (comma-separated) | In addition to `APP_BASE_URL` and WebAuthn origin. |
| `AUTH_DEBUG_EXPOSE_TRACE_ROUTE` | Optional | Never in prod | `false` | secure-auth | Expose `GET /api/auth/login/trace` | Default `false`. Requires `AUTH_TRACE=true` as well. Never enable in production. |

### Admin platform (secure-auth 0.4.1+)

| Variable | Required? | Environments | Example value | Used by | Purpose | Notes |
|----------|-----------|--------------|---------------|---------|---------|-------|
| `AUTH_ADMIN_ENABLED` | Optional | Production, Preview | `true` | secure-auth + `src/proxy.ts` | Enable `/admin` UI and `/api/auth/admin/*` | Default `false`. When off, admin routes are not gated by proxy. |
| `AUTH_ADMIN_PATH` | Optional | All | `/admin` | secure-auth UI paths | Admin panel URL prefix | Default `/admin`. |
| `ADMIN_BOOTSTRAP_EMAIL` | Optional | Production | `tgoliveira11@gmail.com` | secure-auth + app bootstrap | Grant admin access to this account | App promotes this email to `role=admin` on `/admin` load and before secure-auth admin APIs (idempotent). Package bootstrap also promotes when no admin exists yet. |
| `AUTH_ADMIN_CONFIG_CACHE_TTL_SECONDS` | Optional | All | `60` | secure-auth admin | In-memory config override cache TTL | `0` disables cache. |
| `OUTPOST_ADMIN_ENABLED` | Optional | Production, Preview | `true` | outpost admin + routes | Enable `/admin/outpost` and `/api/outpost/admin/*` | Defaults to `AUTH_ADMIN_ENABLED` when unset. |
| `OUTPOST_ADMIN_PATH` | Optional | All | `/admin/outpost` | Outpost UI paths | Outpost admin panel URL prefix | Used by `OutpostUIProvider`. |
| `OUTPOST_RECIPIENT_HMAC_KEY` | Recommended | Production | *(secret)* | `createOutpost` | HMAC key for recipient hashing / suppression | ≥16 bytes entropy; required for production outbox. Falls back to `NEXTAUTH_SECRET` in dev only. |
| `OUTPOST_ADMIN_CONFIG_CACHE_TTL_SECONDS` | Optional | All | `60` | outpost admin config service | Config override cache TTL | `0` disables cache. |
| `AUTH_ACCOUNT_LOCKOUT_ENABLED` | Optional | All | `false` | secure-auth + `/admin/locks` | Progressive login lockout | Requires migration `0014_secure_auth_admin_platform.sql`. |
| `AUTH_INVITES_ENABLED` | Optional | All | `false` | secure-auth + admin waitlist/invites | Invite / waitlist system | Enable for waitlist and invite admin pages. |
| `AUTH_INVITES_REQUIRE_APPROVAL` | Optional | All | `false` | secure-auth | New users start as pending | Admin approves via `/admin/waitlist`. |
| `AUTH_INVITES_REQUIRE_CODE` | Optional | All | `false` | secure-auth | Registration requires invite code | |
| `AUTH_INVITES_DEFAULT_QUOTA` | Optional | All | `0` | secure-auth | Invite codes per approved user | |
| `AUTH_INVITES_CODE_EXPIRY_DAYS` | Optional | All | `30` | secure-auth | Invite code validity | |
| `AUTH_API_KEYS_ENABLED` | Optional | All | `false` | secure-auth + `/admin/api-keys` | Machine-to-machine API keys | |

### Sessions

| Variable | Required? | Environments | Example value | Used by | Purpose | Notes |
|----------|-----------|--------------|---------------|---------|---------|-------|
| `AUTH_SESSION_MAX_AGE_SECONDS` | Optional | Production, Preview | `2592000` | secure-auth (`@tgoliveira/secure-auth`) | Account session JWT max age (seconds) | Default 30 days. |
| `AUTH_SESSION_LAST_USED_UPDATE_SECONDS` | Optional | Production, Preview | `300` | secure-auth | Throttle session `last_used_at` DB writes | Legacy product name: `SESSION_LAST_USED_UPDATE_INTERVAL_SECONDS` (used by `src/modules/sessions/lib/session-config.ts` for product session helpers). Prefer `AUTH_*` for secure-auth. |
| `AUTH_SINGLE_ACTIVE_SESSION` | Optional | Production | `false` | secure-auth UI + sessions | One active account session per user | Default `false`. When `true`, set `AUTH_SESSION_REVOCATION_POLL_SECONDS` (default `10`). |
| `AUTH_SESSION_REVOCATION_POLL_SECONDS` | Optional | Production | `10` | secure-auth UI `SessionProvider` | Client poll interval for session revocation | Default `10` when single active session enabled, else `0`. |
| `NEXTAUTH_SESSION_MAX_AGE` | Optional | Legacy | `2592000` | `src/modules/sessions/lib/session-config.ts` | Product session expiry helper | **Separate** from `AUTH_SESSION_MAX_AGE_SECONDS`. Only affects product `getSessionMaxAgeMs()` if called; secure-auth uses `AUTH_SESSION_MAX_AGE_SECONDS`. |

### Rate limiting

| Variable | Required? | Environments | Example value | Used by | Purpose | Notes |
|----------|-----------|--------------|---------------|---------|---------|-------|
| `AUTH_RATE_LIMIT_STORE` | **Required** `postgres` in prod (0.5.0+) | Production | `postgres` | secure-auth login/register/reset limits | Auth rate-limit backend | Default `memory`. **Production startup fails** if not `postgres` (secure-auth 0.5.0+). Legacy fallback name for auth: `RATE_LIMIT_STORE` (see below). |
| `RATE_LIMIT_STORE` | **Required** `postgres` in prod (0.5.0+) | Production | `postgres` | `src/modules/rate-limit` (vault/letters APIs) | Product API rate-limit backend | Default `memory`. Same env name as auth legacy fallback — set to `postgres` for both layers in production. |

### secure-auth 0.5.0+

| Variable | Required? | Environments | Example value | Used by | Purpose | Notes |
|----------|-----------|--------------|---------------|---------|---------|-------|
| `AUTH_TRUST_FORWARDED_HEADERS` | Optional | Production (Vercel) | `true` | secure-auth | Trust `X-Forwarded-For` / `X-Real-IP` for rate limits and audit | Default `false`. Enable only behind a trusted edge (e.g. Vercel). |
| `AUTH_MAGIC_LINK_ENABLED` | Optional | All | `false` | secure-auth | Passwordless email sign-in | Requires delegate routes `/api/auth/magic-link/*` and page `/login/magic-link`. |
| `AUTH_PROFILE_ENABLED` | Optional | All | `false` | secure-auth | Extended profile settings | When enabled, wire profile page per package consumer docs. |
| `AUTH_SECURITY_NOTIFICATIONS_ENABLED` | Optional | All | `true` | secure-auth | Email on security-sensitive account events | Default `true`. |
| `AUTH_PASSWORD_HIBP_ENABLED` | Optional | All | `true` | secure-auth | Have I Been Pwned breach check on password set/change | Default `true`. Set `false` to disable outbound HIBP lookups. |

### Password policy

Preferred names are `AUTH_*`; legacy `PASSWORD_*` names are still read.

| Variable | Required? | Environments | Example value | Used by | Purpose | Notes |
|----------|-----------|--------------|---------------|---------|---------|-------|
| `AUTH_PASSWORD_POLICY_ENFORCEMENT` | Optional | Production | `warn` | secure-auth UI + API | `off` \| `warn` \| `enforce` | Default `warn`. Legacy: `PASSWORD_POLICY_ENFORCEMENT`. |
| `AUTH_PASSWORD_MIN_LENGTH` | Optional | Production | `12` | secure-auth all password forms | Minimum password length | Range 1–128. Legacy: `PASSWORD_MIN_LENGTH`. |
| `AUTH_PASSWORD_REQUIRE_UPPERCASE` | Optional | Production | `false` | secure-auth | Require uppercase | Legacy: `PASSWORD_REQUIRE_UPPERCASE`. |
| `AUTH_PASSWORD_REQUIRE_LOWERCASE` | Optional | Production | `false` | secure-auth | Require lowercase | Legacy: `PASSWORD_REQUIRE_LOWERCASE`. |
| `AUTH_PASSWORD_REQUIRE_NUMBER` | Optional | Production | `false` | secure-auth | Require digit | Legacy: `PASSWORD_REQUIRE_NUMBER`. |
| `AUTH_PASSWORD_REQUIRE_SYMBOL` | Optional | Production | `false` | secure-auth | Require symbol | Legacy: `PASSWORD_REQUIRE_SYMBOL`. |
| `AUTH_PASSWORD_BLOCK_COMMON_PASSWORDS` | Optional | Production | `true` | secure-auth | Block common passwords | Legacy: `PASSWORD_BLOCK_COMMON_PASSWORDS`. |
| `AUTH_PASSWORD_MIN_SCORE` | Optional | Production | `2` | secure-auth | zxcvbn-style min score 0–4 | Legacy: `PASSWORD_MIN_SCORE`. |
| `AUTH_PASSWORD_STRENGTH_POSITION` | Optional | All | `above` | secure-auth UI | Strength meter position | `above` \| `below`. |

### Vault password policy (SelahKeep `/vault/setup` only — not account auth)

Mapped in `src/lib/config/vault-password-policy.ts` and passed explicitly to `PasswordSetupFields`. The secure-auth package does **not** read these env vars.

| Variable | Required? | Environments | Example value | Used by | Purpose | Notes |
|----------|-----------|--------------|---------------|---------|---------|-------|
| `VAULT_PASSWORD_ENFORCEMENT` | Optional | Production | `enforce` | `/vault/setup` | `off` \| `warn` \| `enforce` | Default `enforce` for vault setup. |
| `VAULT_PASSWORD_MIN_LENGTH` | Optional | Production | `16` | `/vault/setup` | Minimum vault password length | Default `16`. Separate from `AUTH_PASSWORD_MIN_LENGTH`. |
| `VAULT_PASSWORD_REQUIRE_UPPERCASE` | Optional | Production | `false` | `/vault/setup` | Require uppercase | |
| `VAULT_PASSWORD_REQUIRE_LOWERCASE` | Optional | Production | `false` | `/vault/setup` | Require lowercase | |
| `VAULT_PASSWORD_REQUIRE_NUMBER` | Optional | Production | `false` | `/vault/setup` | Require digit | |
| `VAULT_PASSWORD_REQUIRE_SYMBOL` | Optional | Production | `false` | `/vault/setup` | Require symbol | |
| `VAULT_PASSWORD_BLOCK_COMMON_PASSWORDS` | Optional | Production | `true` | `/vault/setup` | Block common passwords | |
| `VAULT_PASSWORD_MIN_SCORE` | Optional | Production | `2` | `/vault/setup` | Strength min score 0–4 | |
| `VAULT_EMERGENCY_MODE_ENABLED` | Optional | All | `false` | vault-core admin config | Emergency/duress package gate | Keep `false`. SelahKeep does not ship the app-owned decoy persistence/routing/exit workflow, so enabling the package flag alone is unsupported. |

### Cookies, email registration, debug, product limits

| Variable | Required? | Environments | Example value | Used by | Purpose | Notes |
|----------|-----------|--------------|---------------|---------|---------|-------|
| `AUTH_COOKIE_SECURE` | Optional | Production | `true` | secure-auth | Secure session cookies | Unset → `true` when `NODE_ENV=production`. |
| `EMAIL_VERIFICATION_SEND_ON_REGISTER` | Optional | Production | `true` | secure-auth | Send verification email on register | Default `true`. Needs working SMTP if users must verify. |
| `AUTH_TRACE` | Optional | Never in prod | `false` | secure-auth | Auth debug trace | Default `false`. |
| `ENABLE_API_DOCS` | Optional | Production | `false` | `src/app/api-docs/page.tsx` | Expose `/api-docs` Swagger UI | Disabled in production unless `true`. |

---

## Local-only / do not set on Vercel

| Variable | Classification | Notes |
|----------|----------------|-------|
| `.env.local` file | **Local-only** | Used by local dev and Drizzle CLI via `loadEnvFiles()`. Vercel injects env vars from the dashboard instead. |
| `TEST_*` (e.g. vitest) | **Do not set** | Test-only; set in `src/test/setup.ts`. |
| `EMAIL_PROVIDER=console` | **Do not set in production** | Allowed locally; warns in production and does not deliver mail. |

---

## Vercel / Node (managed)

| Variable | Set manually? | Notes |
|----------|---------------|-------|
| `NODE_ENV` | **No** — Vercel sets `production` | Used for CSP headers (`next.config.ts`), cookie secure default, console email guard. |
| `VERCEL` | **No** | Set by Vercel; not read by application code. |
| `VERCEL_URL` | **No** (not read by app) | Preview hostname helper. App does **not** auto-derive `APP_BASE_URL` from it — set `APP_BASE_URL` explicitly per environment (e.g. production custom domain vs preview URL). |

There are **no `NEXT_PUBLIC_*` variables** in this repository.

---

## OAuth callback URLs (production checklist)

Replace the host with your production domain (example: `selahkeep.com`):

| Provider | Callback path |
|----------|----------------|
| Google | `https://www.selahkeep.com/api/auth/callback/google` |
| Apple | `https://www.selahkeep.com/api/auth/callback/apple` |
| Microsoft (Entra) | `https://www.selahkeep.com/api/auth/callback/azure-ad` |

For **Preview** deployments, register preview URLs in each provider console or use separate OAuth apps for staging.

---

## Minimal Vercel Production checklist

```text
DATABASE_URL=<postgresql-connection-string>
NEXTAUTH_SECRET=<openssl rand -base64 32>
TWO_FACTOR_SECRET_ENCRYPTION_KEY=<openssl rand -base64 32>
APP_BASE_URL=https://www.selahkeep.com
EMAIL_PROVIDER=smtp
EMAIL_FROM=SelahKeep <noreply@selahkeep.com>
SMTP_HOST=<smtp-host>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<smtp-user>
SMTP_PASSWORD=<smtp-password>
WEBAUTHN_RP_ID=selahkeep.com
WEBAUTHN_ORIGIN=https://www.selahkeep.com
AUTH_RATE_LIMIT_STORE=postgres
RATE_LIMIT_STORE=postgres
VAULT_EMERGENCY_MODE_ENABLED=false
```

Add OAuth variables only for providers you enable. Run database migrations against `DATABASE_URL` before first production traffic.

---

## Vercel deployment readiness (Phase 0)

| Check | Status |
|-------|--------|
| `npm install` without `--legacy-peer-deps` | Passes (`nodemailer@9.x` satisfies Outpost peer; `next-auth` uses project override) |
| `package-lock.json` committed | Yes |
| No `file:` or tarball auth dependency | `@tgoliveira/secure-auth@0.5.0` from npm registry |
| Private registry | Public npm scope `@tgoliveira` — no extra `.npmrc` required for Vercel |
| Local `npm run build` | Passes |
| Production domain | `https://www.selahkeep.com` |
| Package health | `GET /api/auth/package-health` → `version: 0.5.0` |
| Production deploy validated | **Not re-run in this phase** — redeploy after env review |

---

## Health check

After deploy:

```bash
curl https://www.selahkeep.com/api/auth/package-health
```

Expect `{ "ok": true, "package": "@tgoliveira/secure-auth", "version": "0.5.0" }` when runtime secrets and DB are configured.

---

## Related docs

- [`.env.example`](../.env.example) — local template (placeholders only)
- [`docs/LTG_VAULT_MVP_ACCEPTANCE_CHECKLIST.md`](./LTG_VAULT_MVP_ACCEPTANCE_CHECKLIST.md)
- [`README.md`](../README.md) — email, OAuth, WebAuthn setup

---

## Ambiguities / human confirmation

| Topic | Notes |
|-------|-------|
| Production domain | `https://www.selahkeep.com`; the apex domain redirects to this canonical host. |
| Preview `APP_BASE_URL` | Must match each preview URL or auth/email/passkeys will break unless you use a fixed staging domain. |
| `resend` / `sendgrid` | Listed in `EmailProvider` type but throw at runtime — **not supported** yet. |
| Apple Sign In | Only `AUTH_APPLE_CLIENT_ID` + `AUTH_APPLE_CLIENT_SECRET` are wired; generating the Apple JWT secret is external to this repo. |
| Session env duplication | `AUTH_SESSION_MAX_AGE_SECONDS` (secure-auth) vs `NEXTAUTH_SESSION_MAX_AGE` (legacy product helper) — prefer `AUTH_*` for new deploys. |
