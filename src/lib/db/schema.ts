export {
  users,
  accountSessions,
  accountTokens,
  auditEvents,
  rateLimitBuckets,
  userTwoFactorBackupCodes,
  userTwoFactorLoginChallenges,
  userTwoFactorLoginTokens,
  userTwoFactorSessionUpgrades,
  userTwoFactorSettings,
  webauthnChallenges,
  adminConfigOverrides,
  apiKeys,
  inviteCodes,
  inviteUses,
  loginAttemptCounters,
  userPreferences,
} from "@tgoliveira/secure-auth/drizzle/schema";

export {
  passkeyCredentials,
  vaultPasskeyDeviceBindings,
  userVaults,
  vaultEnvelopes,
  notes,
  noteVersions,
  noteAttachments,
  noteKanbanBoards,
  noteKanbanVersions,
  vaultAdminConfigOverrides,
  integrations,
  integrationTokens,
  integrationGrants,
  type Note,
  type NoteVersion,
  type NoteAttachment,
  type NoteKanbanBoard,
  type NoteKanbanVersion,
  type VaultEnvelope,
  type VaultPasskeyDeviceBinding,
} from "./app-schema";

import { users } from "@tgoliveira/secure-auth/drizzle/schema";

export type User = typeof users.$inferSelect;
