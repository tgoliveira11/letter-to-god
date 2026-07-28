# SelahKeep — vault-core 1.0.0 compliance gap analysis

**Date:** 2026-07-01 (updated 2026-07-03 for `@tgoliveira/vault-core@^1.1.0`)  
**Dependency:** `@tgoliveira/vault-core@^1.1.0` (was `^1.0.1` / `^1.0.0` / `^0.2.0`)  
**Goal:** Use every screen and default integration surface shipped by vault-core; re-evaluate and reimplement all SelahKeep customizations on top of the current integration contract.

### 1.1.0 passkey PRF gap adoption (2026-07-03) — **resolved**

The historical section 7 adoption is complete for passkey PRF duplication. Current consumer
guidance is [`VAULT_CORE_1_6_ADOPTION.md`](./VAULT_CORE_1_6_ADOPTION.md):

| Removed (SelahKeep) | Replaced by (`@tgoliveira/vault-core`) |
| --- | --- |
| `vault-inner-key-material.ts` | `createPasskeyPrfEnvelopeWithSessionCache`, `cacheVaultInnerKeyMaterialAfter*Unlock`, `clearVaultInnerKeyMaterialCache` (`/browser`) |
| `normalize-prf-output.ts` | `extractPasskeyPrfOutput` (root + `/browser`) |
| `prepare-webauthn-options.ts` (logic) | `prepareWebAuthnPrfExtensions`, `alignPrfExtensionsForCredential`, `prepareVaultUnlockAuthenticationOptions` (`/browser`) |
| `passkey-transports.ts` (vault unlock pinning) | `preferPlatformTransportsForVaultUnlock` (`/browser`) |
| `use-vault-dock-passkey-available.ts` | `resolveVaultDockPasskeyAvailability` (`/react`) via `vault-dock-passkey-availability.ts` adapter |
| `legacy-envelope-unlock.ts` | `isLegacyVaultKeyEnvelope`, `unlockVaultKeyEnvelopeWithAadRouting`, `normalizeEnvelopeAadContext` (root; `legacyVaultKeyUnlock: true` on `SELAHKEEP_VAULT_PROFILE`) |
| `prf-support.ts` (iOS gate) | `isPrfExtensionSupported`, `parseAppleMobileOsMajorVersion` (`/browser`); app keeps `detectPasskeyPrfSupport` for pre-ceremony UX |
| `map-passkey-crypto-error.ts` (logic) | `classifyPasskeyCryptoError` (root) + Stillness copy in app wrapper |

**Still app-owned:** device binding (cookie + Drizzle), `SELAHKEEP_VAULT_PROFILE`, WebAuthn `purpose: "vault_unlock"`, Stillness messages, vault session adapter (`vault-session.ts`).

### 1.1.2 lock hygiene (2026-07-05) — **resolved**

Adopted vault-core 1.1.2 lock cleanup APIs across note, kanban, voice, and integration hooks:

| Pattern | Usage in SelahKeep |
| --- | --- |
| `registerVaultLockCleanup` (`/browser`) | `register-selahkeep-vault-lock-cleanup.ts` — module-level `clearNoteBodyCache` |
| `useOnVaultLocked` (`/react`) | Search bodies/excerpts, versions, attachments, vault index/settings, integrations, voice transcription, note search query, kanban board edit state |
| `VaultSensitiveRegion` (`/react`) | `VaultProtectedShell` (page shell), kanban card dialog, note version diff |
| `assertNoVaultPlaintextInDocument` (`/testing`) | Feature/security tests for post-lock DOM hygiene |

**Authoritative vault-core docs read for this analysis:**

