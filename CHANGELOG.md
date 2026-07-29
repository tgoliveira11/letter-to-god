# Changelog

All notable changes to SelahKeep will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows semantic versioning where applicable.

## Changelog policy

- Document user-visible fixes, security-relevant behavior, and breaking changes under `[Unreleased]` until release.
- Group entries under `Added`, `Changed`, `Fixed`, `Security`, or `Removed` as appropriate.
- Link to ADRs or audit docs when behavior is security-sensitive.
- Do not log secrets, credentials, or decrypted content in changelog entries.

## [Unreleased]

### Fixed

- Added the enabled portable vault broker's exact validated HTTPS origin to CSP `connect-src`, so
  direct browser enrollment and unlock requests are allowed without broadening policy to paths,
  credentials, query strings, fragments, wildcards, or non-HTTPS sources.
- Updated portable passkey enrollment and unlock for `vault-core` 1.8.1 so an already-open,
  non-extractable vault key is re-wrapped from owner-scoped memory, and broker receipt verification
  succeeds before that re-wrap cache is committed.
- Fixed the passkey cleanup runner to open PostgreSQL serializable transactions with valid
  postgres.js isolation-level syntax.

### Added

- **Portable passkey vault unlock.** SelahKeep now integrates `vault-core` 1.8.1, the trusted
  vault broker v1 protocol, and `secure-auth` 0.10.1 single-use ES256 grants/receipts so one synced
  account passkey can authorize vault unlock across browsers without relying on portable PRF output.
- **Audited passkey cutover tooling.** Migration `0024_portable_vault_broker.sql` adds broker
  operations, pending/active portable mappings, and cleanup epochs. `npm run passkeys:cleanup`
  supports count-pinned dry-run, execution, and explicit reopening without targeting post-cutover
  credentials.
- **Unified account/vault passkeys.** An explicitly opted-in account passkey can serve both account sign-in and vault unlock after an exact post-registration authentication confirmation. An already dual-capability passkey can open the vault locally after secure-auth finishes the account session. Account auth and vault access remain independently usable.

### Changed

- **Dependency baseline.** The application pins published `@tgoliveira/vault-core@1.8.1` and
  requires `@tgoliveira/secure-auth@^0.10.1`.
- **Passkey UX boundary.** Account settings manages account login credentials only. Vault settings
  explicitly enrolls, tests, and revokes portable vault access. Login never installs a vault key.
- **Authentication-confirmed passkey enrollment.** Registration detects capability only. Vault-only setup, recovery setup, and optional account-passkey composition now require one exact, user-mediated authentication ceremony before the first durable envelope is wrapped or persisted.
- **Guided synced-passkey repair.** A candidate `no_match` leads directly to compatibility confirmation for the same logical credential. The user supplies an independent vault password or recovery phrase locally before one explicit WebAuthn prompt; known-good variants remain append-only.
- **Explicit vs quick unlock.** Full unlock always uses the active credential allow-list, while dock quick unlock remains an exact browser-binding optimization.
- **First-login vault bootstrap.** secure-auth now composes the package-built public PRF input on the
  first email-scoped account passkey ceremony for eligible dual-capability credentials. After the
  final account session, a browser-local hook unwraps exact encrypted candidates or redirects to
  explicit vault unlock with a typed action when PRF is unavailable or no variant matches.

### Security

- **Receipt-before-session invariant.** The browser installs a non-extractable UVK only after the
  app server verifies and consumes the broker completion receipt. PUKs, grants, receipts, PRF
  output, private ephemeral keys, UVKs, and decrypted data are never sent to an app API or stored.
- **Legacy enrollment closed during portable rollout.** New PRF envelope enrollment is disabled by
  default whenever the portable broker is enabled; existing PRF envelopes remain available only as
  a dual-run compatibility path until the count-pinned cutover cleanup is executed.
- **Shared WebAuthn counter CAS.** Migration `0023_secure_auth_passkey_counter_revision.sql` adds revisioned compare-and-set updates, including counterless authenticators, across secure-auth and product vault verification.
- **Independent compatibility repair.** Synced-passkey `no_match` repair requires a local vault password or recovery phrase through vault-core 1.6.1, even while the vault is locked; it cannot rely on a session UVK or browser binding alone.
- **Registration PRF is non-authoritative.** Registration responses and account-registration routes no longer issue a persistence receipt. Only a sanitized, server-verified assertion for the exact credential can mint the single-use proof consumed by envelope persistence. New variants carry `publicMetadata.prfCeremony = "authentication"`; legacy variants remain readable and are flagged for guided confirmation.
- **Browser-only PRF interop.** secure-auth owns account assertion sanitization, verification, and counter updates. SelahKeep receives only the verified credential ID after the final session and keeps PRF bytes exclusively in browser memory.
- **No custom login-options mutation.** The account passkey options route is a pure secure-auth
  delegate. Its server-only extension callback receives the resolved user and allow-list and uses
  vault-core to derive only the public per-user salt; it never exposes the user ID or PRF output.
- **Emergency mode off.** The vault-core emergency/duress UI gate is explicitly disabled in SelahKeep; no emergency state or controls are exposed.

### Fixed

- **Explicit passkey unlock on Safari/PWA.** The full unlock page now consumes already-prefetched WebAuthn options directly inside the user click instead of refreshing them first. Browser-binding-free explicit unlock therefore preserves transient user activation while quick unlock remains binding-scoped.

## [0.3.4] - 2026-07-27

### Added

- **Deterministic application state.** One server-resolved bootstrap now seeds the account session, effective secure-auth UI configuration, vault status, admin access, and namespaced auto-lock preference. Account replacement synchronously hides and clears prior-owner private state; centralized capability and route loading/error boundaries avoid false empty states.
- **Account preferences.** Delegated secure-auth 0.7.0 preference routes and migration `0022_secure_auth_user_preferences.sql` persist the vault auto-lock setting as account configuration without vault keys or note plaintext.
- **Synced-passkey compatibility variants.** A logical WebAuthn credential may have up to five active PRF envelope variants and several browser bindings. Vault settings can append and locally verify a compatibility variant for the same synced credential without replacing a known-good envelope.
- **Passkey vault device binding.** The HttpOnly `selahkeep_vault_device` cookie stores only a routing UUID. Each browser binding records the locally matched envelope variant; unbind removes only that browser, while credential disable/revoke removes all of its variants and bindings.

### Changed

