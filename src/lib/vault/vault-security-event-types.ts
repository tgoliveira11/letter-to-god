/** Vault security events safe to display in the Security Review UI. */
export const VAULT_SECURITY_AUDIT_EVENT_TYPES = [
  "vault_initialized",
  "vault_unlocked",
  "vault_locked_manual",
  "vault_auto_locked",
  "recovery_phrase_replaced",
  "recovery_phrase_test_succeeded",
  "recovery_phrase_test_failed",
  "failed_unlock_attempt",
  "passkey_vault_unlock_enabled",
  "passkey_vault_unlock_disabled",
  "portable_vault_enabled",
  "portable_vault_revoked",
] as const;

export type VaultSecurityAuditEventType = (typeof VAULT_SECURITY_AUDIT_EVENT_TYPES)[number];

/** Events the browser may record via POST /api/vault/security-events. */
export const CLIENT_RECORDABLE_VAULT_SECURITY_EVENTS = [
  "vault_unlocked",
  "vault_locked_manual",
  "vault_auto_locked",
  "recovery_phrase_test_succeeded",
  "recovery_phrase_test_failed",
] as const;

export type ClientRecordableVaultSecurityEvent =
  (typeof CLIENT_RECORDABLE_VAULT_SECURITY_EVENTS)[number];

const UNLOCK_METHOD_LABELS: Record<string, string> = {
  password: "vault password",
  recovery_phrase: "recovery phrase",
  passkey: "passkey PRF",
  passkey_prf: "passkey PRF",
  portable_passkey: "portable passkey",
};

export function formatVaultUnlockMethodLabel(method: unknown): string | null {
  if (typeof method !== "string") return null;
  return UNLOCK_METHOD_LABELS[method] ?? null;
}

export function getVaultSecurityEventLabel(
  eventType: string,
  metadata?: Record<string, unknown> | null
): string {
  const methodLabel = formatVaultUnlockMethodLabel(metadata?.method);

  switch (eventType) {
    case "vault_initialized":
      return "Vault initialized";
    case "vault_unlocked":
      return methodLabel ? `Vault unlocked with ${methodLabel}` : "Vault unlocked";
    case "vault_locked_manual":
      return "Vault locked manually";
    case "vault_auto_locked":
      return "Vault auto-locked due to inactivity";
    case "recovery_phrase_replaced":
      return "Recovery phrase replaced";
    case "recovery_phrase_test_succeeded":
      return "Recovery phrase test succeeded";
    case "recovery_phrase_test_failed":
      return "Recovery phrase test failed";
    case "failed_unlock_attempt":
      return methodLabel ? `Failed unlock attempt (${methodLabel})` : "Failed unlock attempt";
    case "passkey_vault_unlock_enabled":
      return "Passkey vault unlock enabled";
    case "passkey_vault_unlock_disabled":
      return "Passkey vault unlock disabled";
    case "portable_vault_enabled":
      return "Portable passkey vault unlock enabled";
    case "portable_vault_revoked":
      return "Portable passkey vault unlock revoked";
    default:
      return "Vault security event";
  }
}