| Document | Path in package |
| --- | --- |
| README | `@tgoliveira/vault-core/README.md` |
| Changelog 1.0.0 | `@tgoliveira/vault-core/CHANGELOG.md` |
| Implementation guide | `@tgoliveira/vault-core/docs/IMPLEMENTATION_GUIDE.md` |
| Adoption guide (incl. SelahKeep case study §11) | `@tgoliveira/vault-core/docs/ADOPTING_VAULT_CORE_IN_EXISTING_APPS.md` |
| Consumer security requirements | `@tgoliveira/vault-core/docs/CONSUMER_SECURITY_REQUIREMENTS.md` |
| Current product surface | `@tgoliveira/vault-core/docs/CURRENT_PRODUCT_SURFACE.md` |
| Vault admin UI | `@tgoliveira/vault-core/docs/VAULT_ADMIN.md` |
| API reference | `@tgoliveira/vault-core/API_REFERENCE.md` |
| ADR-005 / ADR-006 | `docs/ADR-005_*`, `docs/ADR-006_*` (SelahKeep) |
| Prior migration docs | `docs/VAULT_CORE_MIGRATION_PLAN.md`, `VAULT_CORE_0_2_0_UPDATE_ASSESSMENT.md` |

---

## Executive summary

SelahKeep migrated **crypto primitives** to vault-core (envelopes, UVK, recovery phrase, PRF helpers) but still owns **all vault UX**, **session state**, **rate limiting**, **admin tooling**, and **most validation**. vault-core **1.0.0** ships a full React integration layer (session provider, status dock, unlock panel, protected gate, password fields, admin pages) plus browser session APIs and server-side rate-limit / plaintext guards that SelahKeep largely duplicates or bypasses.

To reach **100% compliance** with the current integration documentation:

1. **Replace** custom vault React UI with vault-core components (styled via `vault-admin.css` + design tokens).
2. **Replace** `src/lib/crypto-client/vault-session.ts` with `@tgoliveira/vault-core/browser` session APIs (`VaultSessionProvider` on the client).
3. **Wire** vault-core rate limiters on every unlock path and vault HTTP route.
4. **Mount** all eight vault admin pages under `/admin/vault/*` with env mapper + optional DB overrides.
5. **Adopt** 1.0.0 crypto/session breaking changes (non-extractable UVK, async `unlockVaultSession`, KDF v2 upgrade on unlock).
6. **Re-evaluate** every remaining local wrapper — keep only what vault-core explicitly leaves to the app (notes, legacy recovery code, WebAuthn ceremony, DB/API).

Setup wizard pages remain **app-owned** (vault-core does not export setup pages), but setup must use vault-core password/recovery/kit helpers and patterns from the implementation guide.

---

## Current vs target integration model

| Layer | SelahKeep today (0.2.0-era) | vault-core 1.0.0 contract |
| --- | --- | --- |
| Crypto kernel | `@tgoliveira/vault-core` via `src/modules/vault/core/*` | Same entry — extend for rotation, schema decrypt, KDF upgrade |
| Browser session | **Local** `vault-session.ts` (explicit single-source policy) | **`@tgoliveira/vault-core/browser`** — `configureVaultSession`, `unlockVaultSession` (async), `lockVaultSession`, `touchVaultSession` |
| React session | Custom hooks (`use-vault.ts`, `use-vault-session-unlocked.ts`) | **`VaultSessionProvider`**, `useVaultSession`, `useVaultUnlocked`, `useVaultLockState` |
| Status dock | **Custom** `features/vault/vault-status-dock.tsx` (~330 lines) | **`VaultStatusDock`** + **`VaultDockQuickUnlock`** |
| Unlock page | **Custom** `ltg-vault-unlock-panel.tsx`, `vault-unlock-panel.tsx` | **`VaultUnlockPanel`** |
| Locked overlay | **Custom** `vault-locked-state.tsx` on each page | **`VaultProtectedGate`** + **`VaultLockOverlayExclude`** |
| Return paths | `returnTo` query + `sanitizeVaultReturnTo()` | **`readVaultUnlockReturnPath()`** / **`buildVaultUnlockHref()`** — default param `next` |
| Password policy UI | secure-auth policy types + local setup fields | **`VaultPasswordField`**, **`VaultPasswordSetupFields`**, **`VaultPasswordStrengthFeedback`** |
| Auto-lock preference | Local config only | **`VaultAutoLockPreferenceField`**, **`useVaultAutoLockPreference`**, browser localStorage helpers |
| Plaintext guards | Local `assertNoVaultPlaintextFields` (subset of fields) | vault-core **`assertNoVaultPlaintextFields`** (broader field list, case-insensitive) + app extensions for note-specific fields |
| Rate limiting | App `RATE_LIMIT_STORE` only | **`withVaultUnlockRateLimit`**, **`consumeVaultApiRateLimit`**, wired to admin config |
| Admin UI | **None** (Outpost for product admin only) | **8 pages** under `/admin/vault/*` |
| Styles | Stillness tokens only | **`@import "@tgoliveira/vault-core/vault-admin.css"`** + token overrides for dock/unlock/admin |
| Testing entry | Not used | **`@tgoliveira/vault-core/testing`** sentinels |