- **Ownership-aware private workflows.** Vault setup/unlock/recovery/passkey work now uses vault-core 1.5.1 owner operations and leases. Notes, drafts, versions, attachments, Kanban, integrations, storage, and voice flows discard late async results unless owner, vault epoch, resource, encrypted-key identity, and request generation remain current.
- **Password KDF upgrade persistence.** A vault-core-recommended Argon2id upgrade now reasserts the active lease and atomically replaces only the encrypted password envelope; the prior implementation calculated the upgrade but discarded it.
- **Dependency baseline.** Pinned `@tgoliveira/secure-auth@0.7.0`, `@tgoliveira/vault-core@1.5.1`, `@tgoliveira/outpost@1.2.2`, `next@16.2.11`, and `next-auth@4.24.15`.
- **vault-core 1.3.0 adoption.** Passkey ceremonies now use typed credential selection, preserved stored transports, verified PRF capability, bounded candidate unwrap, canonical SelahKeep AAD for new writes, and the package legacy-AAD router for old reads. The app continues to own WebAuthn verification, challenges, cookies, persistence, UI, and the additive database migration.

### Fixed

- **Remove all vault passkeys from `/vault/settings`.** Vault settings now offers one confirmed bulk reset that revokes every vault-only credential, passkey envelope variant, and browser binding. Credentials also used for account sign-in keep their account capability and lose only vault unlock. The legacy `DELETE /api/passkeys` path now follows the same scoped behavior instead of revoking account passkeys.
- **Vault dock passkey auto-start.** Auto-start now waits until WebAuthn options are prefetched on expand, instead of relying on vault-core’s expand-time auto-start (which can consume its 10s dedupe slot before options arrive if the dock collapses mid-fetch). Also pass `passkeyUnlockAvailableOnThisDevice` through `toVaultServerStatusSnapshot` so vault-core dock availability matches device binding.

- **Note attachments deploy spikes.** `GET /api/notes/:id/attachments` no longer returns 500 when Drizzle wraps Postgres errors (`Failed query: …`) or when migration `0019` (`board_id`) lags a code deploy — list degrades to `[]` and mutations map to 503. The client hook dedupes in-flight list requests, backs off for 5s after a failed load, and keys reload on wrapped-key ciphertext instead of object identity to avoid retry storms during note detail re-renders.

- **Passkey vault unlock on synced Apple credentials.** Stored WebAuthn transports are preserved instead of forcing `internal`. A new browser may try bounded envelope candidates and, while the vault is unlocked by password or recovery phrase, append a compatibility variant to the same credential.

### Security

- **Fail-closed account/vault transitions.** Logout, lock, and account replacement invalidate outstanding operations and leases before stale plaintext-derived state can commit; unresolved identity and preference failures no longer masquerade as ready or empty state.
- **Bulk vault-passkey removal preserves the auth boundary.** `DELETE /api/passkeys/vault-unlock` runs under a fully authenticated session and one database transaction, clears the routing cookie, removes only vault-owned bindings/envelopes/capabilities, and never delegates account-passkey deletion to the product layer.
- **PRF output remains browser-only.** Every WebAuthn response sent to app APIs is sanitized with vault-core 1.3.0; recursive server guards reject `clientExtensionResults.prf`, raw PRF output, or PRF hashes. The server returns only verified credential identity, opaque short-lived proofs, and encrypted candidates.
- **Fail-closed passkey routing and mutation.** Missing cookies use an explicit allow-list; stale/inactive cookies return 409, are cleared, and require explicit rebind. Candidate `no_match`, test, and rebind failures do not mutate bindings. Variant cap checks and disable/revoke run under the credential row lock in one transaction.

### Added

- **Kanban note ↔ board sync.** Checklist and bullet items become cards; per-item descriptions, due dates (`[yyyy-MM-dd]`), priorities (`[LOW]`/`[HIGH]`/etc.), and column tags (`[IN PROGRESS]`) sync both ways. Card hover preview (2s delay), column-change history on cards, wider columns, and toolbar tooltips on the board view.

- **AI integrations (MCP).** Opt-in scoped access for Cursor, Claude Desktop, and Codex: create integrations at `/settings/integrations`, share specific notes/boards with read or write grants, and connect via local MCP server (`packages/selahkeep-mcp`) or localhost bridge (`tools/selahkeep-bridge`). Server stores token hashes and encrypted grants only; IEK and plaintext stay client-side. Gated by `INTEGRATIONS_ENABLED=true`. See `docs/TDR_AI_Integrations.md` and `docs/ADR-007_Integration_Grants_MCP.md`.

### Changed

- **`@tgoliveira/vault-core@^1.1.0`.** Adopted vault-core passkey PRF APIs (inner-key session cache, robust PRF extraction, WebAuthn ceremony helpers, device-binding contracts, legacy AAD routing, iOS PRF gate, crypto error classification). Removed duplicated SelahKeep modules: `vault-inner-key-material`, `legacy-envelope-unlock`, `normalize-prf-output`, and `use-vault-dock-passkey-available` (replaced by vault-core/browser and vault-core/react adapters).

- **`@tgoliveira/secure-auth@0.5.1`.** Dependency pin update.

- **Kanban board saves.** Rapid card moves coalesce into a serial save queue so optimistic UI is not overwritten by stale in-flight saves.
- **Kanban card ordering.** Drop anywhere in a column appends to the end; hover a between-card gap for 2 seconds to insert at that position (within-column reorder uses the same rule).

- **Logged-in `/home`.** Hero area is fixed-height and varies only by vault state (locked unlock CTA vs unlocked welcome); features and privacy marketing always show below, including Kanban and MCP integrations.
- **Vault auto-lock banner.** Disabled the sticky `role="status"` toaster; vault status remains in the header dock.
- **Collapsed sidebar.** Account hover popover on the avatar shows email, signed-in status, and sign out.
- **Kanban boards.** Card search filters by title, description, and `{tag}` markers; card dialog adds a tags field that syncs to linked notes as `{tag}` markers.

- **Navigation and note editor UX.** Removed mobile bottom tab bar; desktop sidebar is collapsible (preference persisted). Post-login default is `/home` (vault-free landing); login/register use `AUTH_AFTER_LOGIN_PATH`. `/notes` no longer shows page-level vault-locked empty state. Note editor field order is title → body → attachments → category → tags; focus mode removed; Save appears in the top bar and after tags; dictate/upload sit beside Cancel/Discard. Tag input keeps focus after Space/Enter.

- **Vault dock passkey unlock.** Upgraded `@tgoliveira/vault-core` to 1.0.1 (cancel no longer redirects; auto-start from expand via `bindAutoStartPasskey`). Dock refreshes WebAuthn options on each expand before passkey auto-start.

- **Board UI.** Labels manager and board version history removed from the board screen for now; note card preview delay increased to 2 seconds to match kanban cards. Note detail no longer shows a manual Kanban re-sync control or Zen reading mode entry. Notes with a linked board no longer offer manual resolve/reopen — resolved status follows board completion. Card hover preview opens directly over the card (same size/position); card details dialog is wider; the done column is always the last column (toggle removed).

### Fixed

