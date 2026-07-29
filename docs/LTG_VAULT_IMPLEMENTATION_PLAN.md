# SelahKeep — Phased Implementation Plan

> Former working name: LTG Vault. Current product name: SelahKeep.

> **Historical plan:** This document is retained for delivery traceability. Its PRF passkey phases,
> route names, package versions, and “current decision” statements are superseded by
> [`PORTABLE_PASSKEY_VAULT.md`](./PORTABLE_PASSKEY_VAULT.md). New passkey enrollment must use the
> direct portable broker flow; PRF code exists only for pre-cutover compatibility reads.

**Status:** Phases 0–5 **complete** (historical planning tables retained below for traceability)  
**Priority Track 1** (Security, Recovery, and Trust): **mostly complete** — `/vault/security` shipped 2026-06-16  
**Priority Track 2** (Writing Experience and Editor Quality): **mostly complete** — visual editor, drafts, templates, quick insert, focus mode, daily note shipped 2026-06-16  
**Priority Track 4** (Search and Discovery): **complete** — local body search, highlighting, recently viewed shipped 2026-06-18  
**Priority Track 5** (Reflective and Spiritual Workflows): **complete** — resolved reflection, timeline, remembrance, weekly reflection, prompt cards shipped 2026-06-18  
**Active routes:** `/notes`, `/api/notes`, `/vault/*` — **letters domain removed**

---

## Executive summary

Evolve the private-letters predecessor into **SelahKeep** (private encrypted notes: prayers, reflections, journaling) while:

- Keeping **account authentication** exclusively in `@tgoliveira/secure-auth@0.1.25`
- Keeping **vault decryption** product-owned in `letter-to-god`
- Migrating from letter-centric storage to **note-centric** storage with encrypted metadata, encrypted vault index, categories, tags, and Markdown bodies
- Replacing recovery-code + mixed KDF behavior with **Argon2id-only vault password KDF** and **12/24-word recovery phrase** envelopes
- Completing **passkey vault unlock** as an MVP requirement (partially present today)

---

## Repo baseline (inspected 2026-06-16)

Branch at planning time: `update-postforge-public-order-rss` (includes auth-reset work through `79d04de`).

### Exists today

| Area | Location | SelahKeep gap |
|------|----------|---------------|
| **Auth (package)** | `src/lib/secure-auth.ts`, `src/app/api/auth/**`, `src/app/api/account/**` delegates | **Phase 0 complete** on `main` |
| **Auth pages** | `src/app/(auth)/**` thin `@tgoliveira/secure-auth/react` wrappers | Rebrand copy in later phases |
| **Account + security settings** | `src/app/(vault)/settings/account/page.tsx` (`AccountSettingsPage` + `SecuritySettingsPage`) | Vault-specific settings move to product vault settings |
| **Letters UI** | `src/app/(vault)/letters/**` | Rename/replace with notes UX; Markdown editor |
| **Letters API** | `src/app/api/letters/**` | Evolve to notes API; encrypted metadata/index |
| **Letters crypto** | `src/lib/crypto-client/letters.ts` | Extend to notes + encrypted title in metadata |
| **Vault crypto** | `src/lib/crypto-client/vault.ts`, `vault-unlock.ts`, `vault-session.ts` | Vault password envelope; Argon2id-only; vault index |
| **Recovery** | `src/lib/crypto-client/recovery-code.ts` (17-word custom list, `hash-wasm`) | Replace with 12/24-word recovery **phrase** per TDR |
| **Passkey vault** | `src/lib/crypto-client/passkey-vault.ts`, `src/server/services/passkey-*` | PRF envelope; explicit signed-in vault unlock (current decision) |
| **Trusted devices** | Removed (`docs/TRUSTED_DEVICES_REMOVAL.md`) | Not in LTG MVP; migration `0011_drop_trusted_devices.sql` |
| **DB product schema** | `src/lib/db/app-schema.ts` | `letters` → `notes`; `vault_envelopes` → `vault_unlock_envelopes`; add `encrypted_vault_index`; remove plaintext `answered` |
| **DB auth schema** | `@tgoliveira/secure-auth/drizzle/schema` via `src/lib/secure-auth-db.ts` | Package-owned; do not fork |
| **Migrations** | `drizzle/0000`–`0007` | New migrations in Phases 1–3; no drops without migration plan |
| **Modules** | `src/modules/vault`, `src/modules/letters`, `src/modules/security`, … | `letters` → `notes`; vault module extended |
| **Server shims** | `src/server/services/*`, `src/server/repositories/*` | Re-export from modules; update with schema |
| **Features** | `src/features/vault/**`, `src/features/passkey/**`, `src/features/recovery/**` | Vault setup, notes editor, search |
| **Tests** | `src/test/**` (560 tests at planning time) | Expand security + crypto coverage per phase |
| **Docs** | ADR-001–004, `AUTH_RESET_TO_SECURE_AUTH.md`, `TDR_LTG_Vault_MVP.md` | New ADRs; update SECURITY/ARCHITECTURE as code changes |

### Does not exist (or removed)

| Item | Notes |
|------|-------|
| `src/modules/auth`, `account`, `sessions`, `two-factor` (local) | Removed in auth reset |
| `src/components/settings/**` (local) | Removed; package React components used |
| `src/features/passkey/sign-in-with-passkey.ts` | Removed; package owns account passkey sign-in |
| `docs/README.md` | Not present |
| Dedicated `src/auth/` bootstrap folder | Bootstrap lives in `src/lib/secure-auth.ts` (acceptable thin wrapper) |

### Conflicts to resolve during implementation

| Current | TDR requirement | Planned resolution |
|---------|-----------------|-------------------|
| Recovery **code** (17 words, custom list) | Recovery **phrase** (12 or 24 words, user choice) | Phase 1: new phrase UX + envelope; migrate or coexist with deprecation path |
| PBKDF2 fallback in recovery KDF (`recovery-code-fallback.test.ts`) | **Argon2id only** for vault password KDF | Phase 1: remove PBKDF2 for vault password; document `hash-wasm` as primary |
| Plaintext `letters.answered` column | Answered in **encrypted metadata** | Phase 2–3: migrate column away |
| Title in `encrypted_title` JSON field (encrypted) | Title in encrypted metadata + index (still encrypted) | Phase 2: restructure payloads; **never** plaintext at rest (already encrypted today — preserve) |
| `trusted_device` envelope (ADR-002) | Removed — MVP envelopes: password, recovery_phrase, passkey_prf | See `docs/TRUSTED_DEVICES_REMOVAL.md` |
| Legacy product name in UI | **SelahKeep** | Phases 1–5 progressive rebrand |

---

## Security non-negotiables (from TDR)

All phases must preserve:

1. Authentication from `@tgoliveira/secure-auth` only  
2. Vault decryption remains product-specific  
3. Account session does **not** unlock vault  
4. Vault password never leaves browser  
5. Recovery phrase never leaves browser  
6. User Vault Key never leaves browser  
7. Note Keys never leave browser  
8. Passkey PRF output never leaves browser  
9. Note title/body/tags/categories never stored plaintext  
10. Note APIs receive encrypted payloads only  
11. TOTP does not directly unlock vault  
12. Account deletion deletes vault and encrypted notes  