---

## 1. Dependency and version alignment

### Done

- [x] Bump `package.json` to `@tgoliveira/vault-core@^1.0.0`.

### Still required

| Item | Action |
| --- | --- |
| `src/test/unit/vault-core-version.test.ts` | Update assertions from `0.2.0` → `1.0.0`; add smoke test for async `unlockVaultSession` |
| `docs/VAULT_CORE_MIGRATION_PLAN.md` | Mark Phase G+ for 1.0.0 UI/session compliance |
| `src/modules/vault/README.md` | Document new integration boundary (browser session + react UI) |
| `CHANGELOG.md` | Record dependency bump under `[Unreleased]` when behavior changes land |
| Run `npm run validate` | Fix any type/runtime breaks from 1.0.0 (non-extractable UVK, async session) |

---

## 2. Session management — full reimplementation required

**Today:** `src/lib/crypto-client/vault-session.ts` (~330 lines) is the sole in-memory UVK store. Documented in `docs/VAULT_SESSION_SINGLE_SOURCE_OF_TRUTH_FIX.md` as intentionally **not** using vault-core browser session.

**1.0.0 contract:** Session must flow through `@tgoliveira/vault-core/browser`. Direct key setters are not exported; `unlockVaultSession()` is **async** and rejects extractable UVKs.

### Reimplement

| SelahKeep file / behavior | Replace with |
| --- | --- |
| `vault-session.ts` — UVK store, lock/unlock | `configureVaultSession`, `unlockVaultSession`, `lockVaultSession`, `getSessionVaultKey`, `isVaultUnlocked` |
| `setUnlockedVaultSession()` in envelope wrappers | `await unlockVaultSession(key)` after envelope unwrap |
| Auto-lock timer + `touchVaultSession()` | vault-core browser session; **default:** countdown only renews via explicit **Stay unlocked** (not pointer/keyboard activity) |
| `use-vault-activity.ts`, activity listeners on notes/kanban | Remove or gate behind `registerVaultActivityGuard()` opt-in (1.0.0 default is **off**) |
| `use-suspend-vault-auto-lock.ts` | Map to vault-core session suspend pattern or document as app-only extension reviewed against 1.0.0 semantics |
| `registerVaultUnloadGuard()` local | `registerVaultUnloadGuard()` from browser entry via `VaultSessionProvider` |
| `features/vault/use-vault-session-unlocked.ts` | `useVaultUnlocked()` from `@tgoliveira/vault-core/react` |
| `features/vault/use-vault.ts` unlock/lock orchestration | `useVaultSession()` + thin app adapter for API fetches |
| `modules/vault/client/vault-session.ts` shim | Re-export from vault-core browser or delete |
| Envelope `applySession: true` paths | Async unlock + non-extractable key handling |

### App-layer hooks to preserve (thin adapters only)

