# ADR-005 — SelahKeep Cryptography (Argon2id, Recovery Phrase, Note Keys)

| Field | Value |
|-------|--------|
| **Status** | Accepted |
| **Date** | 2026-06-16 |
| **Supersedes** | Partial updates to ADR-001/002 for vault password + recovery phrase paths |
| **Related** | `docs/TDR_LTG_Vault_MVP.md`, Phase 1 implementation plan |

---

## 1. Context

SelahKeep separates **account authentication** (`@tgoliveira/secure-auth`) from **vault unlock**. The vault is protected by a dedicated vault password/passphrase and a recovery phrase. The User Vault Key (UVK) encrypts note content (Phase 2+). Phase 1 establishes UVK lifecycle, password and recovery phrase envelopes, encrypted vault settings/index placeholders, and a no-plaintext API contract.

Legacy users may still have `vault-v1` trusted-device + 17-word recovery **code** envelopes. New setup uses `vault-v2` with Argon2id-only KDFs and 12/24-word BIP39 recovery **phrases**.

---

## 2. Argon2id (vault password + recovery phrase KDF)

### Library

**`hash-wasm`** (`argon2id` export) — already a project dependency, runs Argon2id in the browser via WebAssembly, audited usage pattern from existing recovery-code path.

**Why not PBKDF2 for new vault paths:** PBKDF2 is weaker against GPU attacks at comparable iteration counts. SelahKeep vault password KDF is **Argon2id only** with **no silent fallback**.

Legacy `recovery_code` envelopes may still use PBKDF2 metadata from pre-Phase-1 clients; new `password` and `recovery_phrase` envelopes must use Argon2id.

### Parameters (default `kdf-v1`)

| Parameter | Value | Notes |
|-----------|-------|-------|
| Algorithm | Argon2id | RFC 9106 |
| Memory (`memorySize`) | 65536 KiB (64 MiB) | Tuned for modern desktop/mobile browsers |
| Iterations | 3 | Time cost |
| Parallelism | 1 | Web Crypto / single-tab UX |
| Salt length | 16 bytes | CSPRNG per envelope |
| Output length | 32 bytes | Imported as AES-256-GCM key |
| Password normalization | NFKC UTF-8 bytes | Vault password and recovery phrase |

### Storage

KDF parameters are stored in `vault_envelopes.kdf_metadata` (JSON):

```json
{
  "kdf": "argon2id",
  "version": "kdf-v1",
  "salt": "<base64url>",
  "memory": 65536,
  "iterations": 3,
  "parallelism": 1
}
```

### Upgrades

Future `kdf-v2` may increase memory/iterations. Clients read `version` + parameters from envelope metadata and re-derive locally. UVK rotation (re-wrap) is a separate operational flow (future ADR).

### Browser / mobile performance

64 MiB Argon2id may be slow on low-memory mobile browsers. Setup and unlock show a calm progress state. If Argon2id becomes unavailable, the client **fails closed** — no PBKDF2 downgrade for vault password or recovery phrase.

Implementation: `@tgoliveira/vault-core` (Argon2id KDF); SelahKeep wrappers in `src/modules/vault/core/envelopes/`. Legacy shim paths: `src/lib/crypto-client/vault-kdf.ts`, `src/lib/crypto-client/argon2id.ts`.

---

## 3. User Vault Key (UVK)

| Property | Decision |
|----------|----------|
| Generation | `crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])` |
| Entropy | 256-bit AES key material from CSPRNG |
| Lifetime in memory | Session only via `vault-session.ts`; cleared on lock, logout (`clearVaultClientState`), tab close guard |
| Wrapping | AES-GCM envelopes with keys derived from vault password or recovery phrase |
| Server | Never transmitted; only encrypted envelopes stored |
| Note Keys (Phase 2+) | Per-note AES keys wrapped by UVK — see §9 |

---

## 4. Unlock envelopes