Sentinel phrase tests and `.cursor/rules/testing.md` checklist remain mandatory on every change.

---

## Phase 0 — Auth Reset / Stabilization

### 1. Goal

Remove inconsistent local auth; use `@tgoliveira/secure-auth@0.1.25` as the only account/auth source; stabilize build and deployment; preserve product pages.

### 2. Scope

- Inventory and remove competing local auth modules, services, tests, and client shims
- Thin route/page wrappers delegating to `secureAuth.routes.*`
- `SecureAuthUIProvider` + env mapping in `src/lib/env/secure-auth-from-env.ts`
- Guard test preventing local auth reintroduction
- Preserve letters, vault, trusted devices, recovery passkeys, crypto-client

### 3. Non-goals

- SelahKeep rebrand
- Vault password / recovery phrase redesign
- Notes model migration
- Package upgrades beyond `0.1.25` unless security patch

### 4. Files/modules likely affected

| Action | Paths |
|--------|-------|
| **Done (see `AUTH_RESET_TO_SECURE_AUTH.md`)** | `src/lib/secure-auth.ts`, `src/app/api/auth/**`, `src/app/api/account/**`, `src/app/(auth)/**`, `src/lib/auth/session.ts`, `src/test/security/no-local-auth-implementation.test.ts` |
| **Verify / merge** | ~~Branch `cleanup/auth-reset-secure-auth-package` → `main`~~ **Done** |
| **Docs** | `docs/AUTH_RESET_TO_SECURE_AUTH.md`, `docs/migrations/secure-auth-*.md` |
| **Config** | `next.config.ts`, `vitest.config.ts`, `.env.example`, `docs/VERCEL_ENVIRONMENT_VARIABLES.md` |

### 5. Database impact

None for this phase. Auth tables owned by package `authSchema`; run existing `drizzle` migrations only.

### 6. API impact

All account/auth routes must be thin delegates. Product routes (`/api/letters`, `/api/vault`, `/api/passkeys`, `/api/trusted-devices`) unchanged.

### 7. UI impact

Auth pages remain package wrappers. Account settings at `/settings/account` includes package security (passkeys + TOTP). No SelahKeep branding yet yet.

### 8. Security considerations

- Do not reintroduce local password policy, OAuth, or session revocation
- `login-token-repository` read-only for product vault-unlock follow-up only
- Shared `passkey_credentials` table: coordinate with package (see TODO in `AUTH_RESET_TO_SECURE_AUTH.md`)

### 9. Tests required

- `src/test/security/no-local-auth-implementation.test.ts`
- `src/test/api/secure-auth-delegate-routes.test.ts`
- `src/test/unit/secure-auth-env-and-imports.test.ts`
- Full `npm run test:coverage` (≥90% enforced scope)

### 10. Documentation required

- `docs/AUTH_RESET_TO_SECURE_AUTH.md` (inventory + preserved/removed lists)
- `README.md` auth section + `docs/VERCEL_ENVIRONMENT_VARIABLES.md`

### 11. Acceptance criteria

- [x] `main` contains auth reset; local validation green (`lint`, `test`, `test:coverage`, `build`, `dev` loads `/`)
- [x] No forbidden local auth paths (guard test passes)
- [x] `GET /api/auth/package-health` delegates to package health → `0.1.25`
- [x] Letters/vault/recovery pages preserved (product routes unchanged)
- [x] Lint, test:coverage, build pass
- [ ] Vercel production deploy validated (documented in `docs/VERCEL_ENVIRONMENT_VARIABLES.md`)

### 12. Risks

| Risk | Mitigation |
|------|------------|
| Auth reset branch not merged | Merge before Phase 1 crypto work |
| Passkey post-login vault unlock regression | Documented; addressed in Phase 4 |
| Package passkey + product vault flags on same row | Schema coordination ADR in Phase 1 |

### 13. Dependencies

None (entry phase). **Status: complete on `main`.** Phase 1 may start after reviewing open `TODO_SECURITY_REVIEW_REQUIRED` items in `AUTH_RESET_TO_SECURE_AUTH.md`.

---

## Phase 1 — Vault Crypto Foundation

### 1. Goal

Establish SelahKeep cryptographic foundation: vault setup, Argon2id-only vault password KDF, User Vault Key, password + recovery phrase envelopes, 12/24-word recovery phrase choice, encrypted payload format, no-plaintext API contract.

### 2. Scope

- New **ADR** (or ADR-001/002 revision): Argon2id-only vault password KDF, envelope types (`password`, `recovery_phrase`, `passkey_prf`), User Vault Key lifecycle
- **Vault setup flow** (post-account-registration): vault password/passphrase, recovery phrase length choice, confirmation, envelope creation
- **Browser Argon2id** via `hash-wasm` (already dependency) with documented parameters
- **Schema plan** for `vaults.encrypted_vault_settings`, `vault_unlock_envelopes` (evolve `vault_envelopes`)
- **API contract** for vault init/setup (encrypted blobs only)
- Deprecation plan for legacy recovery **code** (17-word) vs new recovery **phrase** (12/24)

### 3. Non-goals

- Notes list/editor (Phase 2)
- Categories/tags/search (Phase 3)
- Passkey vault envelope implementation (Phase 4 — design only in Phase 1)
- Removing trusted-device envelopes for existing users
- Modifying `@tgoliveira/secure-auth`

### 4. Files/modules likely affected

| Layer | Paths |
|-------|-------|
| **ADR / docs** | `docs/ADR-005_*` (new), updates to `docs/ADR-001_*`, `docs/ADR-002_*`, `docs/ADR-003_*`, `SECURITY.md` |
| **Crypto client** | `src/lib/crypto-client/vault.ts`, `recovery-code.ts` → `recovery-phrase.ts`, `src/lib/validation/encrypted-payload.ts` |
| **Vault module** | `src/modules/vault/services/vault-service.ts`, `src/modules/vault/repositories/vault-repository.ts` |
| **Server shims** | `src/server/services/vault-service.ts`, `src/server/repositories/vault-repository.ts` |
| **API** | `src/app/api/vault/init/route.ts`, new `src/app/api/vault/setup/route.ts` (or extend init) |
| **UI** | `src/app/(vault)/vault/unlock/page.tsx`, new `src/app/(vault)/vault/setup/page.tsx`, `src/features/vault/vault-unlock-panel.tsx` |
| **Policies** | `src/modules/security/policies/plaintext-rejection.ts`, `aad-validation.ts` |
| **Tests** | `src/test/unit/crypto-vault*.test.ts`, `src/test/security/*`, new `src/test/security/vault-setup*.test.ts` |
| **Schema** | `src/lib/db/app-schema.ts`, `drizzle/0008_*` (plan only until approved) |

### 5. Database impact

**Planned (not executed in planning):**