| Concern | Keep as adapter on vault-core session |
| --- | --- |
| `clearNoteBodyCache()` on lock | Call from `lockVaultSession` wrapper or `beforeAutoLock` equivalent |
| `registerVaultBeforeAutoLock()` | Wire to vault-core lock subscription or provider callback |
| Dev HMR singleton | Use `VaultSessionProvider` at app root instead of `globalThis.__selahkeepVaultSessionStore` |

### Breaking crypto change (1.0.0)

- Envelope unlock returns **non-extractable** UVKs; `exportKey("raw", …)` in tests and `vault-core-version.test.ts` must use `userVaultKeysEqual()` or encrypt/decrypt probe.
- `createUserVaultKey()` is extractable only for initial wrap; rotation/re-wrap must reuse inner blob per CHANGELOG.

### Tests to rewrite

- `src/test/security/vault-session-single-source.test.ts` — assert vault-core browser session as source, not local module
- `src/test/unit/vault-session.test.ts`
- `src/test/security/vault-session-account-separation.test.ts`
- All features tests mocking local session

---

## 3. React UI — replace custom screens with vault-core components

vault-core 1.0.0 exports complete UI for dock, unlock, protected pages, and password fields. SelahKeep must **delete or reduce to thin wiring** the following.

### 3.1 Vault Status Dock

| Remove / replace | vault-core replacement |
| --- | --- |
| `features/vault/vault-status-dock.tsx` | `VaultStatusDock` |
| `features/vault/vault-dock-quick-unlock.tsx` | `VaultDockQuickUnlock` (via `renderQuickUnlock` on dock) |
| `vault-status-dock-copy.ts`, `-icons.tsx`, `-preference.ts`, `-events.ts`, `-routes.ts` | vault-core `copy.js`, `icons`, preference helpers |
| `use-vault-auto-lock-countdown.ts` | `useVaultAutoLockCountdown`, `useVaultAutoLockFraction` |
| `use-vault-dock-dismiss.ts` | Built into dock behavior |
| `use-vault-dock-passkey-available.ts` | `resolveVaultDockPasskeyAvailability` — **done** (`vault-dock-passkey-availability.ts` adapter) |
| `components/layout/nav.tsx` inline `<VaultStatusDock />` | Wire vault-core dock with `serverStatus`, `prfSupported`, `pathname`, `LinkComponent={Link}`, `onNavigateToUnlock`, `renderQuickUnlock` |

**Re-evaluate:** Stillness visual language vs `vc-status-dock-*` classes — override via CSS variables / `className`, not fork the component.

### 3.2 Vault Unlock page

| Remove / replace | vault-core replacement |
| --- | --- |
| `features/vault/ltg-vault-unlock-panel.tsx` | `VaultUnlockPanel` |
| `features/vault/vault-unlock-panel.tsx` (legacy recovery code UI) | `VaultUnlockPanel` for v2; **legacy recovery code** needs explicit exception (see §8) |
| `app/(vault)/vault/unlock/page.tsx` custom layout | Mount `VaultUnlockPanel` + `useVaultUnlockPageNavigation` |
| `sanitizeVaultReturnTo` + `returnTo` param | **`readVaultUnlockReturnPath`** / **`buildVaultUnlockHref`** — migrate query param to `next` or configure consistently |
| `vault-unlock-errors.ts` | Map to vault-core error types + generic user copy per IMPLEMENTATION_GUIDE §7 |

**Wire handlers:** `onUnlockPassword`, `onUnlockRecoveryPhrase`, `onUnlockPasskey` → existing crypto + **`withVaultUnlockRateLimit`**.

**Pass props:** `unlockRateLimiter`, `rateLimitScopeKey`, `serverStatus`, `prfSupported`, `passkeyReady`.

### 3.3 Vault Protected Gate (locked pages)

| Remove / replace | vault-core replacement |
| --- | --- |
| `features/vault/vault-locked-state.tsx` | `VaultProtectedGate` |
| Per-page `<VaultLockedState … />` on notes, kanban, settings, security | Single gate in `(vault)` layout wrapping `{children}` |
| `features/vault/vault-auto-lock-notice.tsx` | Dock + gate UX (auto-lock copy in dock) |