- **Passkey vault unlock AAD context.** Passkey unlock now normalizes missing or null `aad.context` on stored envelopes before vault-core decrypt, instead of misrouting those envelopes to the legacy raw-key path (which cannot unwrap AES-KW inner blobs) or failing vault-core `assertVaultKeyAad` with a context mismatch when context was stripped from JSON before PR #40.

- **Note editor checklists.** Kanban note→board sync no longer rewrites the note body while typing (fixes cursor jumping to the end). Checklist rows keep the checkbox and text on the same line in visual and preview modes. Bracket tags such as `[IN PROGRESS]` are no longer escaped as `\[IN PROGRESS\]` when saving from the visual editor.

## [0.3.3] - 2026-07-02

### Fixed

- **Product rate limit still failing on passkey/vault APIs in production.** Bind rate-limit timestamps as ISO `timestamptz` strings instead of `Date` objects (serverless prepared-statement path).

## [0.3.2] - 2026-07-02

### Fixed

- **Production auth 503 on `/api/auth/session`.** Default `AUTH_RATE_LIMIT_STORE` / `RATE_LIMIT_STORE` to `postgres` when `NODE_ENV=production` and vars are unset (required by secure-auth 0.5.0).
- **Vault unlock 500 when product rate limits use Postgres.** Map missing `rate_limit_buckets` table to 503 with migration hint instead of opaque 500.
- **Product rate limit 500 on passkey/vault APIs.** Postgres rate-limit upsert now uses `postgres-js` directly; Drizzle `db.execute` failed to bind `Date` parameters (`ERR_INVALID_ARG_TYPE`).

## [0.3.1] - 2026-07-02

### Security

- **OpenAPI spec gated in production.** `GET /api/openapi` returns 404 unless `ENABLE_API_DOCS=true` (same policy as `/api-docs`).
- **Product API auth hardened.** Sensitive `/api/*` routes require `requireFullyAuthenticatedUser()` (2FA-complete and email-verified sessions), not session-only checks.
- **Admin UI role gate in proxy.** `/admin` redirects non-admin users; login-only gate was insufficient.
- **Production rate limits require Postgres.** `RATE_LIMIT_STORE=postgres` is enforced at startup; forwarded IPs are trusted only when `AUTH_TRUST_FORWARDED_HEADERS=true`.
- **Vault init deprecated.** `POST /api/vault/init` returns 410 — use `POST /api/vault/setup` (Argon2id + plaintext rejection).
- **Recovery code Argon2id-only.** Client PBKDF2 fallback removed; server rejects non-Argon2id recovery-code envelopes.
- **Client AAD binding.** Note drafts, vault index, and vault settings decrypt paths verify AAD against the session user id.
- **Kanban server kill switch.** `KANBAN_ENABLED=false` disables `/api/kanban/*` even when the client flag is on.
- **Attachment quota integrity.** Server recalculates ciphertext bytes from encrypted payloads instead of trusting client-reported sizes.
- **Mutation rate limits.** Per-user limits on notes, kanban, and attachment write APIs.
- **CSP tightened.** Removed production `style-src 'unsafe-inline'` (nonce-only).

### Changed

- **`@tgoliveira/secure-auth@0.5.0`.** Security hardening (admin APIs require full auth, production postgres rate limits, forwarded-header trust opt-in), password-manager-friendly 2FA forms, magic-link routes, OAuth 2FA completion page, and HIBP breach check wiring.

## [0.3.0] - 2026-07-01

### Added

- **`@tgoliveira/vault-core@^1.0.0`.** Dependency bump from `^0.2.0`; session, React UI, rate limiting, and admin surfaces now integrate with the 1.0.0 contract.
- **Vault session provider.** `VaultSessionProvider` at the app root; `vault-session.ts` is a thin adapter over `@tgoliveira/vault-core/browser` (async `unlockVaultSession`, non-extractable UVK after unlock, SelahKeep hooks for note cache clear and pre-lock handlers).
- **Vault-core React UI.** Status dock (`VaultStatusDock` + `VaultDockQuickUnlock`), full unlock page (`VaultUnlockPanel`), protected layout gate (`VaultProtectedGate` + `VaultLockOverlayExclude` on the left sidebar and vault dock), setup/settings password fields (`VaultPasswordSetupFields`, `VaultAutoLockPreferenceField`), and `@import "@tgoliveira/vault-core/vault-admin.css"` in global styles.
- **Vault admin UI (8 pages).** `/admin/vault/*` — overview, config, session, security, password policy, crypto policy, profile, env template — wired through `buildVaultAdminConfigFromEnv()` / `getVaultAdminConfig()`.
- **Vault rate limiting.** Client unlock paths use `withVaultUnlockRateLimit`; vault HTTP routes use `consumeVaultApiRateLimit` (setup, recovery-phrase replace, unlock-envelope) with limits from admin env config.
- **Logged-in home (`/home`).** Post-login landing only when the vault is locked (or not yet configured) — unlock hero and privacy reassurance; excluded from `VaultProtectedGate` so the page stays fully interactive on first sign-in. Direct visits to `/home` without a fresh login redirect to `/notes`.
- **Legacy vault-v1 unlock panel.** `LegacyVaultUnlockPanel` retained for pre–vault-v2 accounts on the unlock route when LTG setup is incomplete.

### Changed

- **Test & CI performance.** Vitest split into `unit` (node) and `ui` (happy-dom) projects; parallel GitHub Actions jobs for lint, typecheck, test coverage, and build; ESLint and TypeScript incremental caches; shared lazy vault crypto fixtures for repeated KDF work; removed coverage sharding scripts.
- **Vault session semantics.** Auto-lock countdown renews only on explicit **Stay unlocked** / `touchVaultSession()` — global pointer/keyboard activity listeners removed (`registerActivityGuard: false`).
- **Vault unlock return paths.** `buildVaultUnlockHref` / `readVaultUnlockReturnPath` use query param **`next`** (vault-core default); legacy **`returnTo`** is still accepted when reading callbacks.
- **Post-login routing.** Default authenticated redirect is **`/home`** (was `/notes`); users with an unlocked vault on `/home` are sent to `/notes`.
- **Vault locked on protected routes.** `VaultProtectedGate` overlay on vault-protected screens (e.g. `/notes`); `/home` is shown only immediately after login when the vault is closed, not as a redirect from other routes.
- **Vault lock overlay exclusions.** `VaultLockOverlayExclude` wraps the desktop left sidebar, mobile bottom nav, and the full authenticated header (vault-core consumer-demo pattern) so the expanded dock stays above the lock overlay.
- **`/vault/unlock` vault gate.** Unlock page is session-only (excluded from `VaultProtectedGate`); dock passkey auto-starts when configured and redirects to `/vault/unlock` on passkey failure from the dock.

### Fixed