- Extend `user_vaults` with `encrypted_vault_settings`, `encrypted_vault_index` (index may be empty until Phase 2)
- Rename or alias `vault_envelopes` → `vault_unlock_envelopes`; add `type` enum (`password`, `recovery_phrase`, `passkey_prf`)
- Store `kdf_params` on password envelope (Argon2id metadata)
- **No plaintext** vault secrets; preserve `users` FK + cascade delete

```text
TODO_SECURITY_REVIEW_REQUIRED:
Database auth schema migration needs human review before production data migration.
```

### 6. API impact

- `POST /api/vault/init` — evolve for LTG setup payloads (encrypted settings + envelopes)
- `GET /api/vault/status` — expose setup complete / envelope types present (no secrets)
- Reject plaintext: `vaultPassword`, `recoveryPhrase`, `userVaultKey`, `title`, `body`, etc.
- OpenAPI: `docs/openapi.yaml`

### 7. UI impact

- New **vault setup wizard** after first sign-in (if no vault)
- Copy: account password vs vault password vs recovery phrase (per TDR §16.2)
- 12 vs 24 word choice with trade-off explanation
- Recovery phrase show-once + confirmation step
- Update `src/lib/marketing/home-copy.ts` lightly (“vault” language) — full rebrand Phase 5

### 8. Security considerations