**Layout pattern (required):**

```tsx
<VaultLockOverlayExclude>
  <AppHeader>
    <VaultStatusDock {...props} />
  </AppHeader>
</VaultLockOverlayExclude>
<VaultProtectedGate configured={vaultConfigured} overlayBackground="…Stillness token…">
  {children}
</VaultProtectedGate>
```

**Files to update:** `(vault)/layout.tsx`, `notes/[id]/page.tsx`, `notes/new/page.tsx`, `kanban/*`, `vault/settings/page.tsx`, `vault/security/page.tsx`, `notes-vault-protected-message.tsx`.

### 3.4 Session provider at app root

| Add | Details |
| --- | --- |
| `VaultSessionProvider` | In client providers tree (`src/app/providers.tsx` or equivalent) |
| `sessionConfig.resolveAutoLockMinutes` | Layer user preference → admin → env via `resolveVaultAutoLockMinutesPreference` |
| `registerUnloadGuard` | Enable on provider |
| `registerActivityGuard: false` | Match 1.0.0 default unless product explicitly opts in |

### 3.5 Password fields (setup + settings)

| Remove / replace | vault-core replacement |
| --- | --- |
| Custom password inputs in `vault-setup-wizard.tsx` | `VaultPasswordSetupFields` |
| `lib/config/vault-password-policy.ts` (secure-auth types) | `buildVaultAdminConfigFromEnv()` → `config.passwordPolicy` |
| Local strength/requirements UI in setup tests | `VaultPasswordField`, `VaultPasswordStrengthFeedback` on settings/security |
| `src/test/features/vault-setup-password.test.ts` | Test against vault-core policy helpers |

### 3.6 Auto-lock preference (settings)

| Add | Details |
| --- | --- |
| `VaultAutoLockPreferenceField` | On `vault/settings` — replaces or supplements local auto-lock copy |
| `useVaultAutoLockPreference` | Sync with `VaultSessionProvider` config |

### 3.7 Client status hooks

| Remove / replace | vault-core replacement |
| --- | --- |
| `features/vault/use-vault-client-status.ts` | `useVaultClientStatus(serverStatus, prfSupported)` |
| `lib/vault/vault-status.ts` `VaultClientStatus` type | Re-export vault-core type; delete duplicate enum if aligned |

### 3.8 Setup wizard (app-owned — partial reimplementation)

vault-core does **not** ship setup pages. Keep `vault-setup-wizard.tsx` but **reimplement internals**:

| Step | Use vault-core |
| --- | --- |
| Password + confirm | `VaultPasswordSetupFields` + policy from admin config |
| Recovery phrase generation | `createRecoveryPhrase` (already re-exported) |
| Word confirmation | `pickRecoveryConfirmationIndices`, `assertRecoveryPhraseWordConfirmation` (replace `recovery-phrase-challenge.ts` wrapper if redundant) |
| Recovery kit download/print | `createRecoveryKitText`, `createRecoveryKitDownload`, `printRecoveryKitContent` from browser entry |
| UVK + envelopes | Existing module wrappers; add **`maybeUpgrade*`** after unlock paths |

---

## 4. Vault Admin UI — new surface to mount

**Today:** No `/admin/vault/*` routes. Admin config is env-only via local parsers.

**Required:** Mount all eight screens per `docs/VAULT_ADMIN.md`:

| Route | Component |
| --- | --- |
| `/admin/vault` | `VaultAdminPanelPage` |
| `/admin/vault/config` | `VaultAdminConfigPage` |
| `/admin/vault/env-template` | `VaultAdminEnvTemplatePage` |
| `/admin/vault/crypto-policy` | `VaultAdminCryptoPolicyPage` |
| `/admin/vault/profile` | `VaultAdminProfilePage` |
| `/admin/vault/session` | `VaultAdminSessionPage` |
| `/admin/vault/password-policy` | `VaultAdminPasswordPolicyPage` |
| `/admin/vault/security` | `VaultAdminSecurityPage` |

