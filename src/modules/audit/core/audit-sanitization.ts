export const AUDIT_EVENT_TYPES = [
  "login_success",
  "login_failure",
  "vault_initialized",
  "recovery_code_generated",
  "recovery_code_regenerated",
  "recovery_phrase_replaced",
  "recovery_phrase_test_succeeded",
  "recovery_phrase_test_failed",
  "vault_unlocked",
  "vault_locked_manual",
  "vault_auto_locked",
  "passkey_vault_unlock_enabled",
  "passkey_vault_unlock_disabled",
  "portable_vault_enrollment_pending",
  "portable_vault_enabled",
  "portable_vault_revoked",
  "trusted_device_added",
  "trusted_device_revoked",
  "trusted_device_removed",
  "trusted_device_renamed",
  "failed_unlock_attempt",
  "passkey_added",
  "passkey_removed",
  "account_deletion_requested",
  "letter_deleted",
  "two_factor_setup_started",
  "two_factor_enabled",
  "two_factor_setup_failed",
  "two_factor_disabled",
  "two_factor_disable_failed",
  "two_factor_backup_codes_generated",
  "two_factor_backup_code_used",
  "two_factor_login_passed",
  "two_factor_login_failed",
  "passkey_login_success",
  "passkey_login_failed",
  "passkey_login_completed",
  "passkey_login_vault_unlock_succeeded",
  "passkey_login_vault_unlock_unavailable",
  "passkey_login_vault_unlock_failed",
  "email_verification_requested",
  "email_verified",
  "email_verification_failed",
  "password_reset_requested",
  "password_reset_completed",
  "password_reset_failed",
  "password_changed",
  "password_change_failed",
  "session_created",
  "session_last_used_updated",
  "session_revoked",
  "session_revoke_failed",
  "all_other_sessions_revoked",
  "all_sessions_revoked",
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

const ALLOWED_METADATA_KEYS = new Set([
  "deviceId",
  "method",
  "endpoint",
  "statusCode",
  "errorCode",
  "provider",
]);

const SENSITIVE_METADATA_PATTERNS = [
  /title/i,
  /body/i,
  /content/i,
  /recovery/i,
  /vaultkey/i,
  /letterkey/i,
  /ciphertext/i,
  /plaintext/i,
  /sentinel/i,
  /password/i,
  /totp/i,
  /otp/i,
  /backup/i,
  /two.?factor/i,
];

export function sanitizeAuditMetadata(
  metadata?: Record<string, unknown>
): Record<string, unknown> | null {
  if (!metadata) return null;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;
    if (typeof value === "string" && containsSensitiveText(value)) continue;
    result[key] = value;
  }

  return Object.keys(result).length > 0 ? result : null;
}

export function containsSensitiveText(value: string): boolean {
  if (value.includes("SENTINEL-PRIVATE-LETTER")) return true;
  return SENSITIVE_METADATA_PATTERNS.some((pattern) => pattern.test(value));
}