- Argon2id **only** for vault password KDF — remove PBKDF2 fallback for vault password path
- Recovery phrase wordlist source decision (open decision #3 in TDR)
- KDF parameters documented and versioned in envelope metadata
- If Argon2id unsafe in target browsers → `TODO_SECURITY_REVIEW_REQUIRED` stop condition
- Vault password ≠ account password (UI + validation)

### 9. Tests required

- Argon2id KDF round-trip (parameters stored/restored)
- Vault password envelope wrap/unwrap User Vault Key
- Recovery phrase 12-word and 24-word generation + confirmation
- Recovery phrase envelope unlock (does not recover old vault password string)
- API rejects plaintext vault fields
- Sentinel phrase never in DB/API/logs
- Security: vault password / phrase / UVK never in network payloads (mock fetch assertions)

### 10. Documentation required

- New crypto ADR (Argon2id, envelopes, UVK)
- Update `SECURITY.md` (remove PBKDF2 fallback for vault password when implemented)
- Update `ARCHITECTURE.md` vault section
- `docs/LTG_VAULT_IMPLEMENTATION_PLAN.md` — mark Phase 1 complete when done

### 11. Acceptance criteria

- [x] User can complete vault setup with vault password/passphrase (`/vault/setup`)
- [x] KDF is Argon2id only for vault password (no silent PBKDF2 on new paths)
- [x] User chooses 12- or 24-word recovery phrase; confirms once
- [x] Password and recovery phrase envelopes unlock same User Vault Key
- [x] Server stores only encrypted envelopes + technical metadata
- [x] `npm run test:coverage` ≥90%
- [x] ADR-005 published (`docs/ADR-005_LTG_Vault_Cryptography_Argon2id_Recovery_Phrase_Note_Keys.md`)
- [x] Purple primary color documented and applied to app-owned vault UI

### 12. Risks

| Risk | Mitigation |
|------|------------|
| Mobile Argon2id memory limits | Benchmark; tunable params; document minimum devices |
| Migration from recovery **code** to **phrase** | Support both envelope types during transition; migration doc |
| `hash-wasm` CSP (`wasm-unsafe-eval`) | Already in `src/proxy.ts`; document in SECURITY |
| Schema break for existing beta users | Migration script + empty-state acceptance |

### 13. Dependencies

**Phase 0** complete. **Phase 1** complete on `main` (ADR-005, `/vault/setup`, Argon2id vault KDF, BIP39 recovery phrase, purple UI tokens).

---

## Phase 2 — Notes Foundation

### 1. Goal

Implement encrypted **notes** (evolving from letters): per-note keys wrapped by User Vault Key, encrypted per-note metadata, encrypted note body (Markdown), encrypted vault index, Markdown editor, create/edit/delete flows.

### 2. Scope

- Introduce `notes` table (or migrate `letters` → `notes` with data migration plan)
- Client: `encryptNote` / `decryptNote` in crypto-client (extend `letters.ts` → `notes.ts`)
- Encrypted metadata blob: title, category id, tag ids, answered flag, dates
- Encrypted vault index blob on `user_vaults` (structure defined in Phase 1 ADR)
- Markdown editor component (headings, bold, italic, lists, quotes, links, preview)
- Routes: `/notes`, `/notes/new`, `/notes/[id]` (parallel or replace `/letters`)
- API: `/api/notes` CRUD with ADR-003 validation

### 3. Non-goals

- Full category/tag CRUD UI (Phase 3 — use placeholders in metadata if needed)
- Local search UI (Phase 3)
- Passkey vault unlock (Phase 4; now an explicit post-login action)
- Attachments, version history
- Autosave (remain disabled per AGENTS.md unless TDR overrides)

### 4. Files/modules likely affected

| Layer | Paths |
|-------|-------|
| **Schema** | `src/lib/db/app-schema.ts` (`notes` table), `drizzle/0009_*` |
| **Module** | `src/modules/letters/**` → `src/modules/notes/**` (rename + extend) |
| **Services** | `src/modules/notes/services/note-service.ts`, `src/server/services/letter-service.ts` shim |
| **Repositories** | `src/modules/notes/repositories/note-repository.ts` |
| **Crypto** | `src/lib/crypto-client/notes.ts`, `src/lib/crypto-client/vault-index.ts` (new) |
| **API** | `src/app/api/notes/route.ts`, `src/app/api/notes/[id]/route.ts`; deprecate `/api/letters` |
| **API client** | `src/lib/api-client/notes.ts` |
| **UI** | `src/app/(vault)/notes/**`, `src/components/notes/**` or `src/features/notes/**` |
| **Editor** | New `src/features/notes/markdown-editor.tsx` (sanitized preview) |
| **Validation** | `src/lib/validation/encrypted-payload.ts`, note request schemas |
| **Tests** | `src/test/api/letters-*` → `notes-*`, `src/test/security/plaintext-rejection.test.ts`, sentinel tests |

### 5. Database impact

- Add `notes` with: `id`, `vault_id`, `encrypted_metadata`, `encrypted_wrapped_note_key`, `encrypted_body`, `body_encryption_version`, timestamps, `deleted_at`
- Add `encrypted_vault_index` to `user_vaults` (if not Phase 1)
- Migration from `letters` → `notes` for existing encrypted rows (script + ADR)
- Remove plaintext `answered` from letters table when migrated into encrypted metadata
- Indexes: `(vault_id, created_at)` — no plaintext search indexes

### 6. API impact

- `POST/GET /api/notes`, `GET/PUT/DELETE /api/notes/:id`
- Request bodies: encrypted payloads only; client-generated UUID for note id
- `GET` list returns encrypted metadata + ids (no decryption server-side)
- Deprecation header or parallel `/api/letters` during transition
- Update `docs/openapi.yaml`, `docs/API_REFERENCE.md`

### 7. UI impact

- Note list (titles visible only when vault unlocked — decrypt client-side)
- Note editor with Markdown + preview (`dangerouslySetInnerHTML` only after sanitization)
- Create/edit/delete/archive flows
- Redirect `/letters` → `/notes` (301 or Next redirect)
- Nav: `src/components/layout/nav.tsx` — “My notes” vs “My letters”

### 8. Security considerations

- AAD binding per ADR-001 (`userId`, `noteId`, `fieldName`, `encryptionVersion`)
- Markdown HTML sanitization (allowlist; no script)
- Note Key never sent to server; only wrapped key blob
- Title encrypted in metadata — verify DB never has plaintext title column
- Physical delete or soft `deleted_at` — decide open decision #7 (recommend `deleted_at` + index update)

### 9. Tests required

- Note create/edit/delete with encrypted payloads
- Per-note key wrap/unwrap
- Vault index update on note mutations
- Markdown editor render + sanitization unit tests
- API rejects `title`, `body`, `content`, `message` plaintext fields
- Sentinel phrase in note body never stored plaintext
- Feature tests for note pages (vault locked gate)

### 10. Documentation required

- Update ADR-001 for note field names
- Update ADR-003 API contract
- `README.md` — notes API
- Migration guide: letters → notes

### 11. Acceptance criteria

- [x] User with unlocked vault can create/edit/delete Markdown notes  
- [x] Each note has unique Note Key wrapped by User Vault Key  
- [x] Title and body encrypted at rest; APIs receive encrypted payloads only  
- [x] Encrypted vault index updated on note changes  
- [x] `/letters` routes redirect or alias to notes  
- [x] All note security tests pass; coverage thresholds met  

### 12. Risks

| Risk | Mitigation |
|------|------------|
| Letters → notes migration breaks existing users | Dual-read period or one-shot migration tool |
| Index corruption | Rebuild from note metadata (TDR §8.3) |
| Markdown XSS | Strict sanitizer + security test |
| Large index in memory | Phase 3 pagination; metadata-only unlock default |

### 13. Dependencies

**Phase 1** (vault setup, UVK, envelopes, payload format).

---

## Phase 3 — Organization and Search

### 1. Goal

Categories (one per note), tags (many per note), answered status in encrypted metadata, local search after vault unlock, vault unlock behavior setting (metadata-only vs decrypt-all).

### 2. Scope

- Encrypted category definitions (in vault settings or index)
- Encrypted tag definitions
- Category/tag assignment in note metadata
- Answered status in encrypted metadata + index
- Client-side search/filter: title, tags, category, answered
- Vault setting: `unlockBehavior: metadata_only | decrypt_all`
- Filters UI on notes list

### 3. Non-goals

- Full-text search over Markdown body
- Server-side search
- Community sharing
- Template library

### 4. Files/modules likely affected

| Layer | Paths |
|-------|-------|
| **Crypto / index** | `src/lib/crypto-client/vault-index.ts`, `src/lib/crypto-client/notes.ts` |
| **Vault settings** | `encrypted_vault_settings` schema (client types in `src/lib/validation/`) |
| **Services** | `src/modules/vault/services/vault-service.ts`, `src/modules/notes/services/note-service.ts` |
| **UI** | `src/app/(vault)/notes/page.tsx`, `src/features/notes/note-filters.tsx`, `src/app/(vault)/vault/settings/page.tsx` (new) |
| **Tests** | `src/test/security/answered-metadata.test.ts` (extend), new search unit tests |

### 5. Database impact

- No new plaintext columns
- Optional: `encrypted_categories` / `encrypted_tags` blobs in `user_vaults` or inside vault index JSON (encrypted)
- Migration: move `letters.answered` boolean into encrypted metadata for legacy rows

### 6. API impact

- `PATCH /api/vault/settings` — encrypted vault settings only (unlock behavior)
- Note APIs unchanged (metadata carries category/tags/answered)
- No search API (local only)

### 7. UI impact

- Category picker (single select)
- Tag multi-select / chip input
- Answered toggle/marker on note detail and list
- Search input + filters (client-side on decrypted index)
- Vault settings: unlock behavior toggle with explanation (TDR §9)

### 8. Security considerations

- Category/tag **names** encrypted at rest
- Search runs only in memory after vault unlock
- `decrypt_all` setting increases memory exposure — explicit opt-in
- TOTP still does not unlock vault

### 9. Tests required

- Category/tag create/assign encrypted round-trip
- Answered status in metadata + index
- Local search finds by title/tag/category
- Answered filter
- Unlock behavior: metadata-only does not decrypt all bodies eagerly
- No plaintext category/tag in API payloads or DB

### 10. Documentation required

- Update TDR-aligned UX copy in `docs/UI_UX_DIRECTION.md`
- `SECURITY.md` — search local-only
- User-facing README section on categories/tags

### 11. Acceptance criteria

- [x] One category per note; multiple tags per note  
- [x] Answered status works and appears in filters  
- [x] Search after unlock by title, tag, category  
- [x] Default unlock behavior: metadata only  
- [x] Optional decrypt-all setting works  
- [x] No plaintext category/tag/title in database  
- [x] Letters domain removed (`/letters`, `/api/letters`, `letters` table)  
- [x] `GET`/`PATCH /api/vault/settings` for encrypted vault settings  
- [x] Guard test `no-letters-domain.test.ts`

### 12. Risks

| Risk | Mitigation |
|------|------------|
| Index size growth | Rebuild strategy; lazy body decrypt |
| Category rename complexity | Encrypt id + display name in index; version index format |
| UX complexity on mobile | Mobile-first filter drawer (Phase 5 polish) |

### 13. Dependencies

**Phase 2** (notes, encrypted metadata, vault index).

---

## Phase 4 — Passkey Vault Unlock

### 1. Goal

Historical Phase 4 implementation: associate a passkey with the vault through a PRF-based envelope.
This phase was superseded by the portable broker decision documented at the top of this file.
The still-current invariant is that account passkey login and vault unlock are separate explicit actions.

### 2. Scope

- Passkey vault unlock ADR (PRF envelope format, opt-in UX)
- Integrate with package account passkeys (`PasskeySettings`, `/api/account/passkeys/*`) without modifying package
- Product route: `POST /api/account/passkeys/[id]/enable-vault-unlock` (exists — align with TDR)
- Account login options/verify remain pure package delegates
- Post-login: explicit product vault unlock through `/api/passkeys/authenticate`
- Fallback messaging: “You are signed in, but your vault is still locked.”

### 3. Non-goals

- Using WebAuthn signatures as encryption keys
- Forcing passkey vault unlock for all users
- Package forks or PRs (analysis only; implement in product layer)
- Trusted device as required MVP envelope

### 4. Files/modules likely affected

| Layer | Paths |
|-------|-------|
| **Services** | `src/server/services/passkey-vault-envelope-service.ts`, `passkey-service.ts` |
| **Crypto** | `src/lib/crypto-client/passkey-vault.ts`, `src/lib/passkey/prf.ts`, `prf-support.ts` |
| **API** | Package-delegated account login routes, `/api/passkeys/authenticate`, `enable-vault-unlock/route.ts` |
| **UI** | `src/app/(vault)/settings/account/page.tsx` (passkey + “unlock vault too?”), `src/app/(vault)/vault/unlock/page.tsx` |
| **Features** | `src/features/passkey/unlock-with-passkey.ts`, `passkey-login-audit.ts` |
| **Tests** | `src/test/security/passkey-login-vault-unlock.test.ts`, `passkey-login-boundary.test.ts`, `passkey-prf.test.ts` |

### 5. Database impact

- `vault_unlock_envelopes.type = passkey_prf` linked to `passkey_credentials.credential_id`
- `passkey_credentials.vault_unlock_enabled` flag (existing)
- `public_metadata` on envelope: `prfRequired`, credential reference

### 6. API impact

- No change to package `passkeyLoginVerify` contract
- No product enrichment on account login options or verify responses
- Explicit vault unlock uses the authenticated account session

### 7. UI impact

- Opt-in: “Use this passkey to unlock your vault too?”
- Account security section: passkey list with vault-unlock status
- Login success leaves the vault locked; the vault UI offers an explicit unlock action
- No account-login vault outcome flags

### 8. Security considerations

- PRF output never sent to server
- No fake/non-PRF envelopes marked compatible
- Account passkey login ≠ vault unlock (separate tests)
- TOTP after passkey login: package behavior; vault still separate

### 9. Tests required

- Passkey vault envelope create/unwrap
- Login with PRF + envelope → vault unlocked
- Login without envelope → signed in, vault locked
- PRF unavailable browser → no envelope creation
- `requiresTotpAfterLogin` boundaries (account vs vault)
- Security: PRF bytes absent from API/logs

### 10. Documentation required

- Update `docs/archive/PASSKEY_LOGIN_VAULT_UNLOCK.md` for SelahKeep
- Update `docs/ADR-002_*` passkey sections
- Resolve `AUTH_RESET` TODO items

### 11. Acceptance criteria

- [x] User can opt in passkey for vault unlock  
- [x] PRF envelope unlocks vault on compatible login  
- [x] Without envelope, account session works; vault stays locked  
- [x] Authentication and vault decryption proven separate in tests  
- [x] No PRF/signature key misuse  

### 12. Risks

| Risk | Mitigation |
|------|------------|
| Package lacks vault-unlock hook in `PasskeySettings` | Product UI + `enable-vault-unlock` route |
| Safari PRF gaps | `prf-support.ts` detection; clear UX |
| Double WebAuthn ceremony annoyance | PRF in first login when possible (`prfIncluded` on options) |

### 13. Dependencies

**Phase 1** (UVK + envelope model). Can parallel **Phase 2–3** for UX but needs vault setup complete.

---

## Phase 5 — MVP Hardening / Private Usability

### 1. Goal

Polish UX, mobile, vault inactivity lock, document no export/import, confirm account deletion cascades vault/notes, prepare private usability testing.

### 2. Scope

- Rebrand UI copy to **SelahKeep** (`src/lib/marketing/home-copy.ts`, `src/app/(public)/page.tsx`, nav, metadata)
- Vault inactivity lock (`src/lib/crypto-client/vault-session.ts` — extend timer)
- Mobile editor/list polish
- Note archive UX (if `deleted_at` soft delete)
- Export/import **not available** banners in settings + README
- Account deletion: verify package `DELETE /api/account` cascades product tables
- Usability + security checklists
- Deployment checklist update

### 3. Non-goals

- Public beta launch
- Community features
- Attachments
- Import/export implementation
- Lowering test coverage thresholds

### 4. Files/modules likely affected

| Layer | Paths |
|-------|-------|
| **Marketing / layout** | `src/app/(public)/page.tsx`, `src/components/layout/nav.tsx`, `site-footer.tsx`, `src/app/layout.tsx` metadata |
| **Vault session** | `src/lib/crypto-client/vault-session.ts`, `src/features/vault/use-vault.ts` |
| **Settings** | `src/app/(vault)/settings/account/page.tsx`, new vault settings section |
| **Docs** | `README.md`, `SECURITY.md`, `docs/LGPD_BETA_GATES.md`, `docs/TESTING_STRATEGY.md` |
| **Tests** | `src/test/features/accessibility.test.tsx`, `site-layout.test.tsx`, E2E-less feature tests |

### 5. Database impact

- Verify `ON DELETE CASCADE` from `users` → `user_vaults`, `notes`, `vault_unlock_envelopes`
- Package account deletion must trigger product cascade (integration test)

### 6. API impact

- Document deprecated `/api/letters` removed
- Admin routes remain no-access to note plaintext

### 7. UI impact

- Calm vault setup/unlock education
- Recovery phrase UX polish
- Mobile navigation and editor
- Explicit “Export not available” copy
- Privacy promise updated for SelahKeep subtitle

### 8. Security considerations

- Inactivity lock clears session UVK from memory (`vault-session`)
- Logout locks vault and clears client state (`nav.tsx` pattern)
- Account deletion audit
- Pre-beta security review checklist from `docs/THREAT_MODEL_Private_Letters_Vault.md` (updated)

### 9. Tests required

- Inactivity lock triggers lock
- Account deletion removes vault + notes (integration with mocked DB or test DB)
- Accessibility pass on main flows
- Full regression: lint, test:coverage, build
- MVP acceptance criteria from TDR §20 (26 items) traceability test or checklist doc

### 10. Documentation required

- `README.md` — SelahKeep quick start
- `SECURITY.md` — align with TDR (Argon2id only; no export)
- `docs/VERCEL_ENVIRONMENT_VARIABLES.md`
- `docs/migrations/secure-auth-deployment-checklist.md` — SelahKeep section
- Private usability test script (new doc or appendix)

### 11. Acceptance criteria

- [x] TDR §20 MVP acceptance criteria (26 items) verified — see `docs/LTG_VAULT_MVP_ACCEPTANCE_CHECKLIST.md`
- [x] Product branded SelahKeep on public pages
- [x] Vault inactivity lock works (15 min default + user notice)
- [x] Export/import documented as unavailable
- [x] Account deletion cascade verified (FK + integration test)
- [x] Private usability checklist completed — `docs/PRIVATE_USABILITY_TEST_SCRIPT.md`
- [ ] Deploy checklist green on staging (operator sign-off)  

### 12. Risks

| Risk | Mitigation |
|------|------------|
| Scope creep into community/attachments | Defer list in “Future Phases” |
| Incomplete migration from letters | Block beta until migration verified |
| Package account deletion incomplete cascade | Product hook or DB FK enforcement |

### 13. Dependencies

**Phases 1–4** complete.

---

## Future Phases (explicitly deferred)

Per TDR, do **not** implement in MVP:

| Feature | Rationale |
|---------|-----------|
| Encrypted attachments | TDR §11 |
| Note version history | TDR §21 |
| Import / export | TDR §21; document absence before public beta |
| Anonymous community sharing | TDR §12 |
| Moderation / anonymization | TDR §12 |
| “I prayed for you” | TDR §12 |
| Full-text encrypted content search | TDR §8.4 |
| Note templates (Prayer, Letter, …) | TDR §10.4 |
| `trusted_device` as primary envelope for new users | Optional; legacy support only |

When scheduled, each requires a new TDR amendment + implementation plan addendum.

---

## Future Product Expansion Opportunities

This section captures future opportunities for SelahKeep after the current MVP has stabilized. These items are **not** part of the immediate MVP unless explicitly promoted into a future implementation phase. The purpose of this section is to provide a structured backlog for product, security, and user-experience evolution while preserving SelahKeep’s core principles: private-by-default writing, client-side encryption, clear vault/account separation, and a calm reflective user experience.

### Guiding Principles

Future enhancements should follow these principles:

1. **Privacy remains the product foundation.** Private note content, note metadata, tags, categories, titles, recovery material, User Vault Keys, Note Keys, and passkey PRF output must never be exposed to the server in plaintext.
2. **Account authentication and vault unlock remain separate.** Signing in proves account ownership; unlocking the vault grants access to encrypted private notes.
3. **Markdown remains the canonical portable content format** unless explicitly changed through an ADR.
4. **User trust is more important than feature breadth.** Features that weaken privacy, introduce ambiguous data handling, or confuse vault security should be deferred.
5. **SelahKeep should not become a generic notes clone.** Its differentiation should come from private encrypted writing, spiritual/reflective workflows, recovery confidence, and a polished writing experience.
6. **AI features must be opt-in and privacy-explicit.** No decrypted note content should be sent to an AI provider without clear user consent.

---

### Priority Track 1 — Security, Recovery, and Trust

**Track status:** **Mostly complete** on `main` (2026-06-16) — vault security review shipped at `/vault/security`.

| Item | Status | Notes |
|------|--------|-------|
| Security Review Mode | ✅ Done | `/vault/security`; entry from `/vault/settings` |
| Vault Health Summary | ✅ Done | `deriveVaultHealthSummary()` |
| Recovery Drill | ✅ Done | `verifyRecoveryPhraseDrill()` — local-only, no envelope rotation |
| Security Event Log | ✅ Done | `GET/POST /api/vault/security-events`; existing `audit_events` |
| Passkey Compatibility Guide | ✅ Done | PRF diagnostics + account vs vault unlock copy |
| Recovery Phrase Checkup | ⏳ Deferred | Word-position confirmation prompt not implemented |
| Last vault unlock method | ⏳ Deferred | UI shows “Not tracked yet” |

These items strengthen user confidence and reduce the risk of data loss.

#### Security Review Mode ✅

**Done** — dedicated security overview at `/vault/security` (entry: **Open security review** on `/vault/settings`).

Shows current protection status without exposing secret material:

- Vault password configured
- Recovery phrase configured
- Recovery phrase last replaced date
- Passkey vault unlock configured / unavailable / unsupported in this browser
- Auto-lock enabled and timeout value (15 min fixed)
- Last vault unlock method — **deferred** (“Not tracked yet”)
- Export/import availability status — **Not available yet**
- Account/vault separation reminder

The goal is to make the user understand whether their vault is well protected without exposing any secret material.

#### Vault Health Summary ✅

**Done** — human-friendly summary on `/vault/security`:

- Protection: Strong / Good / Needs attention / Incomplete
- Recovery: Configured / Missing / Unknown
- Passkey vault unlock: configured or browser-specific status
- Auto-lock: Enabled (15 minutes)
- Export/import: Not available yet

This is not gamified excessively. It supports clarity and trust.

#### Recovery Phrase Checkup ⏳

**Deferred** — periodically prompt the user to confirm that they still have access to their recovery phrase. This must be implemented carefully.

Possible approach:

- Ask the user to confirm selected word positions, such as word 3 and word 9.
- Never display or transmit the full phrase.
- Never store the phrase in plaintext.
- Do not lock the user out if they skip the checkup, but warn clearly.

*Recovery Drill (below) ships first as the trust-building verification path.*

#### Recovery Drill ✅

**Done** — safe **Test recovery phrase** flow on `/vault/security` (`verifyRecoveryPhraseDrill`).

Verifies that the recovery phrase can unwrap the recovery envelope without replacing it.

The flow:

- requires account authentication;
- requires a configured vault;
- requires unlocked vault for full UI (locked state shows partial overview + unlock CTA);
- never sends the recovery phrase to the server;
- confirms whether the phrase works;
- does not rotate or invalidate the phrase.

This is a strong trust-building feature prioritized before public beta.

#### Security Event Log ✅

**Done** — safe audit-style view on `/vault/security` (`vaultSecurityService` + `audit_events`).

Events supported (when recorded):

- Vault unlocked with password / recovery phrase / passkey PRF
- Recovery phrase replaced (server-side audit on replace flow)
- Recovery phrase test succeeded / failed
- Vault locked manually / auto-locked due to inactivity
- Passkey vault unlock enabled / disabled

The event log never includes note content, decrypted metadata, PRF output, recovery phrase, vault password, User Vault Key, or Note Keys.

#### Passkey Compatibility Guide ✅

**Done** — user-facing section on `/vault/security`.

Explains:

- account passkey login is different from vault passkey unlock;
- legacy pre-cutover vault passkey unlock requires WebAuthn PRF;
- some browsers/providers may support passkeys but not PRF;
- vault password and recovery phrase remain fallback methods.

CTA: **Manage passkey vault unlock** → `/vault/settings`.

---

### Priority Track 2 — Writing Experience and Editor Quality

**Track status:** **Mostly complete** on `main` (2026-06-16). See `docs/EDITOR_IMPLEMENTATION_DECISION.md`.

| Item | Status | Notes |
|------|--------|-------|
| Polished Visual Editor | ✅ Done | Tiptap 3 default; Markdown toggle |
| Save and Draft Status | ✅ Done | `EditorStatusBar` incl. save-failed |
| Encrypted Local Drafts | ✅ Done | IndexedDB AES-GCM (`note-drafts.ts`) |
| Expanded Note Templates | ✅ Done | 14 local templates |
| Quick Insert Menu | ✅ Done | `+ Insert` toolbar menu |
| Focus Mode | ✅ Done | Toggle on new/edit pages |
| Daily Note | ✅ Done | `/notes` → index lookup or `?daily=1` |

These items improve the core daily-use experience.

#### Polished Visual Editor ✅

Tiptap 3 visual editor is default on `/notes/new` and edit mode. Markdown/source via toolbar toggle. Canonical body format remains Markdown (encrypted client-side). Compact toolbar, purple SelahKeep styling, sanitized paste/preview.

#### Save and Draft Status ✅

States: Saved, Saving…, Unsaved changes, Draft saved on this device, Save failed. Status reflects encrypted persistence only.

#### Better Encrypted Local Drafts ✅

Encrypted IndexedDB drafts; restore/discard UX; cleared on successful save. No plaintext at rest.

#### Note Templates ✅

14 local templates (Blank through Goal). Selector on new note; replace confirmation when content exists.

#### Quick Insert Menu ✅

`+ Insert` menu: heading, checklist, quote, divider, prayer section, gratitude list, decision block, reflection section, action items.

#### Focus Mode ✅

Distraction-free toggle hides non-essential chrome; save/status and vault dock remain available.

#### Daily Note ✅

**New daily note** on `/notes` opens `Daily note — YYYY-MM-DD` from decrypted index or creates draft with Journal template.

---

### Priority Track 3 — Organization, Views, and Note Lifecycle ✅

These items help users manage a growing vault. Implemented on `main` — see `SECURITY.md` and `docs/UI_UX_DIRECTION.md`.

#### Pinned Notes ✅

Allow users to pin important notes to the top of the list.

Pinned state must be stored only in encrypted metadata/index.

#### Favorites ✅

Add a separate favorite marker for notes that are important but not necessarily resolved.

This should be distinct from “resolved”.

#### Archive ✅

Allow users to archive notes without deleting them.

Archived notes should remain encrypted and retrievable through a filter.

#### Trash / Recently Deleted ✅

Add a recoverable delete flow.

Possible behavior:

- deleted notes move to Trash;
- Trash retains encrypted notes for a defined period or until manually emptied;
- permanent delete requires confirmation.

Trash auto-purge is **not** implemented yet.

#### Smart Local Filters ✅

Add local filters based on decrypted index data after unlock.

Possible filters:

- Recently updated
- Resolved
- Unresolved
- No category
- No tags
- Pinned
- Checklist notes
- Archived
- Drafts

No plaintext server-side filtering should be added for encrypted metadata.

#### Saved Views ✅

Allow users to save common filter combinations locally or in encrypted vault settings.

Saved views must not expose plaintext criteria to the server unless encrypted.

#### Compact/List View ✅

Add a display mode for users with many notes.

Possible modes:

- Card view
- Compact list view

#### Duplicate Note ✅

Add a “Duplicate note” action.

The duplicated note should receive a new Note Key and a new encrypted note body/metadata payload.

---

### Priority Track 4 — Search and Discovery ✅

These items increase usefulness once users have many notes. Implemented on `main` — see `SECURITY.md` (client-side search).

#### Local Full-Text Search After Unlock ✅

Add local search over decrypted note bodies after vault unlock.

Important requirements:

- search happens only client-side after vault unlock;
- no plaintext search query is sent to the server;
- decrypted note bodies are searched only in memory;
- search state is cleared when the vault locks.

**Status:** Implemented — metadata + body search via `useNoteSearchBodies` and `matchNoteText()`.

#### Encrypted Local Search Index — deferred

Create an encrypted search index that can be stored with the vault.

```text
TODO_SECURITY_REVIEW_REQUIRED:
Encrypted persistent search index is deferred. Current search uses in-memory decrypted notes after vault unlock only.
```

**Status:** Deferred — see Track 4 implementation doc.

#### Search Result Highlighting ✅

Highlight matching terms in search results and note view.

Highlighting must happen client-side after unlock.

**Status:** Implemented — `HighlightedText`, `SearchResultSnippet`, detail view highlighting.

#### Recently Viewed Notes ✅

Add a local or encrypted record of recently viewed notes.

If persisted, the recently viewed list must be encrypted because it may reveal sensitive behavior.

**Status:** Implemented — `recentlyViewed` in encrypted vault index; smart filter chip; Views menu entry.

---

### Priority Track 5 — Reflective and Spiritual Workflows ✅

These features give SelahKeep a stronger product identity beyond generic notes. Implemented on `main` — see `SECURITY.md` (reflective workflows).

**Status:** Implemented (2026-06-18).

#### Resolved Reflection ✅

When marking a note as resolved, optionally prompt the user:

- What changed?
- How was this resolved?
- What do you want to remember?

Stored in encrypted note metadata (`resolvedReflection`). Reopening clears the current reflection (MVP).

#### Prayer / Reflection Timeline ✅

Timeline on `/notes/[id]` from encrypted `lifecycleEvents` + synthetic created event. Reverse-chronological (newest first). Progressive disclosure (“Show timeline”).

#### Remembrance Mode ✅

Route: `/notes/remembrance`. Resolved notes with saved reflection (`hasResolvedReflection` index flag). Entry from Views menu. Hidden when vault locked.

#### Weekly Reflection ✅

Route: `/notes/weekly-reflection`. Sections: created this week, resolved this week, gratitude notes, open reflections, carry-forward prompt. Local timezone week (Monday–Sunday). Optional encrypted weekly reflection note (category “Weekly Reflection”).

#### Prompt Cards ✅

Static local prompts in `/notes/new`, weekly reflection, empty states. Insert into editor. No AI/network.

---

### Priority Track 6 — Export, Import, and Portability

Export/import is deferred from the MVP, but it is important before public beta.

#### Encrypted Export

Support an encrypted SelahKeep export file.

Potential format:

- `.selahkeep`
- encrypted vault metadata
- encrypted notes
- encrypted categories/tags/index
- versioned manifest
- no plaintext by default

This should allow users to back up their vault without exposing private content.

#### Decrypted Markdown Export

Offer plain Markdown export only after strong warnings.

The user must understand that decrypted export files are no longer protected by SelahKeep encryption.

#### Import Markdown

Allow importing Markdown files as encrypted notes.

Imported content should be encrypted before being persisted.

#### Future Imports

Possible future imports:

- Obsidian
- Notion Markdown export
- Apple Notes export, if feasible
- Generic ZIP of Markdown files

These should not be prioritized before encrypted export.

---

### Priority Track 7 — Multi-Device and Passkey Experience

These items improve reliability across browsers and devices.

#### New Device Setup Flow

When a user signs in from a new browser:

- explain that the account is signed in but the vault remains locked;
- guide the user to unlock with vault password or recovery phrase;
- explain passkey PRF availability if relevant.

#### Passkey PRF Compatibility UX

Show browser/provider diagnostic results in a user-friendly way.

Example:

- Passkeys for sign-in: available
- Passkey vault unlock: unavailable here
- Reason: PRF not supported by this browser/provider

This should reduce confusion.

#### Passkey Vault Unlock Test

Allow users to test whether an existing passkey vault unlock still works, without changing configuration.

This must never delete, replace, or invalidate a passkey PRF envelope from a browser that cannot use PRF.

#### Do Not Reintroduce Trusted Devices

Trusted Devices were intentionally removed. They should not return as a shortcut for multi-device convenience.

The preferred path is:

- vault password;
- recovery phrase;
- passkey PRF where supported;
- clear new-device UX.

---

### Priority Track 8 — AI Features, Only With Explicit Privacy Controls

AI features may be valuable but should be deferred until the privacy model is explicit and trusted.

Possible AI features:

- Suggest title
- Summarize note
- Extract action items
- Turn note into checklist
- Suggest reflection prompts
- Rewrite as prayer
- Identify themes across notes

However, these features should only be implemented if one of the following is true:

1. processing happens locally/on-device; or
2. the user explicitly opts in to sending decrypted content to an AI provider; or
3. the feature does not use decrypted note content.

Required UX for cloud AI:

- clear warning before sending decrypted content;
- explicit user action;
- no default background AI processing;
- provider disclosure;
- privacy documentation.

AI should not be added until the core product trust model is mature.

---

### Priority Track 9 — Commercial and Product Packaging

These ideas are only relevant if SelahKeep becomes a public product.

#### Free / Pro Plan Structure

Possible free tier:

- limited notes;
- basic encrypted vault;
- manual recovery;
- no advanced export/search.

Possible paid tier:

- more notes/storage;
- encrypted export;
- advanced local search;
- additional templates;
- timeline/reflection features;
- priority security features.

Plan limits must not compromise access to already-created private notes.

#### Local-First Positioning

Marketing can emphasize:

- private notes encrypted before leaving the browser;
- account login is separate from vault unlock;
- recovery phrase ownership;
- no server-side access to note content.

Avoid overclaiming security guarantees.

---

### Priority Track 10 — Technical and Operational Hardening

These items improve maintainability and confidence.

#### Stronger No-Plaintext Tests

Expand automated tests to prove that plaintext titles, body, tags, categories, recovery phrase, vault password, User Vault Key, Note Keys, and PRF output do not appear in:

- API payloads;
- server logs;
- database fields;
- local persistent drafts.

#### Crypto Version Dashboard

Add a dev-only view showing:

- vault encryption version;
- note encryption version;
- KDF parameters;
- envelope types;
- migration status.

No secrets should be displayed.

#### Migration Framework

Because encrypted data is difficult to migrate, build a careful migration framework for future crypto or metadata changes.

Requirements:

- versioned payloads;
- client-side migration where needed;
- safe backup/export path before major migrations;
- explicit tests for old payload compatibility.

#### Security Review Checklist

Maintain a checklist for future feature reviews:

- Does this feature expose decrypted content?
- Does it require server-side plaintext?
- Does it change vault unlock?
- Does it affect recovery?
- Does it persist local plaintext?
- Does it interact with account authentication?
- Does it require a new ADR?

---

### Features Explicitly Deferred

The following should remain out of scope until explicitly promoted:

- social/community features;
- public prayer wall;
- sharing notes;
- collaboration;
- comments;
- attachments;
- images;
- AI reading note content by default;
- Trusted Devices;
- complex permissions;
- folders + spaces + categories all at once;
- native mobile app;
- real-time sync/collaboration;
- import/export before security design is complete.

---

### Suggested Near-Term Prioritization

Recommended order after the current editor polish work:

1. Recovery phrase test flow.
2. Security review / vault health screen.
3. Stronger encrypted local draft behavior.
4. Local full-text body search after unlock.
5. Pinned notes, favorites, archive, and trash.
6. Reflection/timeline/remembrance workflows.
7. Encrypted export.
8. Passkey PRF compatibility UX improvements.
9. Compact list view for large vaults.
10. AI features only after explicit privacy design.

The strongest near-term product differentiation is likely to come from the combination of:

- polished visual editor;
- reliable recovery experience;
- strong encrypted local search;
- reflection/remembrance workflows;
- clear privacy and security posture.

---

## Cross-cutting migration strategy

```text
Phase 0 ──► Phase 1 (crypto + vault setup)
                │
                ├──► Phase 4 (passkey vault) ──┐
                │                               │
                └──► Phase 2 (notes) ──► Phase 3 (org + search)
                                                │
                                                └──► Phase 5 (hardening)
```

### Letters → notes

1. Introduce `notes` table alongside `letters` (Phase 2)  
2. Client dual-write or one-shot migration tool for beta users  
3. Redirect routes; remove `letters` table in later migration after data verified  

### Recovery code → recovery phrase

1. Phase 1: new `recovery_phrase` envelope type  
2. Existing `recovery_code` envelopes remain valid until user rotates  
3. UI copy migration: “recovery code” → “recovery phrase”  

### KDF policy

1. Phase 1: vault **password** envelope uses Argon2id only  
2. Deprecate PBKDF2 fallback paths in `recovery-code.ts` for new setups  
3. Update `.cursor/rules/crypto.md` and `SECURITY.md` when implemented  

---

## Major implementation risks (summary)

| # | Risk | Phase | Severity |
|---|------|-------|----------|
| 1 | Argon2id performance on low-end mobile | 1 | High |
| 2 | Schema migration with existing encrypted letters | 2 | High |
| 3 | Plaintext `answered` column legacy | 3 | Medium |
| 4 | Encrypted vault index corruption / size | 2–3 | Medium |
| 5 | Package vs product passkey row coordination | 0, 4 | High |
| 6 | Explicit post-login vault unlock without local auth shim | 4 | Medium |
| 7 | Markdown XSS | 2 | High |
| 8 | Account deletion cascade incomplete | 5 | High |
| 9 | TDR vs ADR-002 trusted-device scope drift | 1 | Low (document) |
| 10 | Open wordlist / KDF params undecided | 1 | Medium → ADR required |

---

## Traceability: TDR → phases

| TDR requirement | Phase |
|-----------------|-------|
| `@tgoliveira/secure-auth` only auth | 0 |
| Vault password + Argon2id only | 1 |
| 12/24 recovery phrase | 1 |
| User Vault Key + envelopes | 1 |
| Encrypted notes + per-note keys | 2 |
| Markdown editor | 2 |
| Encrypted metadata + vault index | 2–3 |
| Categories, tags, answered | 3 |
| Local search | 3 |
| Unlock behavior setting | 3 |
| Passkey vault unlock MVP | 4 |
| Account deletion deletes vault | 5 (verify) |
| No export/import MVP | 5 (document) |
| SelahKeep branding | 5 |

---

## Related documents

| Document | Role |
|----------|------|
| [`docs/TDR_LTG_Vault_MVP.md`](./TDR_LTG_Vault_MVP.md) | Product/architecture source of truth |
| [`docs/AUTH_RESET_TO_SECURE_AUTH.md`](./AUTH_RESET_TO_SECURE_AUTH.md) | Phase 0 auth boundary |
| [`docs/ADR-005_*`](./ADR-005_LTG_Vault_Cryptography_Argon2id_Recovery_Phrase_Note_Keys.md) | Active vault crypto |
| [`docs/ADR-006_*`](./archive/ADR-006_LTG_Vault_Passkey_PRF_Unlock.md) | Superseded legacy PRF design |
| [`docs/ADR-005_*`](./ADR-005_LTG_Vault_Cryptography_Argon2id_Recovery_Phrase_Note_Keys.md) | Active vault crypto ADR |
| [`docs/ADR-006_*`](./archive/ADR-006_LTG_Vault_Passkey_PRF_Unlock.md) | Superseded legacy PRF ADR |
| [`docs/README.md`](./README.md) | Documentation index |
| `AGENTS.md` | Agent workflow + test thresholds |

---

## Planning confirmation

- **This file is planning only.** No application code, database schema, routes, or auth behavior was changed to produce it.
- Implementation must not modify `@tgoliveira/secure-auth` package code; only thin app integration as today.