### Implementation checklist

- [ ] Create `src/lib/env/vault-from-env.ts` with `buildVaultAdminConfigFromEnv({ env, profile: SELAHKEEP_VAULT_PROFILE, prfSaltPrefix, productName })`
- [ ] Import `@tgoliveira/vault-core/vault-admin.css` in `globals.css`; map `--vc-*` variables to Stillness tokens where needed
- [ ] Protect routes with existing Outpost/admin RBAC
- [ ] Optional: DB table via `getVaultAdminConfigOverrideSchemaSql()` + `GET/POST/DELETE /api/vault/admin/config`
- [ ] Pass `LinkComponent={Link}` from `next/link`
- [ ] Document env vars in `docs/VERCEL_ENVIRONMENT_VARIABLES.md` using `VAULT_ADMIN_ENV_CATALOG`

---

## 5. Server-side compliance (CONSUMER_SECURITY_REQUIREMENTS)

### 5.1 Plaintext rejection

| Today | Target |
| --- | --- |
| Local `assertNoVaultPlaintextFields` in `lib/validation/vault.ts` | Import from `@tgoliveira/vault-core` |
| App-specific forbidden fields (`title`, `body`, `tags`, …) | Extend with app-layer guard **after** vault-core base guard, or use route-specific Zod only |
| Partial route coverage | Apply on **every** vault API body per checklist §1 |

**Routes to audit:** all under `src/app/api/vault/**`, `src/app/api/recovery-code/**`, passkey vault envelope routes.

### 5.2 Rate limiting

| Today | Target |
| --- | --- |
| Generic `RATE_LIMIT_STORE` | Add **`createVaultUnlockRateLimiterFromAdminConfig`** + **`withVaultUnlockRateLimit`** on every client unlock handler |
| No unlock action typing | Use actions: `password`, `recovery_phrase`, `passkey_prf` |
| API routes | **`consumeVaultApiRateLimit`** + **`buildVaultRateLimitHttpResponse`** per route namespace |

**Wrap:** `use-ltg-vault-setup.ts`, `use-vault.ts` unlock methods, recovery phrase replace, KDF upgrade, rotation flows.

### 5.3 Payload validation

| Add | Where |
| --- | --- |
| `decryptVaultPayloadWithSchema()` | Client decrypt of vault index/settings after unlock |
| App-owned Zod schemas | `vault-index-types.ts`, settings schema — validate after decrypt |

### 5.4 CSP

**Status:** SelahKeep already has nonce-based CSP via `src/lib/security/content-security-policy.ts` and tests — **align** with consumer-demo pattern referenced in CONSUMER_SECURITY_REQUIREMENTS; verify production has no `unsafe-inline` on scripts.

---

## 6. Crypto and envelope layer updates

### 6.1 Already delegated (keep thin wrappers)

- `modules/vault/core/envelopes/password-envelope.ts`
- `modules/vault/core/envelopes/recovery-envelope.ts`
- `modules/vault/core/envelopes/passkey-prf-envelope.ts`
- `modules/vault/selahkeep-profile.ts` — **do not change** AAD strings after production data

### 6.2 Must add (1.0.0)

| API | Purpose |
| --- | --- |
| `maybeUpgradePasswordEnvelopeAfterUnlock` | Persist `kdf-v2` envelope after successful password unlock |
| `maybeUpgradeRecoveryEnvelopeAfterUnlock` | Same for recovery |
| `rotateVaultPassword` | Replace custom password change flow if any |
| `rotateRecoveryPhrase` | Replace `RecoveryPhraseReplace` crypto path |
| `deleteVaultAfterAuthorization` / `deleteVaultWithPasswordAuthorization` | Vault deletion UX if product supports it |
| `assertInnerVaultKeyBlobMatchesVaultKey` | Envelope re-wrap paths during rotation |
| `userVaultKeysEqual` | Tests and session comparisons with non-extractable keys |

