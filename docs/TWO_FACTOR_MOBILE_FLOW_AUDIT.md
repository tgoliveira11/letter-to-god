# Two-Factor Mobile Flow Audit — SelahKeep

| Field | Value |
|-------|--------|
| **Product** | SelahKeep |
| **Date** | 2026-06-18 |
| **Scope** | Account TOTP 2FA challenge (`/login/2fa`), layout chrome, mobile redirect, callback sanitization |

---

## Summary

Two bugs affected the account 2FA challenge flow:

1. **Layout:** Pending 2FA sessions showed the fully authenticated header (Notes, Vault, Account, Sign out, Vault Status Dock).
2. **Mobile OAuth stuck:** After OAuth + TOTP verification, the package `OAuthTwoFactorForm` called `router.push` immediately after `session.update`, before the JWT cookie reflected `twoFactorVerified`. `src/proxy.ts` redirected back to `/login/2fa`, causing a loop on mobile browsers.

Credentials login (`?mode=credentials` → native POST → `/login/complete`) was unaffected.

---

## Root causes

### Logged-in menu on 2FA page

- `(auth)/layout.tsx` wraps pages in `SiteShell` → `AppHeaderChrome` → `Nav`.
- `Nav` treated any truthy `useSession().data` as fully authenticated.
- During pending 2FA, NextAuth returns `status: "authenticated"` with `twoFactorPending: true` and `twoFactorVerified: false`.
- Result: authenticated chrome rendered on `/login/2fa`.

### Mobile OAuth redirect loop

- Package `OAuthTwoFactorForm` (`@tgoliveira/secure-auth` 0.1.25):
  1. `authLoginApi.verifyOAuthTwoFactor`
  2. `await update({ twoFactorUpgradeToken })`
  3. `router.push(afterLoginPath)` — **immediate client navigation**
- Proxy reads JWT from the **cookie**, which may still show `twoFactorPending` when step 3 runs.
- User is redirected back to `/login/2fa` → appears stuck on mobile.

**Package change not required:** App-side `OAuthTwoFactorChallenge` waits for `getSession()` to report a fully authenticated session before navigating, with `window.location.assign` fallback.

---

## Fixes implemented

| Area | Change |
|------|--------|
| Session helpers | `src/lib/auth/session-state.ts` — `isFullyAuthenticatedSession`, `isPendingTwoFactorSession` |
| Layout | `Nav`, `AppHeaderChrome` use session helpers; pending 2FA shows pre-auth header |
| Callback sanitization | `src/lib/auth/safe-auth-callback.ts` — `sanitizeAuthCallbackUrl` (extends vault return-to patterns; blocks `/login`, `/login/2fa`, `/auth/two-factor`) |
| 2FA page | App-owned `/login/2fa` with package `CredentialsTwoFactorForm` + app `OAuthTwoFactorChallenge` |
| Proxy | Preserves safe `callbackUrl` when redirecting pending 2FA to `/login/2fa` |
| Login complete | Reads and sanitizes `callbackUrl` / `returnTo` from search params |
| Copy | `authPageMessages.loginTwoFactorTitle` → "Two-factor verification"; button "Verify and continue" |

---

## Security behavior (unchanged intent)

- Pending 2FA sessions **cannot** access protected app routes (`src/proxy.ts` gate).
- TOTP codes and backup codes are **never logged**.
- Callback URLs restricted to safe in-app paths; external and auth-loop targets default to `/notes`.
- Vault cryptography and note encryption **unchanged**.
- No 2FA bypass, auto-complete, or Trusted Devices reintroduction.

---

## Credentials vs OAuth modes

| Mode | Trigger | Flow |
|------|---------|------|
| `?mode=credentials` | Password / passkey login requiring TOTP | Native POST → `/login/complete` → `login-token` provider |
| OAuth (default) | Google / Apple / Microsoft with TOTP enabled | App `OAuthTwoFactorChallenge` → `verify-2fa-oauth` → session upgrade → safe redirect |

Passkey sign-in completes the package TOTP flow when account 2FA is enabled. The optional vault
hook runs only after secure-auth creates the final session, never from the partial challenge.

---

## Tests

- `src/test/unit/session-state.test.ts`
- `src/test/unit/safe-auth-callback.test.ts`
- `src/test/features/two-factor-challenge.test.tsx`
- `src/test/features/login-2fa-page.test.tsx`
- `src/test/features/site-layout.test.tsx` (pending 2FA header)
- `src/test/unit/proxy.test.ts` (callback preservation)

---

## Remaining risks

- Package `OAuthTwoFactorForm` still has the race if used directly elsewhere — app page no longer uses it for OAuth mode.
- Session poll timeout (5s) falls back to hard navigation; rare slow networks may full-reload instead of SPA transition.
- `sanitizeAuthCallbackUrl` reuses vault return-to allowlist; new post-login destinations must be added explicitly.

---

## References

- [`ARCHITECTURE.md`](../ARCHITECTURE.md) — account 2FA section
- [`SECURITY.md`](../SECURITY.md) — TOTP account sign-in
- [`docs/API_REFERENCE.md`](./API_REFERENCE.md) — verify-2fa routes
- Package: `@tgoliveira/secure-auth` `LoginTwoFactorPage`, `OAuthTwoFactorForm`