- **Test worker OOM.** `editor-track-2.test.tsx` no longer renders `NotesPage` under `vi.useFakeTimers()` (effect/timer loop exhausted the heap); daily-note behavior is covered via `findDailyNoteIdForDate` and `NewNoteAction` instead.
- **Dock passkey unlock on `/vault/settings`.** A duplicate auto-start (Strict Mode / remount after unlock) could succeed once then fail and redirect to `/vault/unlock` even though the vault was open; concurrent attempts are deduped and failure redirect is skipped when the session is already unlocked.
- **Vault admin config fetch loop.** `/admin/vault/config` no longer hammers `GET /api/vault/admin/config` — stable `env` / `adminOverrides` refs are passed into vault-core (its default `env = {}` recreated `load` every render).
- **Authenticated header scroll.** The top toolbar (search + vault dock) stays pinned while page content scrolls underneath; sticky lived on `VaultLockOverlayExclude`, which vault-core styles as `position: relative`.
- **Desktop sidebar height.** The left rail stays viewport-tall while scrolling long pages (sticky `h-screen` on the aside) so the card background no longer stops above the bottom of the screen.

### Changed

- **Vault admin navigation.** All eight `/admin/vault/*` screens appear in the admin header nav alongside secure-auth and Outpost (labels from vault-core `VAULT_ADMIN_SECTIONS`).
- **Admin overview hub.** `/admin` lists every secure-auth, Outpost, and Vault admin link (same set as the header menu) in grouped cards.
- **Vault admin config persistence.** Migration `0017_vault_admin_platform.sql` creates `vault_admin_config_overrides`; `GET`/`POST`/`DELETE` `/api/vault/admin/config` for runtime overrides (platform admin).

### Fixed

- **Vault admin runtime.** Server routes no longer pass `Link` into vault-core client pages directly; thin client wrappers own `LinkComponent` to satisfy the Next.js RSC boundary.
- **Vault setup and settings** use vault-core password policy components and auto-lock preference field; password policy comes from admin env config.
- **Unlock orchestration (`useVault`).** All unlock methods run through vault-core rate limiting; recovery-phrase envelope KDF upgrade on unlock persists via `replaceRecoveryPhrase` when vault-core recommends an upgrade.
- **KDF metadata schema** accepts Argon2id **`kdf-v2`** envelopes in API validation.
- **Recovery phrase drill** derives keys via vault-core `encryptionKey` from `deriveRecoveryPhraseKeyFromMetadata` (1.0.0 dual-key envelope shape).
- **Vault status dock placement.** On desktop, the dock shares the header toolbar row with the notes search bar (search left, dock right) on all authenticated routes; the duplicate dock row below the header was removed.

### Removed

- **Custom vault dock and unlock UI** — `vault-dock-quick-unlock.tsx`, `ltg-vault-unlock-panel.tsx`, `vault-unlock-panel.tsx`, and activity-based auto-lock renewal (`use-vault-activity` global listeners; thin no-op shim kept for editor touch calls).

### Security

- **Plaintext guards** delegate to vault-core `assertNoVaultPlaintextFields` with SelahKeep extensions for note-specific forbidden fields (`src/lib/validation/vault.ts`).
- **Unlock rate limits** on every client unlock path via `withVaultUnlockRateLimit` and configurable admin/env limits.
- **Vault API rate limits** on setup, recovery-phrase replace, and unlock-envelope routes via shared vault-core limiter helpers.

## [0.2.0] - 2026-06-30

### Added

- **Note Kanban Boards (end-to-end).** Encrypted Kanban boards (note-bound or standalone) with columns, cards, due dates, priorities, labels, drag-and-drop, mobile Move menus, version history (restore + diff), note resolve/reopen prompts, vault-index progress chips, and `/kanban` navigation. Client-only encryption (`note_kanban_board` / `note_kanban_version` / `note_kanban_key` AAD fields); API under `/api/kanban/*`. Migration `0016_note_kanban.sql`. Kill switch: `NEXT_PUBLIC_KANBAN_ENABLED` (default on).

### Changed

- **Logged-out home page copy** now reflects the full shipped product surface: encrypted notes vault, Kanban boards (note-bound and standalone), on-device voice dictation, attachments and version history, passkey sign-in and vault unlock, and recovery options — written for privacy-conscious, non-technical readers.

- **Note-bound Kanban boards now sync bidirectionally with their source note.** Checklist and list edits on the note update the board (debounced ~500ms); card moves, completion, title edits, and add/remove on the board write back to the note (debounced ~800ms). Stable `source.key` IDs anchor field-level merge; manual re-sync remains as a fallback reconcile action.

- **Kanban card editor reuses the note Markdown editor.** Card descriptions open in the same visual/markdown editor as notes (toolbar, formatting, light/dark tokens) instead of a plain textarea.

- **Interstitial note prose maps to Kanban card descriptions.** Text between checklist groups (or before the first group) becomes the shared `description` on cards in the following checklist group; edits sync back to the note as interstitial paragraphs.


### Fixed

- **Kanban `GET /api/kanban` false 503 when tables exist.** `isMissingKanbanTable` treated any Postgres `42P01` (and column-missing messages containing `note_kanban_boards … does not exist`) as “table missing”, so partial schema drift or unrelated undefined-relation errors surfaced as `503` even after `npm run db:check-kanban` reported OK. Detection now requires `relation "note_kanban_boards" does not exist`, ignores missing-column errors, and `GET /api/kanban` list degrades to `[]` (matching note-version list behavior). `npm run db:check-kanban` now verifies required columns and runs probe `SELECT`s; confirm Vercel `DATABASE_URL` matches the database you migrate (see `docs/VERCEL_ENVIRONMENT_VARIABLES.md`).

- **Kanban column header actions wrapped to multiple lines.** Column toolbars now use compact icon-only controls on a single `flex-nowrap` row (add card, mark done, move left/right, delete) via the shared `ToolbarButton` pattern.

- **Kanban `/kanban` list hid note-bound boards.** The page only queried `scope=standalone`, so boards generated from notes never appeared. The list now loads all vault boards, shows standalone and note-bound sections separately, and explains where each type lives.

- **Kanban `/api/kanban` 503 after pulling the feature branch.** Migration `0016_note_kanban.sql` was skipped when `drizzle/meta/_journal.json` did not list it; `npm run db:migrate` reported success without creating `note_kanban_boards` / `note_kanban_versions`. Register the journal entry (commit `4a59583`), run `npm run db:migrate`, then verify with `npm run db:check-kanban`.

## [0.1.2] - 2026-06-30

### Added