### 6.3 Legacy envelope path

| File | Decision |
| --- | --- |
| `legacy-envelope-unlock.ts` | **Keep** until all production envelopes have profile context and kdf-v2; required for pre-profile AAD |
| Re-evaluate after migration metrics | Remove when legacy detection returns false for all users |

### 6.4 Local crypto to remove or consolidate

| File | Action |
| --- | --- |
| `lib/crypto-client/argon2id.ts` | Remove if only used by legacy recovery-code path; else limit to recovery-code only |
| `lib/crypto-client/vault-kdf.ts` | Replace callers with vault-core KDF exports |
| `lib/crypto-client/encoding.ts` | Remove if fully superseded |
| Duplicate `aes-gcm.ts` / `aad.ts` | Evaluate `encryptVaultPayload` / `decryptVaultPayload` for index; **keep** note-specific fields local |

---

## 7. Passkey integration

| Today | Target |
| --- | --- |
| `vault-passkey-browser.ts` — only browser import | **Keep** as single browser entry re-export site (boundary test) |
| `lib/passkey/prf.ts` server salt | Must stay consistent with `buildPrfSaltBytes(SELAHKEEP_PRF_SALT_PREFIX, userId)` |
| Custom dock/page passkey auto-start | Align with vault-core defaults: **no auto-start on full unlock page**; dock quick-unlock may auto-start |
| `unlock-with-passkey.ts`, `vault-unlock-authenticate.ts` | **Keep** (WebAuthn ceremony is app-owned); wire PRF output to vault-core unwrap + rate limiter |

---

## 8. Legacy product features — explicit exceptions

These are **not** in vault-core. Compliance doc must record whether to keep, migrate, or retire:

| Feature | SelahKeep location | Compliance note |
| --- | --- | --- |
| Legacy recovery **code** (non-BIP39) | `recovery-code.ts`, `VaultUnlockPanel` legacy mode | vault-core has no recovery-code envelope — **cannot** use `VaultUnlockPanel` alone for vault-v1 users; need hybrid or forced migration |
| `vault-v1` vs `vault-v2` dual unlock page | `unlock/page.tsx` | Collapse to `VaultUnlockPanel` when all users on v2; until then, document exception |
| Legacy passkey login + vault | ADR-006 | Keep separation; vault-core unchanged |
| Note/index/settings encryption | `notes.ts`, `vault-index.ts` | Stays app-owned per adoption guide |
| Kanban encrypted payloads | kanban crypto | Stays app-owned |
| Trusted devices IDB cleanup | `vault-idb-cleanup.ts` | App-owned |

---

## 9. Files to delete after migration (target state)

When compliance work is complete, these custom vault UI/session files should be **removed** (not merely deprecated):

```
src/features/vault/vault-status-dock.tsx
src/features/vault/vault-status-dock-copy.ts
src/features/vault/vault-status-dock-icons.tsx
src/features/vault/vault-status-dock-preference.ts
src/features/vault/vault-status-dock-events.ts
src/features/vault/vault-status-dock-routes.ts
src/features/vault/vault-dock-quick-unlock.tsx
src/features/vault/ltg-vault-unlock-panel.tsx
src/features/vault/vault-unlock-panel.tsx
src/features/vault/vault-locked-state.tsx
src/features/vault/vault-auto-lock-notice.tsx
src/features/vault/use-vault-auto-lock-countdown.ts
src/features/vault/use-vault-dock-dismiss.ts
src/features/vault/use-vault-dock-passkey-available.ts   → deleted (see vault-dock-passkey-availability.ts)
src/features/vault/use-vault-session-unlocked.ts
src/features/vault/use-vault-activity.ts
src/lib/crypto-client/vault-session.ts          → replaced by vault-core/browser (+ thin adapter)
src/lib/config/vault-password-policy.ts         → replaced by buildVaultAdminConfigFromEnv
src/lib/notes/safe-return-to.ts                 → migrate to vault-core return-path helpers
```

