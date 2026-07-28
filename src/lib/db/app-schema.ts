import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  index,
  uniqueIndex,
  foreignKey,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "@tgoliveira/secure-auth/drizzle/schema";

/** Product extension: vault unlock columns are not in package passkeyCredentials. */
export const passkeyCredentials = pgTable("passkey_credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull().unique(),
  publicKey: text("public_key").notNull(),
  counter: text("counter").notNull().default("0"),
  counterRevision: integer("counter_revision").notNull().default(0),
  transports: jsonb("transports"),
  friendlyName: text("friendly_name"),
  signInEnabled: boolean("sign_in_enabled").notNull().default(true),
  vaultUnlockEnabled: boolean("vault_unlock_enabled").notNull().default(false),
  prfSupported: boolean("prf_supported"),
  credentialDeviceType: text("credential_device_type"),
  backupEligible: boolean("backup_eligible"),
  credentialBackedUp: boolean("credential_backed_up"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

export const userVaults = pgTable("user_vaults", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  vaultVersion: text("vault_version").notNull(),
  encryptedVaultSettings: jsonb("encrypted_vault_settings"),
  encryptedVaultIndex: jsonb("encrypted_vault_index"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const vaultEnvelopes = pgTable(
  "vault_envelopes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Explicit relation for passkey envelope variants; legacy rows are backfilled additively. */
    passkeyCredentialId: uuid("passkey_credential_id").references(() => passkeyCredentials.id, {
      onDelete: "set null",
    }),
    method: text("method").notNull(),
    encryptedVaultKey: jsonb("encrypted_vault_key").notNull(),
    kdfMetadata: jsonb("kdf_metadata"),
    publicMetadata: jsonb("public_metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_vault_envelopes_user_id_method").on(table.userId, table.method),
    index("idx_vault_envelopes_passkey_credential").on(table.passkeyCredentialId),
    uniqueIndex("uq_vault_envelopes_id_passkey_credential").on(
      table.id,
      table.passkeyCredentialId
    ),
  ]
);

/**
 * HttpOnly cookie `selahkeep_vault_device` stores `id`. A logical credential can have
 * several browser bindings; `selectedEnvelopeVariantId` is only routing state persisted
 * after a local candidate unwrap succeeds.
 */
export const vaultPasskeyDeviceBindings = pgTable(
  "vault_passkey_device_bindings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    passkeyCredentialId: uuid("passkey_credential_id")
      .notNull()
      .references(() => passkeyCredentials.id, { onDelete: "cascade" }),
    selectedEnvelopeVariantId: uuid("selected_envelope_variant_id"),
    deviceLabel: text("device_label"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    index("idx_vault_passkey_device_bindings_credential").on(table.passkeyCredentialId),
    index("idx_vault_passkey_device_bindings_user_id").on(table.userId),
    index("idx_vault_passkey_device_bindings_selected_variant").on(
      table.selectedEnvelopeVariantId
    ),
    foreignKey({
      name: "vault_passkey_binding_selected_variant_credential_fk",
      columns: [table.selectedEnvelopeVariantId, table.passkeyCredentialId],
      foreignColumns: [vaultEnvelopes.id, vaultEnvelopes.passkeyCredentialId],
    }),
  ]
);

export const notes = pgTable(
  "notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => userVaults.id, { onDelete: "cascade" }),
    encryptedMetadata: jsonb("encrypted_metadata").notNull(),
    encryptedWrappedNoteKey: jsonb("encrypted_wrapped_note_key").notNull(),
    encryptedBody: jsonb("encrypted_body").notNull(),
    bodyEncryptionVersion: text("body_encryption_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [index("idx_notes_vault_id_created_at").on(table.vaultId, table.createdAt)]
);

/**
 * Immutable, append-only encrypted snapshots of a note's editable content.
 * Stores only encrypted payloads (no plaintext) — see
 * `docs/TDR_Note_Version_History.md`. Content payloads are AAD-bound to the
 * version `id`; the wrapped note key is bound to the parent `note_id`.
 */
export const noteVersions = pgTable(
  "note_versions",
  {
    id: uuid("id").primaryKey(),
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => userVaults.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    encryptedMetadata: jsonb("encrypted_metadata").notNull(),
    encryptedWrappedNoteKey: jsonb("encrypted_wrapped_note_key").notNull(),
    encryptedBody: jsonb("encrypted_body").notNull(),
    bodyEncryptionVersion: text("body_encryption_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_note_versions_note_id_version").on(table.noteId, table.versionNumber),
    index("idx_note_versions_note_id_created_at").on(table.noteId, table.createdAt),
  ]
);

/**
 * Current encrypted kanban board state. A board may be note-bound or standalone;
 * all columns/cards/labels remain inside `encryptedBoard`.
 */
export const noteKanbanBoards = pgTable(
  "note_kanban_boards",
  {
    id: uuid("id").primaryKey(),
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "cascade" }),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => userVaults.id, { onDelete: "cascade" }),
    encryptedBoard: jsonb("encrypted_board").notNull(),
    encryptedWrappedKey: jsonb("encrypted_wrapped_key").notNull(),
    boardEncryptionVersion: text("board_encryption_version").notNull(),
    versionNumber: integer("version_number").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_note_kanban_boards_vault_id").on(table.vaultId),
    uniqueIndex("idx_note_kanban_boards_note_id")
      .on(table.noteId)
      .where(sql`${table.noteId} IS NOT NULL`),
  ]
);

/**
 * Encrypted file attachments — blob + metadata ciphertext only (see docs/ENCRYPTED_ATTACHMENTS.md).
 * Owned by exactly one of a note or a standalone kanban board; which card (if
 * any) within a board owns an attachment is tracked client-side only, inside
 * the board's own encrypted payload.
 */
export const noteAttachments = pgTable(
  "note_attachments",
  {
    id: uuid("id").primaryKey(),
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "cascade" }),
    boardId: uuid("board_id").references(() => noteKanbanBoards.id, { onDelete: "cascade" }),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => userVaults.id, { onDelete: "cascade" }),
    encryptedMetadata: jsonb("encrypted_metadata").notNull(),
    encryptedBlob: jsonb("encrypted_blob").notNull(),
    blobEncryptionVersion: text("blob_encryption_version").notNull(),
    /** Combined ciphertext byte size for storage usage (not plaintext). */
    ciphertextBytes: integer("ciphertext_bytes").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_note_attachments_note_id").on(table.noteId),
    index("idx_note_attachments_board_id").on(table.boardId),
    index("idx_note_attachments_vault_id").on(table.vaultId),
    check(
      "chk_note_attachments_owner",
      sql`num_nonnulls(${table.noteId}, ${table.boardId}) = 1`
    ),
  ]
);