| Type | Phase | Method string | Purpose |
|------|-------|---------------|---------|
| `password` | **1 — implement** | `password` | Vault password/passphrase unwraps UVK |
| `recovery_phrase` | **1 — implement** | `recovery_phrase` | Recovery phrase unwraps UVK |
| `passkey_prf` | **4 — implemented** | `passkey_authorized_device` | PRF-derived key unwraps UVK; see ADR-006 |
| `trusted_device` | legacy | `trusted_device` | Device secret unwraps UVK |
| `recovery_code` | legacy | `recovery_code` | 17-word legacy code |
| `passkey_authorized_device` | legacy/4 | `passkey_authorized_device` | Passkey PRF envelope |

Phase 1 creates exactly one `password` and one `recovery_phrase` envelope at setup.

### Passkey envelope removal

Passkey PRF crypto and candidate handling remain owned by `@tgoliveira/vault-core`; SelahKeep owns credential rows, envelope persistence, browser bindings, and transactions. A bulk vault-passkey reset revokes all active `passkey_authorized_device` envelopes and vault-only credentials, removes browser bindings, and clears only vault capability from credentials that are also used for account sign-in. It does not rotate the UVK, password envelope, or recovery phrase envelope, and it never deletes account-passkey capability from the vault product boundary.

---

## 5. Recovery phrase

### Wordlist

**BIP39 English wordlist** (2048 words) via `@scure/bip39/wordlists/english` — industry-standard mnemonic source, documented in Bitcoin BIP-0039.

Not the legacy 17-word custom hyphenated recovery **code** wordlist.

### Length choice

User selects **12 words** (128-bit entropy) or **24 words** (256-bit entropy) at setup.

### Generation

Client-side CSPRNG → BIP39 mnemonic (`generateMnemonic`).

### Confirmation UX

User must re-enter all words (or select from shuffled grid) before envelopes are created. Phrase is shown once with explicit copy/save guidance.

### Recovery semantics

The recovery phrase **restores access to the vault** (unwraps UVK). It does **not** recover the original vault password string. Copy must say “recover access to your vault,” not “recover your password.”

### Transport

Recovery phrase never sent to server, never logged, never stored in DB.

Implementation: `src/modules/vault/core/envelopes/recovery-envelope.ts` (re-exported from `src/lib/crypto-client/recovery-phrase.ts`).

---

## 6. Encrypted payload format (`enc-v1`)

Unchanged core from ADR-001:

```json
{
  "version": "enc-v1",
  "alg": "AES-GCM",
  "iv": "<base64url 12 bytes>",
  "ciphertext": "<base64url>",
  "aad": {
    "userId": "<uuid>",
    "resourceId": "<uuid>",
    "field": "vault_key | vault_settings | vault_index | title | body | letter_key | note_metadata | note_body | note_key | note_version_metadata | note_version_body | note_draft"
  }
}
```

- **Encryption:** AES-256-GCM
- **IV/nonce:** 12 bytes random per encryption
- **AAD:** Canonical JSON string binding `userId`, `resourceId`, `field`
- **Versioning:** `enc-v1` on payload; `vault-v2` on vault row

### Vault settings blob (client-encrypted)

Opaque JSON encrypted under UVK at setup, e.g. `{ setupVersion: 1, recoveryPhraseLength: 12 | 24 }`. Server stores ciphertext only in `user_vaults.encrypted_vault_settings`.

### Vault index placeholder (client-encrypted)

Encrypted structure for note list metadata. Stored in `user_vaults.encrypted_vault_index`. See §8.

---

## 7. Note Keys (Phase 2)

Each note has a unique **Note Key** (AES-256-GCM, 256-bit CSPRNG).

| Property | Decision |
|----------|----------|
| Generation | `generateNoteKey()` — same as letter key pattern |
| Wrapping | Note Key exported as base64url, encrypted under UVK with AAD `field: note_key` |
| Server storage | `notes.encrypted_wrapped_note_key` (JSON `enc-v1` payload only) |
| Transport | Note Key **never** sent to API in plaintext |

Implementation: `src/lib/crypto-client/note-key.ts`.

### Encrypted note metadata (`note_metadata`)

JSON encrypted under Note Key:

```json
{
  "title": "...",
  "categoryId": null,
  "tagIds": [],
  "answered": false,
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

Stored in `notes.encrypted_metadata`. Title is **never** a plaintext DB column.

### Encrypted note body (`note_body`)

Markdown plaintext encrypted under Note Key. Stored in `notes.encrypted_body`. Version in `notes.body_encryption_version` (`enc-v1`).

Implementation: `src/lib/crypto-client/notes.ts`.

---

### Encrypted note versions (note history)

Each saved content state is also captured as an immutable **version** snapshot in the `note_versions` table. A version **reuses the note's existing Note Key** (no new key material) and is encrypted client-side:

- `note_version_metadata` and `note_version_body` payloads are AAD-bound to a unique, client-generated **`versionId`** (`resourceId: versionId`).
- The version stores a copy of the note's wrapped Note Key (`field: note_key`, `resourceId: noteId`).

Binding content to `versionId` prevents the server from swapping ciphertext between versions; the wrapped key stays bound to `noteId`. Versions are readable only with the UVK, cascade-delete with the note, and are retention-pruned server-side on row counts only (`NOTE_VERSION_HISTORY_LIMIT`). Server AAD validation: `assertNoteVersionAad()`. Full design: `docs/TDR_Note_Version_History.md`.

Implementation: `src/lib/crypto-client/note-versions.ts`, `notes.encrypted_*` snapshot rows in `note_versions`, `GET/POST /api/notes/:id/versions`.

## 8. Vault index (Phase 2)

Client-encrypted JSON under UVK (`field: vault_index`, `resourceId: userId`):

```json
{
  "version": 1,
  "entries": [
    {
      "id": "<note-uuid>",
      "title": "...",
      "categoryId": null,
      "tagIds": [],
      "answered": false,
      "createdAt": "ISO-8601",
      "updatedAt": "ISO-8601",
      "archived": false
    }
  ]
}
```

- Updated client-side on note create/update/delete (archive on soft delete).
- List UI decrypts index when vault unlocked — no server-side decryption.
- `rebuildVaultIndexFromNotes()` can reconstruct from decrypted note metadata if index corrupt.

Implementation: `src/lib/crypto-client/vault-index.ts`, `GET/PATCH /api/vault/index`.

---

## 9. No-plaintext API contract

### APIs may receive

- `encryptedVaultSettings`, `encryptedVaultIndex`
- `encryptedMetadata`, `encryptedBody`, `encryptedWrappedNoteKey`
- `encryptedVaultKey` (envelope ciphertext)
- `kdfMetadata` / `kdf_params`
- `publicMetadata`, envelope `method`
- `vaultVersion`, technical IDs, timestamps

### APIs must not receive

- `vaultPassword`, `password` (vault context), `recoveryPhrase`, `recoveryWords`
- `userVaultKey`, `noteKey`
- Plaintext `title`, `body`, `content`, `tags`, `category`
- Passkey PRF output

Validation: `rejectVaultPlaintextFields()` in `src/lib/validation/vault.ts`; `rejectPlaintextNoteFields()` in `src/lib/validation/notes.ts`.

---

## 10. Consequences

- New vaults use `vault-v2` + `password` + `recovery_phrase` envelopes.
- Legacy `vault-v1` flows remain until migrated.
- Phase 4 implements passkey PRF vault unlock per ADR-006 (`passkey_authorized_device` envelope with `prfRequired: true`).
- Phase 2 adds Note Keys wrapped by UVK (`notes` table, `/api/notes`, vault index).
- Phase 3 extends vault index v2 with encrypted categories, tags, answered flags; client-only search; `unlockBehavior` in encrypted vault settings. Letters domain removed.

### Deterministic owner and lease lifecycle (2026-07-27)

Every UVK-producing path is scoped to a `@tgoliveira/vault-core` owner operation; every subsequent key-bearing private operation uses the installed vault lease. Awaited work must reassert the operation or lease before installing key state, writing ciphertext, or committing decrypted UI/cache state. Lock changes the epoch; logout and account replacement clear the owner. Late results are discarded under the additional app request-generation contract in [`TDR_DETERMINISTIC_APPLICATION_STATE.md`](./TDR_DETERMINISTIC_APPLICATION_STATE.md).

```text
TODO_SECURITY_REVIEW_REQUIRED:
Production migration from vault-v1 + recovery_code to vault-v2 + recovery_phrase requires a human-reviewed data migration plan before bulk user conversion.
```