**Test files** mirroring deleted components (~15 feature test files) must be rewritten against vault-core components or deleted.

---

## 10. Testing and security gates

### Adopt from `@tgoliveira/vault-core/testing`

- Replace ad-hoc sentinels with `SENTINEL_VAULT_PASSWORD`, `SENTINEL_RECOVERY_PHRASE`, `SENTINEL_USER_VAULT_KEY`, etc.
- Use `scanForSentinels` / `containsSentinel` in API security tests

### Update boundary tests

| Test | New assertion |
| --- | --- |
| `vault-core-boundaries.test.ts` | Allow `@tgoliveira/vault-core/react` in client components; still forbid browser entry from server |
| `vault-session-single-source.test.ts` | Session from vault-core browser, not local file |
| `vault-core-version.test.ts` | Version `1.0.0`, non-extractable unlock smoke |

### CONSUMER_SECURITY_REQUIREMENTS checklist

Copy checklist from package doc § "Agent checklist" into CI or manual release gate — all items must pass before declaring compliance.

---

## 11. Suggested implementation phases

| Phase | Scope | Risk |
| --- | --- | --- |
| **A** | Dependency 1.0.0, fix tests/build, non-extractable UVK in envelope wrappers | High |
| **B** | Browser session + `VaultSessionProvider`; adapter for note cache on lock | High |
| **C** | Rate limiters (client + API) + vault-core plaintext guards | Medium |
| **D** | `VaultUnlockPanel` + return path migration (`next`) | Medium |
| **E** | `VaultStatusDock` + `VaultDockQuickUnlock` in nav | Medium |
| **F** | `VaultProtectedGate` in `(vault)` layout; remove `VaultLockedState` | Medium |
| **G** | Setup wizard password/recovery kit + KDF upgrade on unlock | Medium |
| **H** | Vault admin pages + env mapper + optional DB overrides | Low |
| **I** | Password rotation / recovery rotation via vault-core APIs | Medium |
| **J** | Delete legacy UI/session files; update docs/CHANGELOG | Low |
| **K** | Legacy recovery code / vault-v1 sunset decision | Product |

---

## 12. Design system note (Stillness)

vault-core UI ships with `vault-admin.css` (`vc-*` classes). Compliance **does not** mean dropping Stillness — it means:

1. Import vault-core stylesheet once.
2. Map `--vc-vault-lock-overlay-color`, dock colors, and typography to SelahKeep tokens in `globals.css`.
3. Use `overlayClassName` / `className` props for layout only — **do not** fork vault-core React sources.

Mockups under `.design-mockups/SelahKeep-Mockups/` (vault dock, locked overlay) should be reconciled against vault-core default UX during Phase E–F; intentional deviations require design sign-off.

---

## 13. Out of scope (unchanged per vault-core docs)

- Note title/body encryption and per-note keys
- `@tgoliveira/secure-auth` account login UI and sessions
- Database schema for `user_vaults` / `vault_envelopes` (unless adding admin override table)
- WebAuthn registration/authentication ceremonies
- Outpost product admin (separate from vault admin)

---

## 14. Immediate next steps

1. Fix `vault-core-version.test.ts` and run `npm run validate` on `^1.0.0` baseline.
2. Spike `VaultSessionProvider` + one unlock path end-to-end without deleting local session yet.
3. Mount `VaultUnlockPanel` on `/vault/unlock` behind feature flag; compare with mockups.
4. Open tracking issues per phase (A–K) or a single epic with ordered PRs.

**Compliance definition of done:** Every item in `@tgoliveira/vault-core/docs/CONSUMER_SECURITY_REQUIREMENTS.md` agent checklist checked; every component listed in `@tgoliveira/vault-core/docs/CURRENT_PRODUCT_SURFACE.md` "shipped" React/admin/browser surface either mounted or explicitly documented as N/A with product approval (legacy recovery code only).
