# TDR — SelahKeep MVP

> Former working name: LTG Vault. Current product name: SelahKeep.

> **Current-surface notice (2026-07-29):** This TDR remains the foundational product record, but
> its package versions, implementation inventory, and PRF passkey design are historical. Portable
> passkey unlock through the direct browser-to-broker flow supersedes those passkey sections. Use
> [`PORTABLE_PASSKEY_VAULT.md`](./PORTABLE_PASSKEY_VAULT.md), `SECURITY.md`, and
> `docs/CURRENT_PRODUCT_SURFACE.md` for current implementation guidance. PRF envelopes are
> compatibility-only reads and must not be used for new enrollment.

## 1. Status

| Field | Value |
|-------|--------|
| **Status** | Foundational record; implementation details partially superseded |
| **Repository** | [https://github.com/tgoliveira11/selahkeep](https://github.com/tgoliveira11/selahkeep) |
| **Product name** | SelahKeep |
| **Product direction** | Encrypted private vault for prayers, reflections, and personal notes |
| **Primary auth dependency** | `@tgoliveira/secure-auth@0.1.25` |
| **Decision type** | Product / Architecture / Security / MVP Scope |

---

## 2. Executive Summary

The current product evolved from a private spiritual journaling app: a place where users could write personal reflections, keep them safely, and mark them as answered.

The new direction keeps the emotional and spiritual core of the product, but expands it into a broader encrypted notes vault:

> **SelahKeep** is a private encrypted space for prayers, reflections, and notes.

The product should **not** become a generic encrypted notes app. Its differentiation is the combination of privacy, reflection, spirituality, personal journaling, and long-term remembrance.

### MVP capabilities

The MVP should allow users to:

- Authenticate through `@tgoliveira/secure-auth`
- Create and unlock a private vault
- Protect the vault with a dedicated vault password/passphrase
- Derive vault unlock keys using **Argon2id only**
- Create a recovery phrase with either **12 or 24 words**, chosen by the user
- Associate a passkey with the vault for vault unlock in the MVP
- Create encrypted Markdown notes
- Assign **one category** to each note
- Assign **multiple tags** to each note
- Mark notes as **answered**
- Search by decrypted title, category, and tags **after unlocking the vault**
- Choose whether note contents are opened only when clicked or decrypted automatically after vault unlock
- Keep note titles, tags, categories, Markdown body, and sensitive metadata **encrypted at rest**

### Future phases (not MVP)

- Encrypted attachments
- Note version history
- Import/export
- Anonymous community sharing
- “I prayed for you” interactions
- Moderation and anonymization for shared notes
- Full-text search over decrypted note bodies

---

## 3. Product Positioning

### 3.1 Product Name

**SelahKeep**

**Subtitle:** A private encrypted space for prayers, reflections, and notes.

### 3.2 Product Identity

**Primary brand color:** purple (calm, elegant — see `docs/UI_UX_DIRECTION.md`).

The product should feel:

- Calm
- Private
- Hopeful
- Trustworthy
- Simple
- Warm
- Mobile-first
- Spiritually meaningful without being heavy-handed
- Useful beyond a single “letter” flow

### 3.3 What the Product Is

SelahKeep is:

- A private encrypted vault
- A place for personal letters
- A place for prayers
- A place for reflections
- A place for spiritual notes
- A place for personal journaling
- A place to remember answered prayers or meaningful moments

### 3.4 What the Product Is Not

SelahKeep should **not** become:

- A generic Notion clone
- A corporate notes tool
- A collaborative document editor
- A productivity-first knowledge base
- A crypto-heavy technical demo
- A social network in the MVP

---

## 4. Superseding Existing Decisions

This TDR supersedes previous product assumptions where they conflict with this new direction.

| Previous assumption | New decision |
|---------------------|--------------|
| The primary object is a private **letter** | The primary object is an encrypted **note** inside a private vault |
| A letter has a simple private body and may be marked as answered | A note may represent a letter, prayer, reflection, gratitude entry, decision journal, or other private content. It has a title, Markdown body, category, tags, and optional answered status |
| Title may be stored openly for easier discovery | Titles must be visible **after vault unlock**, but must **not** be stored in plaintext in the database |

Existing architecture should be reused where appropriate, but older architectural decisions must not prevent this new MVP from being implemented correctly.

---

## 5. High-Level Architecture

The project should broadly keep the existing architecture:

- Next.js
- TypeScript
- PostgreSQL
- Drizzle ORM (if already used)
- API-first boundaries
- `@tgoliveira/secure-auth` for authentication/account flows
- Client-side encryption for vault/note content
- Mobile-first UI

### 5.1 Account Authentication vs Vault Decryption

**Authentication and vault decryption must remain separate.**

| Layer | Meaning |
|-------|---------|
| **Account authentication** | Proves who the user is |
| **Vault decryption** | Opens the private content |

The account system must come from:

```text
@tgoliveira/secure-auth@0.1.25
```

The app must **not** keep competing local authentication/account implementations.

The vault is **product-specific** and remains owned by `letter-to-god`.

### 5.2 Secure Auth Responsibilities

`@tgoliveira/secure-auth` should own:

- Account creation
- Login / logout
- Password login
- OAuth / social login
- Passkey **account** authentication (if enabled)
- Email verification
- Forgot / reset password
- Change password
- Account sessions
- Session revocation
- TOTP / two-factor authentication for **account** protection (if enabled)
- Account deletion flows (if provided by the package)

### 5.3 SelahKeep Responsibilities

The `letter-to-god` app should own:

- Vault creation
- Vault password/passphrase setup
- Recovery phrase setup
- Vault unlock / lock
- Encrypted note storage
- Encrypted note index
- Encrypted Markdown note body
- Encrypted categories
- Encrypted tags
- Answered status
- Local search after vault unlock
- Vault-specific UX
- Passkey **vault** unlock
- Future encrypted attachments
- Future community sharing

---

## 6. Core Product Model

### 6.1 Vault

A user has a vault.

The vault contains:

- Vault settings
- Encrypted note records
- Encrypted category/tag/index data
- Vault unlock envelopes

The vault is unlocked **client-side only**.

The server must **never** receive:

- Vault password
- User Vault Key
- Note Keys
- Decrypted note body
- Decrypted title
- Decrypted category names
- Decrypted tag names
- Recovery phrase
- Passkey PRF output

### 6.2 Note

A **note** is the core content object.

Each note has:

- A title
- A Markdown body
- One category
- Zero or more tags
- Optional answered status
- Created / updated dates
- Optional archived/deleted state
- Future encrypted attachments

A note can represent:

- A letter to God
- A prayer
- A gratitude entry
- A reflection
- A private note
- A decision journal
- A personal record
- An answered prayer

### 6.3 Category

Each note belongs to **one** category.

Examples: Prayers, Gratitude, Reflections, Questions, Decisions, Family, Work, Health, Answered.

**Category names must not be stored in plaintext.**

### 6.4 Tags

Each note may have **multiple** tags.

Examples: faith, career, marriage, money, healing, anxiety, decision, answered.

**Tag names must not be stored in plaintext.**

### 6.5 Answered Status

The existing idea of marking a letter as answered remains valuable, generalized to notes.

Useful for:

- Answered prayers
- Meaningful moments
- Fulfilled hopes
- Resolved decisions
- Spiritual milestones

Answered status should be stored inside **encrypted note metadata** and reflected in the **encrypted vault index**.

---

## 7. Encryption Architecture

### 7.1 Core Principle

Private content must be encrypted **before** it leaves the browser. The backend stores encrypted payloads only.

### 7.2 Recommended Key Model

```text
Vault Password / Recovery Phrase / Passkey Envelope
  ↓
Unlocks User Vault Key
  ↓
User Vault Key unwraps Note Keys and encrypted vault index
  ↓
Note Keys encrypt note metadata, note body, and future attachments
```

### 7.3 User Vault Key

- Randomly generated client-side
- High entropy
- Never sent to the server in plaintext
- Wrapped by one or more unlock envelopes

### 7.4 Note Keys

**Final decision:** Each note has its own Note Key.

- The Note Key is wrapped by the User Vault Key
- The note body and sensitive metadata are encrypted with the Note Key or a derived note content key

**Rationale:** better isolation, future sharing, attachment model, rotation model; avoids coupling all note content to one single content key.

### 7.5 Unlock Envelopes

MVP required envelope types:

| Type | Purpose |
|------|---------|
| `password` | Vault password/passphrase |
| `recovery_phrase` | Recovery words |
| `passkey_prf` | PRF-based passkey vault unlock |

The legacy `trusted_device` envelope type was removed from the product — see `docs/TRUSTED_DEVICES_REMOVAL.md`.

Each envelope allows the user to unwrap the User Vault Key through a different unlock method.

### 7.6 Vault Password / Passphrase

- Must be **different** from the account password
- User-facing: *Your account password signs you in. Your vault password opens your private notes.*
- Passphrase-friendly UX encouraged
- Must not reuse account password silently
- Must not store or send vault password to the server

### 7.7 Password-Based Key Derivation

**Final decision: Argon2id only. No PBKDF2 fallback.**

The MVP must implement Argon2id for deriving the wrapping key from the vault password/passphrase in the browser.

Requirements:

- Use a reviewed Argon2id library compatible with the browser
- Document memory/time parameters
- Choose parameters secure but acceptable on mobile
- Store KDF parameters with the password envelope
- Support future parameter upgrades
- Add tests for KDF parameter handling
- Do **not** silently downgrade to PBKDF2

If Argon2id cannot be implemented safely:

```text
TODO_SECURITY_REVIEW_REQUIRED:
Argon2id browser implementation could not be completed safely.
```

### 7.8 Recovery Phrase

**Final decision:** The user chooses either a **12-word** or **24-word** recovery phrase.

The recovery phrase recovers **vault access**, not the old vault password.

Requirements:

- Generate recovery words client-side
- Let user choose 12 or 24 words
- Explain trade-off (12: easier to store; 24: stronger, more responsibility)
- Show phrase once; require confirmation
- Create recovery envelope for User Vault Key
- Never store recovery words in plaintext
- Explain that losing both vault password and recovery phrase may make recovery impossible

**Wording:** prefer “Recovery phrase” or “Recovery words”. Say “Recover access to your vault”, not “Recover your password”.

### 7.9 Passkey Vault Unlock

**Final decision: Passkey vault unlock is part of the MVP.**

Passkey account login and passkey vault unlock **must remain separate**.

| Rule | Behavior |
|------|----------|
| Passkey may authenticate the account | Yes |
| Same passkey may unlock vault | Only with valid PRF-based vault envelope |
| Otherwise | User signed in; vault remains locked |

Requirements:

- User must explicitly opt in to passkey vault unlock
- Valid PRF-based passkey vault envelope
- Do not use WebAuthn signatures as encryption keys
- Do not create fake vault envelopes
- Do not mark non-PRF envelopes as passkey-compatible

Suggested prompt: *Use this passkey to unlock your vault too?*

If passkey login succeeds but vault unlock cannot happen: *You are signed in, but your vault is still locked.*

### 7.10 TOTP / Second Factor

TOTP is for **account** protection and sensitive **actions**, not primary vault cryptographic unlock.

**Use TOTP/2FA for:** login step-up; changing vault settings; adding/removing vault unlock methods; exporting vault data; deleting vault; regenerating recovery phrase; disabling passkey vault unlock.

**Do not** rely on TOTP alone to derive or unwrap vault keys.

---

## 8. Encrypted Metadata and Search

### 8.1 Title Visibility

- **Before vault unlock:** titles not visible
- **After vault unlock:** titles decrypted locally and shown in UI
- **At rest:** titles never plaintext in database

### 8.2 Tags and Categories

Encrypted at rest. After vault unlock, client decrypts titles, category names, tag names, answered status, and optional summaries.

### 8.3 Encrypted Per-Note Metadata + Encrypted Vault Index

**Final decision:** Use **both**.

| Role | Data |
|------|------|
| **Source of truth** | Encrypted metadata on each note |
| **Search/list cache** | Encrypted vault index |

Rationale: fast listing/search; resilience if index corrupted (rebuild from note metadata); no plaintext title/tag/category storage.

The encrypted index may contain: note ID, title, category ID/name, tag IDs/names, answered status, dates, archived/deleted state, optional preview (if explicitly chosen). Index is encrypted at rest.

After vault unlock, browser decrypts index and builds local search model.

### 8.4 Search

- **MVP:** local search only after vault unlock
- **Fields:** title, tags, category, answered/unanswered filter
- **Deferred:** full-text search over Markdown body
- **Forbidden:** plaintext server-side search over titles, tags, categories, or body

---

## 9. Vault Opening Behavior

User setting controls how much content opens after unlock.

### 9.1 Default — Metadata Only

After unlock: show titles, categories, tags, note list; open body only on click. **Default.**

Benefits: safer, faster, less sensitive content in memory, better for large vaults.

### 9.2 Optional — Open All Notes

After unlock: decrypt all note bodies immediately. Explicit user setting only.

Risks: more content in memory, slower on mobile.

---

## 10. Markdown Editor

### 10.1 Editor Scope (MVP)

Headings, bold, italic, lists, quotes, links, preview mode. Not a full Notion-like editor.

### 10.2 Markdown Storage

Markdown source encrypted as part of note body. Preview generated client-side after decrypt.

### 10.3 HTML Sanitization

Rendered Markdown must be sanitized. No unsafe HTML/script execution.

### 10.4 Templates (future)

Prayer, Letter, Gratitude, Reflection, Decision journal, Answered prayer — deferred.

---

## 11. Attachments

**Final decision: Encrypted attachments are deferred** (not MVP).

Future requirements: client-side file encryption, encrypted filenames/metadata, per-attachment keys, no plaintext upload, no plaintext filenames, no server-side preview of encrypted content.

---

## 12. Community Sharing — Future Phase

Not part of initial vault MVP.

Future: opt-in anonymous sharing, moderation, anonymization, “I prayed for you” counts. Must not be implied as live until implemented.

---

## 13. Functional Requirements — MVP

### 13.1 Account

- Authentication via `@tgoliveira/secure-auth`; no competing local auth
- Login/session separate from vault unlock
- Account password reset does **not** unlock or reset vault
- **Account deletion deletes vault and all encrypted notes**

### 13.2 Vault Setup

Vault password/passphrase; 12 or 24 word recovery phrase; User Vault Key; password, recovery, and passkey envelopes; encrypted vault configuration.

### 13.3 Vault Unlock

Vault password/passphrase; recovery phrase; configured passkey vault unlock.

### 13.4 Vault Lock

Manual lock; lock on logout, session expiration, optional inactivity timeout; browser refresh per vault session design.

### 13.5 Notes

Create, edit, delete/archive, list, detail, Markdown, category, tags, answered, title updates, search/filter after unlock.

### 13.6–13.8 Categories, Tags, Search

As defined in sections 6 and 8.

### 13.9 Settings

Unlock behavior (metadata only vs decrypt all); recovery phrase status/length; vault password change; passkey vault unlock status; future export/import notice.

---

## 14. Data Model — Conceptual

### 14.1 Public / Technical Tables

May include: `users`, `vaults`, `notes`, `vault_unlock_envelopes`, `note_versions` (future), `attachments` (future).

Open technical metadata: IDs, owner user ID, timestamps, encrypted payload version, cipher suite version.

### 14.2 Encrypted Vault Data

Server stores encrypted blobs for: vault settings, vault index, note metadata, note body, category/tag definitions, future attachment metadata.

### 14.3 Suggested Tables

**`vaults`:** `id`, `user_id`, `crypto_version`, `encrypted_vault_settings`, `encrypted_vault_index`, `created_at`, `updated_at`, `deleted_at`

**`vault_unlock_envelopes`:** `id`, `vault_id`, `type`, `public_metadata`, `encrypted_user_vault_key`, `kdf_params`, `created_at`, `updated_at`, `revoked_at`

Envelope types: `password`, `recovery_phrase`, `passkey_prf`, `trusted_device_future`

**`notes`:** `id`, `vault_id`, `encrypted_metadata`, `encrypted_wrapped_note_key`, `encrypted_body`, `body_encryption_version`, `created_at`, `updated_at`, `deleted_at`

**`note_attachments`** (future): as in TDR workshop notes.

### 14.4 No Plaintext Fields

Do not store in plaintext: note title, body, category name, tag name, preview, recovery phrase, vault password, User Vault Key, Note Key, attachment filename, sensitive attachment metadata.

---

## 15. API Design Principles

API-first; vault/note persistence receives **encrypted payloads only**.

APIs may receive: encrypted metadata/body/index/envelope data, technical IDs, timestamps, version fields.

APIs must **not** receive: plaintext title, body, tags, categories, vault password, recovery phrase, User Vault Key, Note Key, PRF output.

---

## 16. UX Requirements

- **Landing:** explain SelahKeep, privacy, account vs vault, current features; community sharing as future
- **Vault setup:** calm education on account vs vault password vs recovery phrase; 12/24 word choice
- **Vault unlock:** clear, non-jargon
- **Passkey vault:** optional, separate from login; signed-in-but-locked messaging
- **Notes:** filters, list, Markdown editor, preview, answered marker, search, category/tag editor
- **Mobile-first:** quick writing, simple unlock, search, readable list, focused editor

---

## 17. Security Requirements

### 17.1 Must Never Happen

Never: send plaintext note fields to server; log vault secrets or decrypted content; use account password as vault password; unlock vault from account session alone; use TOTP as direct vault key; use WebAuthn signatures as encryption keys.

### 17.2 Logging

No vault password, recovery phrase, User Vault Key, Note Keys, decrypted content/metadata, raw auth tokens, TOTP codes, or PRF output in logs.

### 17.3 Account Reset

Resetting account password does **not** reset vault password. User can sign in; vault stays locked until vault password, recovery phrase, or vault passkey.

### 17.4 Account Deletion

**Final decision:** Deleting the account deletes vault and all encrypted notes (vault, notes, index, envelopes, categories/tags, future attachments). Backup retention must be disclosed in privacy/legal docs if applicable.

---

## 18. Testing Requirements

Cover: auth package integration; vault setup; Argon2id; envelopes; 12/24 word recovery; passkey vault; lock/unlock; notes CRUD; Markdown; encrypted persistence; categories/tags; answered; local search; unlock behavior settings; no plaintext APIs/logs; account reset does not unlock vault.

Security regression: APIs reject plaintext; encrypted at rest; secrets never leave client; sentinel phrase tests.

Do not lower existing coverage thresholds. Target vault/crypto/security modules ≥ 95% where enforced.

---

## 19. Phased Delivery Plan

### Phase 0 — Auth Reset / Stabilization

Remove inconsistent local auth; use `@tgoliveira/secure-auth` as only account source; stabilize build/deploy; preserve product pages.

### Phase 1 — SelahKeep MVP Foundation

Reposition UI to SelahKeep; vault setup; Argon2id; vault password; 12/24 recovery phrase; User Vault Key; password and recovery envelopes; passkey vault unlock design; encrypted notes model; encrypted metadata and body.

### Phase 2 — Notes, Markdown, Categories, Tags, Search

Markdown editor; note CRUD; encrypted per-note metadata and vault index; categories; tags; answered; local search; unlock behavior setting.

### Phase 3 — Passkey Vault Unlock Completion

Associate passkey with vault; PRF envelope; account passkey login leaves the vault locked; explicit passkey vault unlock after authentication; UX and tests.

### Phase 4 — UX Hardening / Private Usability

Vault education; recovery UX; inactivity lock; mobile editor; archive; document no export/import; private usability testing.

### Phase 5 — Future Enhancements

Attachments, version history, import/export, full-text body search, templates, community sharing, moderation, “I prayed for you.”

> **Note:** Implementation sequencing for engineering work is detailed in `docs/LTG_VAULT_IMPLEMENTATION_PLAN.md` when published. This TDR phase list is the product delivery framing from the original workshop.

---

## 20. MVP Acceptance Criteria

The MVP is acceptable when:

1. Authentication comes from `@tgoliveira/secure-auth`
2. No competing local auth/account implementation
3. Product branded as **SelahKeep**
4. User can create a vault
5. User can set vault password/passphrase
6. Vault password KDF uses **Argon2id only**
7. User can choose **12-word or 24-word** recovery phrase
8. User can confirm and store recovery phrase envelope
9. User can unlock with vault password
10. User can unlock with recovery phrase
11. User can associate passkey with vault unlock
12. User can unlock with compatible passkey vault envelope
13. User can create/edit/delete/archive Markdown notes
14. User can assign one category and multiple tags per note
15. User can mark notes as answered
16. User can search by title/tag/category after unlock
17. Titles visible in UI after unlock; **not** plaintext at rest
18. Tags/categories/body not plaintext at rest
19. APIs do not receive plaintext note content
20. Vault password, recovery phrase, User Vault Key, Note Keys, PRF output do not leave browser
21. Account password reset does not unlock vault
22. Account deletion deletes vault and encrypted notes
23. Export/import documented as unavailable before public beta
24. Encrypted attachments not in MVP
25. Build, lint, tests, and coverage pass
26. Public pages explain SelahKeep direction clearly

---

## 21. Resolved Decisions

| # | Decision |
|---|----------|
| 1 | Product name: **SelahKeep** |
| 2 | KDF: **Argon2id only** — no PBKDF2 fallback |
| 3 | Recovery phrase: user chooses **12 or 24 words** |
| 4 | Categories/tags: **encrypted per-note metadata + encrypted vault index** |
| 5 | Note encryption: **per-note keys** wrapped by User Vault Key |
| 6 | Note version history: **deferred** |
| 7 | Account deletion: **deletes vault and all encrypted notes** |
| 8 | Export/import: **deferred**; document unavailable before public beta |
| 9 | Passkey vault unlock: **part of MVP** |
| 10 | Encrypted attachments: **deferred** |
| 11 | Authentication: **`@tgoliveira/secure-auth@0.1.25`** |
| 12 | Vault decryption: **product-owned** (`letter-to-god`) |

---

## 22. Remaining Open Decisions

For future ADRs or implementation plans:

1. Exact Argon2id library and browser strategy
2. Argon2id memory/time/parallelism parameters
3. Recovery phrase wordlist source
4. Recovery phrase confirmation UX details
5. Exact encrypted payload format (evolve ADR-001)
6. Exact schema/migration plan from current app to SelahKeep
7. Note archive vs hard delete in MVP
8. Body preview in encrypted index vs omitted
9. Whether passkey vault unlock requires package changes in `@tgoliveira/secure-auth`
10. Account deletion synchronous vs background job
11. Public beta export/import warning copy

---

## 23. Recommended Initial Implementation Order

1. Stabilize auth with `@tgoliveira/secure-auth`
2. Remove old local auth/account code (where still present)
3. Adopt this TDR (`docs/TDR_LTG_Vault_MVP.md`)
4. Cryptography ADR (Argon2id, User Vault Key, Note Keys, payload format)
5. Database/schema migration plan
6. Vault setup with Argon2id vault password
7. Recovery phrase (12/24 word choice)
8. Password and recovery envelopes
9. Passkey vault envelope design and integration
10. Encrypted note metadata and body
11. Markdown editor
12. Categories/tags in encrypted metadata/index
13. Note list after unlock
14. Search after unlock
15. Answered status
16. Vault unlock behavior setting
17. Security tests (no plaintext note data)
18. UI/UX polish

---

## 24. Final Decision

The project should evolve from:

**Private spiritual journaling (pre-vault)** — single-purpose private writing

to:

**SelahKeep** — a private encrypted space for prayers, reflections, and notes

This preserves emotional/spiritual identity while making the product more useful, extensible, and viable long term.

### Principles

| Principle | Statement |
|-----------|-----------|
| **Architecture** | Authentication gives access to the **account**. Vault unlock gives access to **private content**. These must remain separate. |
| **Privacy** | Titles, tags, categories, and bodies visible after vault unlock — **never** stored plaintext in the database. |
| **Product** | Do not become a generic notes app. Remain a calm, private, meaningful space for prayers, reflections, and personal notes. |

---

## Related Documents

| Document | Role |
|----------|------|
| `docs/ADR-005_*` | Active vault crypto, note keys, recovery phrase |
| `docs/ADR-006_*` | Superseded legacy PRF vault unlock record |
| `docs/AUTH_RESET_TO_SECURE_AUTH.md` | Auth boundary with secure-auth |
| `docs/LTG_VAULT_IMPLEMENTATION_PLAN.md` | Engineering phased plan (Phases 0–5 complete) |
| `docs/README.md` | Documentation index |