/**
 * Immutable encrypted kanban snapshots. Version content is AAD-bound to the
 * snapshot id; the wrapped key follows the current board scope.
 */
export const noteKanbanVersions = pgTable(
  "note_kanban_versions",
  {
    id: uuid("id").primaryKey(),
    boardId: uuid("board_id")
      .notNull()
      .references(() => noteKanbanBoards.id, { onDelete: "cascade" }),
    noteId: uuid("note_id").references(() => notes.id, { onDelete: "cascade" }),
    vaultId: uuid("vault_id")
      .notNull()
      .references(() => userVaults.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    encryptedBoard: jsonb("encrypted_board").notNull(),
    encryptedWrappedKey: jsonb("encrypted_wrapped_key").notNull(),
    boardEncryptionVersion: text("board_encryption_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_note_kanban_versions_board_id_version").on(table.boardId, table.versionNumber),
    index("idx_note_kanban_versions_board_id_created").on(table.boardId, table.createdAt),
  ]
);

/** Runtime overrides for vault-core admin config (`/admin/vault/config`). */
export const vaultAdminConfigOverrides = pgTable("vault_admin_config_overrides", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const integrations = pgTable(
  "integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull().default("mcp"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("idx_integrations_user_id").on(table.userId)]
);

export const integrationTokens = pgTable(
  "integration_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    tokenPrefix: text("token_prefix").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [index("idx_integration_tokens_integration_id").on(table.integrationId)]
);

export const integrationGrants = pgTable(
  "integration_grants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    resourceType: text("resource_type").notNull(),
    resourceId: uuid("resource_id").notNull(),
    encryptedWrappedKey: jsonb("encrypted_wrapped_key").notNull(),
    permissions: text("permissions").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("idx_integration_grants_active_unique")
      .on(table.integrationId, table.resourceType, table.resourceId)
      .where(sql`${table.revokedAt} IS NULL`),
  ]
);

export type Note = typeof notes.$inferSelect;
export type NoteVersion = typeof noteVersions.$inferSelect;
export type NoteAttachment = typeof noteAttachments.$inferSelect;
export type NoteKanbanBoard = typeof noteKanbanBoards.$inferSelect;
export type NoteKanbanVersion = typeof noteKanbanVersions.$inferSelect;
export type VaultEnvelope = typeof vaultEnvelopes.$inferSelect;
export type VaultPasskeyDeviceBinding = typeof vaultPasskeyDeviceBindings.$inferSelect;