- **Secure-auth admin platform (`@tgoliveira/secure-auth@0.4.1`).** `/admin` UI (overview, users, waitlist, invites, locks, API keys, config) with navigation at 1000px max width; API routes under `/api/auth/admin/*` delegate to the package. Access requires sign-in (proxy) and `admin` role (package API enforcement); `ADMIN_BOOTSTRAP_EMAIL` promotes the bootstrap account when no admin exists. Migration `0014_secure_auth_admin_platform.sql`.
- **Outpost admin (`@tgoliveira/outpost@1.2.0`).** `/admin/outpost` pages (overview, email queue, config, observability) with API delegates under `/api/outpost/admin/*`. Same platform admin gate (`admin` role or `tgoliveira11@gmail.com`). Migration `0015_outpost_platform.sql`.

### Changed

- **Upgraded `@tgoliveira/secure-auth` from 0.1.25 to 0.4.1** (admin platform, user roles/status, invites, API keys, account lockout schema).
- **Upgraded `nodemailer` to 9.x** to align with `@tgoliveira/outpost` peer requirements; removed `.npmrc` `legacy-peer-deps` workaround.

### Fixed

- **Admin bootstrap email now grants `/admin` access reliably.** `ADMIN_BOOTSTRAP_EMAIL` is promoted to `role=admin` on admin layout load and before secure-auth API handlers; Outpost platform-admin checks honor the same env var.
- **Outpost admin nav links now include the `/admin` prefix.** Nav and `OutpostUIProvider` read `OUTPOST_ADMIN_PATH` from the server layout instead of linking to bare `/outpost/*` paths.
- **CI: release workflow now requires green `validate`.** `workflow_dispatch` releases call the CI workflow first; tag and GitHub Release steps run only after lint, tests, and build pass on `main`.
- **CI: vault dock header tests no longer false-match `Unlock vault`.** Assertions use exact `Lock vault` naming; test `localStorage` is cleared between runs to avoid dock state bleed in GitHub Actions.
- **CI: `prepare-release` tests use isolated fixture directories** so they do not depend on the repo's live `[Unreleased]` section after a version cut.

## [0.1.1] - 2026-06-30

### Fixed

- **Mobile: voice model download OOM.** On phones/tablets the speech worker now loads `whisper-tiny` with **q4** WASM weights, single-thread ONNX, and pauses the TipTap editor while dictation/upload is open so iOS Safari has enough heap for the model.
- **Production SSR: markdown sanitization no longer pulls jsdom.** Replaced `isomorphic-dompurify` with `sanitize-html` for markdown preview and editor paste sanitization, avoiding the Vercel `encoding-lite` / `html-encoding-sniffer` ESM require failure during server render.
- **Mobile: passkey unlock on `/vault/unlock`.** WebAuthn options are prefetched when the unlock screen loads so `startAuthentication` runs immediately on tap (iOS Safari loses the user gesture after an async network round-trip).
- **Mobile: note editor stays responsive with voice notes enabled.** Background model warm-up and dictation-panel auto-load are skipped on memory-constrained devices; the model downloads only when the user opens dictation and taps record, without running the heavy warm inference pass that froze typing.
- **Dictate no longer auto-locks the vault while the voice model loads or transcribes.** On-device model download can take minutes without keyboard input; dictation and audio-upload panels suspend the inactivity timer until they close.
- **Mobile dictation no longer reloads the tab while the note editor is open.** iOS Safari was killing the page when the full Whisper base model (~150 MB) loaded alongside the editor; phones now defer the download until Record is tapped, use the smaller `whisper-tiny` model, skip WebGPU fp32 weights, and release the worker when the panel closes so the vault session survives.

### Changed

- **`/notes/new` simplified for writing.** Template picker, writing prompts, and Focus Mode are hidden for now; category sits below the editor in a lighter secondary row. Dictate and encryption notice remain in the right rail.

- **`/notes/new` aligned with the Stillness note-editor mockup.** Full-width layout (matching notes list and detail), tags under the title, white right-rail cards with header dividers (templates, dictate, encryption notice), and a top bar with draft status dot plus Discard/Save actions.

### Fixed

- **iPhone: `/vault/unlock` reloading in a loop (couldn't unlock).** The on-device speech-model **background warm-up** ran on every authenticated page — including the locked unlock screen — and eagerly loading the multi-MB model could exceed the tab's memory budget on phones, causing iOS Safari to reload the tab (which restarted the warm-up → loop). The warm-up is now skipped on memory-constrained/mobile devices (the model loads on demand when dictation/audio upload is opened) and never runs while the vault is locked.

### Added

- **Upload an audio file to transcribe (on-device), next to "Dictate a note".** On `/notes/new` and when editing a note, an **Upload audio** button transcribes a recording entirely on the device, then drops into the same review-and-insert flow as dictation. Highlights:
  - **Language**: pick **Auto-detect / English / Português / Español** (persisted). Auto-detect runs before transcription; choosing a language forces it (fixes auto-detect mislabeling, e.g. a Portuguese recording transcribed as English).
  - **Speaker separation (diarization)**: optional, on by default — labels turns as `[Person one]`, `[Person two]`… using the on-device `pyannote-segmentation-3.0` model merged with Whisper word timestamps; falls back to a plain transcript when there's a single speaker or it can't run.
  - **Robust decoding ladder** for any common format/size, all on-device: native `decodeAudioData` (small files) → **WebCodecs + `mediabunny`** (streams large AAC/MP3/Opus/FLAC without exhausting memory) → **ffmpeg.wasm** as a universal last resort for codecs the platform can't decode (e.g. **ALAC / Apple Lossless** `.m4a` from iPhone Voice Memos). The ffmpeg core is self-hosted under `/public/ffmpeg/` (regenerated by `scripts/copy-ffmpeg.mjs`, not committed) and loaded by a dedicated worker — the configuration that actually works under Next + Turbopack.
  - **Status bars for every processing step**: reading/decoding (% for large files), model download (%), transcribing (animated), and a distinct "Separating speakers…" phase, each with an elapsed-seconds counter. Docs: `TDR_Local_Voice_Notes.md`.

### Changed

- **Mobile: the vault status dock is fully hidden, and unlock happens on `/vault/unlock`.** The header dock is now a desktop-only affordance (`hidden md:block`) — on mobile it's `display:none`, so it's invisible and non-interactive (no longer overlapping the header menu button). Because the inline dock unlock isn't available on small screens, the locked-state screens show a mobile CTA that links straight to **`/vault/unlock`** (the desktop CTA still expands the dock inline). The unlock page is fully responsive on mobile. So every mobile vault unlock happens on `/vault/unlock`.
- **Note detail (`/notes/[id]`) aligned to the Stillness mockup.**
  - Reading view uses the **full main column width** (same as `/notes`), not a centered narrow column.
  - **Top action bar** — uniform toolbar buttons with icons: Mark resolved, Edit, Zen, and a compact more menu (pin/favorite only; duplicate/archive/trash live in the rail).
  - **Right rail** — **Details** (created/updated/versions), **Attachments**, and **Version history** as white cards with a **header divider** above the list; version rows show numbered badges, relative timestamps, subtitles, **Current** on the latest version, and **Restore** on older ones; attachment rows match the same layout with type badge, download, and a **hover preview popover** (50% viewport) when the file type supports client-side preview.
  - Reading body is **borderless** (no card wrapper); metadata chips sit above the title; dates appear only in the Details rail.
  - **Compare** in the version-history rail opens the inline diff panel in the main column.
- **Encrypted attachment previews** — client-decrypted previews render via `blob:` URLs; CSP now allows `blob:` for `img-src`, `frame-src`, and `media-src`.

### Removed

- **Show timeline** toggle on the note detail reading view (lifecycle timeline UI removed from `/notes/[id]`).

### Changed

- **Dictation is much faster and more responsive (still 100% on-device).** The live transcript used to fall ~30s behind because every ~1.5s pass re-transcribed the whole, ever-growing buffer on CPU (WASM). Now:
  - **WebGPU acceleration** — the worker probes `navigator.gpu` and runs Whisper on the **GPU** (fp32) when available, falling back to **WASM** (q8) automatically. Background warm-up runs one tiny silent inference so GPU kernels/shaders are compiled before first use. The active backend is shown in the panel ("Voice model ready · GPU").
  - **Bounded streaming** — partial passes transcribe only the recent **uncommitted segment** (committed every ~16s, under Whisper's 30s window) instead of the full recording, so per-pass cost is constant regardless of length and the live transcript keeps up. A single accurate full-buffer pass still runs on **Stop** for the text you review. Partial interval tightened to ~1.2s.
  - The transcribing state shows an **elapsed-seconds counter** so the wait is never a silent spinner. Default model is `Xenova/whisper-base`. Docs: `TDR_Local_Voice_Notes.md`.
  - **Model downloads in the background at app load.** The weights start downloading shortly after the authenticated app loads (idle time, with a hard timeout so a busy page can't defer it) while you keep navigating; opening dictation also guarantees the download has started. The dictation panel only shows the download/progress UI when the model **isn't ready yet** when you open it — otherwise it goes straight to the record button. A failed load can now be retried instead of sticking.
- **Stillness polish pass (layered on the mockup implementation).**
  - **Note-card hover preview.** Hovering a note card on `/notes` opens a popover with the note's content — rendered markdown with line breaks preserved — so you can read it without opening the note. It overlaps the card from the top edge (no gap to cross), stays open while the pointer is over it, scrolls when long, and **clicking anywhere in it opens the note**. The popover only appears when the card is actually truncating content (clamped or char-truncated excerpt); cards that already show the whole note get none.
  - **Uniform note cards.** All cards in a grid share the same height (`auto-rows-fr`), with the tag/date footer pinned to the bottom.
  - **Editor line-break model.** In the visual editor, **Enter inserts a line break** (one line down) and **Shift+Enter starts a new paragraph** (blank-line gap); lists and code blocks keep their native Enter behavior. The raw-markdown editor mirrors this (Shift+Enter inserts a blank line). Breaks render consistently in the note detail view and the card hover preview.
  - **Authenticated chrome stays present while the vault is locked.** On `/notes` (locked) and the vault-unlock screen, the header keeps the logo and the left rail keeps the brand, the theme selector, the account footer (email + sign out) and an **Account** link; only destinations that need an open vault (New note, Library, Vault) are hidden until unlock. (Supersedes the earlier full-bleed-while-locked behavior.)
  - **Header top bar** keeps a consistent fixed height with or without the search field, and is opaque so content scrolls cleanly beneath the sticky header. The search field and vault dock are unified into one top bar with a divider; the search only renders on `/notes` with an unlocked vault.
  - **Vault dock** restyled to a white card with the cards' rounding and a clearer open/closed lock icon; the expanded panel opens **over** the closed handle so nothing appears to vanish; **opening/closing the dock no longer resets the auto-lock timer**. Account moved into the left rail (below Vault); the account footer (email + sign out) stays docked to the bottom of the rail even when the page scrolls.
  - **`/vault` and `/account`** are left-aligned to match `/notes` (no longer centered). The sidebar account email is lighter (medium weight, secondary color). Note cards are clean by default (pin glyph only; the action cluster reveals on hover/focus).
- **Theme selector.** Added a **System / Light / Dark** switcher in the sidebar footer (persisted via `data-theme`), on top of the existing `prefers-color-scheme` support.
- **Logged-out home and locked-vault screens** redesigned to the Stillness concept; the locked `/notes` screen surfaces privacy-reassurance content alongside the unlock CTA, with no search bar (search shows only where notes are listed).
- **Notes-list screen aligned to the high-fidelity mockups.**
  - **Sidebar Library** now mirrors the mockup — **All notes / Pinned / Resolved / Archive** are deep-linked filtered views (`/notes?view=pinned|resolved|archived`); the notes page reads the `view` param and applies the matching smart filter. Account footer keeps Account + Vault + sign out. (While the vault is locked the rail now stays present with the brand, theme selector, account footer and an Account link — see the polish pass below.)
  - **Empty state** matches the mockup: a sparkle tile, "A quiet, empty page", and "Write your first note" (full-bleed, card-less). `EmptyState` gained optional `icon` / `plain` props.
  - **Loading state** is now a shimmering **skeleton card grid** (`NotesSkeletonGrid`) instead of a spinner.
  - **Error state** is the mockup's centered card — "We couldn't reach your vault" with a reassuring note and Try again — shown in place of the list.
  - The notes-list counter now appends the pinned count ("N notes · M pinned") to match the mockup header.
- **Global chrome and detail screens aligned to the Stillness mockup.**
  - **Desktop left sidebar** — on `md+`, authenticated users get a full-height sidebar (`AppSidebar`): brand, a New note CTA, the primary destinations (All notes / Vault / Account) and an account footer with sign out. The horizontal header nav, brand and desktop sign-out moved into it; the header is now the top bar that hosts the vault dock. `SiteShell` lays out sidebar + content column.
  - **Mobile bottom navigation** — a fixed tab bar (Notes / Vault / Account) on small screens, authenticated-only, hidden on `md+`. New `MobileBottomNav` mounted in `SiteShell`.
  - **Vault locked screen** restyled to the mockup's centered hero — large rounded lock tile, calm copy, full-width unlock CTA — and rendered card-less for the notes-list variant.
  - **Expanded vault dock (unlocked)** redesigned with a live **circular countdown ring**, "Vault open / Auto-locks in mm:ss", a **Stay unlocked 15 min** action (resets the inactivity timer) and **Lock now**. New `useVaultAutoLockFraction` hook drives the ring.
  - **Note detail (reading view)** gained a metadata header — category chip + a resolved/unresolved status badge above the title — matching the mockup; tags remain in the metadata row below.
  - **Zen reading mode** — a distraction-free reading surface (large type, title + body only, "Exit zen") reachable from a new Zen action on the note detail page.
  - **Desktop right rail on note detail** (`lg+`) — a Details card (Created / Updated), the version-history panel, and **Duplicate / Archive / Delete** actions move into a right column beside the reading body (delete still routes through the confirm dialog); stacked on smaller screens.
  - **Version history** rows restyled to numbered tiles with status subtitles (Comparing / Created / Edited) and a compact Restore control.
- **Editor refined to the mockup.** The top bar reads "Back to notes" and now offers **Discard** alongside Save; the right-rail template picker is presented as a titled **"Start from a template"** card. (Dictate states — ready/loading/recording/review — already match.)
- **Editor desktop right rail.** On `lg+`, `/notes/new` becomes a two-column layout: the main column holds the title, category, body, attachments and tags, while a right rail holds the template picker, prompt cards, the Dictate panel and an encryption reassurance. Implemented with CSS `grid-template-areas`, so the single-column DOM order (title → category → template → body → attachments → tags) — and the field-order contract — is unchanged; the rail simply spans the right column on wide screens and sits inline above the body on mobile.
- **Note editor redesigned to the Stillness mockup.** The create (`/notes/new`) and edit (`/notes/[id]`) editors now use a **top action bar** — a back affordance, an inline autosave status indicator (“Draft saved” / “Unsaved changes” / “Saving…” / “Offline — saved on device” / “Save failed”), the focus-mode toggle, and the primary **Save** button — replacing the bottom button row. The title is now a large **borderless** input at the top of the form, and the create-note field order follows the mockup: **title → category → template → editor → attachments → tags**. Submission is also available via ⌘/Ctrl+Enter in the editor. Docs: `NOTE_CREATE_EDIT_UX.md`; tests updated (`notes-new-field-order`).

### Fixed

- The authenticated account footer / sidebar now docks to the bottom of the rail on scroll. Root cause: `overflow-x: hidden` on `body` silently broke `position: sticky`; switched to `overflow-x: clip`.
- Fixed the desktop sidebar's full-height background leaving a gap below the rail, and moved the Next.js dev indicator so it no longer overlapped the signed-in user block.
- Filter chips on `/notes` no longer show a horizontal scrollbar.
- Fixed the test-suite heap OOM (`Ineffective mark-compacts near heap limit`) at its root: several feature tests mocked `useVaultIndex` with `vi.fn(() => ({...}))`, returning a new object every render, which made the notes page's `useEffect(..., [index])` re-run every render — an infinite render loop that exhausted the worker. The mocks now return a stable reference; un-quarantined `notes-refinements.test.tsx`; added a global Testing Library `cleanup()` in the setup. The full suite now runs green in a single `vitest run` (254 files, 1420 tests). See `docs/KNOWN_ISSUES.md`.
- Note-card date footer now shows the updated date (the created date remains on the note detail page), matching the design spec; updated the corresponding test.

### Added

- **Product-quality refinement pass.** Normalized note create/edit field order (template → category → title → editor → attachments → tags); encrypted attachments with client-side encryption, allowlist, env limits, and storage usage on vault settings; note list excerpts after unlock; autosave UI states including offline; dictation status labels and vault-lock transcript clear; SelahKeep “pause and keep” home copy. Docs: `NOTE_CREATE_EDIT_UX.md`, `AUTOSAVE_BEHAVIOR.md`, `ENCRYPTED_ATTACHMENTS.md`, `DICTATION_UX.md`, `STORAGE_USAGE.md`. Migration `0013_note_attachments.sql`.
- Adopted a formal **design system ("Stillness")** from the visual proposal in `docs/design/`, documented in `docs/DESIGN_SYSTEM.md`. The app now uses the **Schibsted Grotesk** typeface (self-hosted via `next/font`, CSP-safe), a tighter radius, outlined category/tag chips, refined primary/danger buttons, a GitHub-style diff using dedicated add/removed tokens, and signature calm animations.
- Full **light + dark theme** via `prefers-color-scheme`, driven by an expanded CSS design-token set in `src/app/globals.css` (style with tokens only). Agent directives (`AGENTS.md`, `.cursor/rules/ui.md`) and docs (`UI_UX_DIRECTION.md`, `ARCHITECTURE.md`, docs index) now point to the design system as the source of truth for tokens, type, and components.

### Changed

- Note create/edit UX: attachments between editor and tags; dictation control moved into editor section; edit mode separates category (template-locked when applicable) from tags; autosave status shows offline/draft states without premature “Saved”.
- Logged-out home page copy updated for SelahKeep positioning (reflection, prayer, journaling, remembrance).
- Markdown preview uses `breaks: true` (single newlines render as line breaks) with sanitization preserved.

### Security

- Encrypted attachments: client-only encryption under Note Key; server stores ciphertext + byte counts only; executable types blocked client-side; plaintext attachment fields rejected on API.

- Voice dictation is now **near real-time**. Instead of waiting for the recording to finish, audio is captured continuously and the accumulated buffer is re-transcribed on-device every ~2.5s, showing a live transcript while you speak; a final pass runs on Stop. Everything still runs locally — no audio or transcript leaves the device.
- Voice capture now runs on a dedicated **AudioWorklet** (`/worklets/audio-capture-worklet.js`) on the audio thread instead of the deprecated main-thread `ScriptProcessor`, for glitch-free capture while transcription runs.
- The speech model is now **pre-warmed in the background** when an authenticated user enters the app (during browser idle time), so the first dictation no longer waits on the one-time model download/initialization. The Whisper worker is an app-wide singleton reused by the dictation panel. Warm-up is skipped when voice is disabled, the browser lacks support, or the connection is data-saver/2g.
- The **Dictate** button now shows model status: a subtle **green** indicator (and green border) once the speech model is fully loaded, and a **hover tooltip with the current download percentage** while it is still warming up — so you can see how close it is to instant transcription.
- Live dictation feedback improved: partial transcripts refresh faster (~1.5s) and the live preview now shows a clear "transcribing…" activity state so there is always visible feedback while speaking.

### Added

- **Encrypted note version history.** Each time a note's content is saved, an immutable, client-encrypted snapshot is appended to a new `note_versions` table. From a note's detail page you can browse previous versions, **compare any two versions in a GitHub-style line diff** (the diff updates automatically as you pick versions, defaulting to the previous version vs the current note), and **restore** a previous version (restore appends a new version, so history is never rewritten). Snapshots reuse the note's existing Note Key and are AAD-bound to a unique version id; nothing is ever sent or stored in plaintext. Retention is configurable via `NOTE_VERSION_HISTORY_LIMIT` (default 50 per note); older versions are pruned server-side on row counts only. New routes: `GET/POST /api/notes/:id/versions`, `GET /api/notes/:id/versions/:versionId`. Migration `0012_note_versions.sql`. See [`docs/TDR_Note_Version_History.md`](docs/TDR_Note_Version_History.md) and ADR-005.
- **Voice notes with on-device transcription.** A new **Dictate** control on `/notes/new` **and when editing an existing note** records the microphone and transcribes speech to text **entirely on the device** using Whisper via transformers.js (WASM/WebGPU, run in a Web Worker). Supports **English, Portuguese, and Spanish**. The audio and the transcript never leave the browser — only model weights are fetched (once, then cached). The transcript is reviewed/edited by the user and inserted into the normal encrypted-note editor. Feature flag `NEXT_PUBLIC_VOICE_NOTES_ENABLED`; model selectable via `NEXT_PUBLIC_VOICE_MODEL` / `NEXT_PUBLIC_VOICE_MODEL_HOST`. See [`docs/TDR_Local_Voice_Notes.md`](docs/TDR_Local_Voice_Notes.md).

### Fixed

- Note version endpoints (`/api/notes/:id/versions`) no longer return **500** when the `note_versions` table has not been migrated yet (e.g. production before `npm run db:migrate`). The list now degrades to an empty history, single-version fetch maps to 404, and version creation returns a benign **503** that the client already ignores. **The correct fix is still to run migration `0012_note_versions.sql`** on the database; this only prevents the missing table from breaking the note page.

### Security

- Hardened HTTP security headers following a security/privacy audit: added **HSTS** (`Strict-Transport-Security`, 2y, preload) and a **Permissions-Policy** (`microphone=(self)`; camera/geolocation/payment/usb disabled). Extended the existing nonce-based **CSP** with `worker-src 'self' blob:` and a tightened `connect-src` that allows only `'self'` plus the on-device voice model host(s) — the self-hosted `NEXT_PUBLIC_VOICE_MODEL_HOST` when set, otherwise the default model CDNs. (Previously `connect-src 'self'` would have blocked the voice model download in production.)
- Voice transcription can now run **fully first-party**: setting `NEXT_PUBLIC_VOICE_MODEL_HOST` serves both the model weights and the ONNX-runtime WASM from that host, and scopes `connect-src` to it. The voice panel now discloses the one-time model download.
- Broadened server log redaction to also mask `noteKey`, `userVaultKey`, `recoveryPhrase`, `recoveryWords`, `mnemonic`, and `prf` keys (defense-in-depth; these are client-only and never sent to the server).
- Documented the web-delivery trust assumption, the extractable in-memory session keys, and the metadata the server can still observe under E2EE (note/version counts, timestamps, payload sizes) in `SECURITY.md` and the threat model; corrected the threat model to state Argon2id-only for new vault envelopes (PBKDF2 only in legacy `recovery_code`).
- Note version snapshots are encrypted client-side under the note's Note Key with per-version AAD binding (`note_version_metadata` / `note_version_body` bound to the version id; wrapped key bound to the note id), preventing cross-version/cross-note ciphertext swaps. Version content is readable only while the vault is unlocked; versions cascade-delete with the note and on account deletion. Sentinel-phrase and schema guards extended to `note_versions`.
- Voice transcription runs only on-device. The browser cloud Web Speech API is explicitly **not** used for note content (it would stream audio to a third party). Audio is held in memory and released after transcription; it is never persisted. A guard test asserts the voice modules perform no `fetch`/XHR/WebSocket/`sendBeacon` of audio or transcript and never reference `webkitSpeechRecognition`.

### Changed

- Simplified the Vault Dock so it shows only one primary unlock method. Passkey unlock is prioritized when configured; otherwise the dock uses vault password unlock. Recovery phrase unlock is now available only on the full unlock page.
- Reduced the Vault Dock width and removed the setup-vault state from the dock. The dock is hidden before a vault exists and on `/vault/unlock`.

### Added

- Added recovery phrase `.txt` download during vault setup.
- Added randomized recovery phrase confirmation challenges during vault setup: 3 words for 12-word phrases and 6 words for 24-word phrases.

### Fixed

- Fixed vault passkey unlock when both account sign-in passkeys and vault unlock passkeys exist. Vault unlock now requests only vault-enabled passkey credentials via `POST /api/passkeys/authenticate` with `purpose: "vault_unlock"`, and no longer allows account-only passkeys to be selected during vault unlock.
- Fixed vault passkey unlock option shaping so vault unlock preserves WebAuthn transport hints and requests only vault-enabled credentials. This prevents account-only passkeys from being offered during vault unlock and reduces incorrect QR-code / phone-or-tablet prompts when a local platform vault passkey is available.
- Fixed vault passkey registration to prefer platform authenticators (`authenticatorAttachment: "platform"`) for vault-only setup, improving Touch ID / Windows Hello prompts on macOS and other platforms.
- Fixed Apple passkey replacement when account and vault passkeys are registered for the same SelahKeep account. Vault-only credentials now use a deterministic opaque WebAuthn user handle distinct from the account passkey user handle, preventing a later account passkey registration from replacing the local Touch ID vault credential. Vault passkeys created before this fix may need to be removed and registered again once after unlocking with the vault password.
- Fixed vault passkey setup reporting `Internal server error` after the passkey and PRF envelope had already been persisted successfully. A failure while refreshing the status panel is now shown as a non-destructive refresh warning and no longer misreports registration as failed.
- Fixed production WebAuthn registration verification on the canonical `https://www.selahkeep.com` origin. `APP_BASE_URL` and `WEBAUTHN_ORIGIN` now match the Vercel domain redirect while `WEBAUTHN_RP_ID` remains `selahkeep.com`, so vault and account passkey ceremonies are verified on the host users actually visit.
- Fixed vault passkey re-registration after disable. Vault-only disable now revokes the credential row and PRF envelope; vault registration `excludeCredentials` excludes only active vault-enabled credentials, not account-only or disabled vault credentials.

### Security

- Reinforced the separation between account passkeys and vault passkeys. Account passkeys authenticate the account; vault passkeys unlock the vault using WebAuthn PRF. Account passkey sign-in still never unlocks the vault by itself. Vault unlock verify rejects account-only credentials and never returns a successful verify with a null envelope for vault unlock purpose.
- Reinforced account passkey and vault passkey separation. Vault unlock continues to require WebAuthn PRF and fails closed if the selected credential is not linked to vault unlock.
- Documented vault passkey lifecycle (registration, disable, re-registration) in `docs/archive/PASSKEY_VAULT_LIFECYCLE.md`.
- Reinforced recovery phrase handling by keeping phrase download and confirmation fully client-side and by requiring randomized word-position confirmation before completing setup.
