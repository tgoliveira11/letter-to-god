import { auditRepository } from "@/modules/audit/repositories/audit-repository";
import {
  CLIENT_RECORDABLE_VAULT_SECURITY_EVENTS,
  VAULT_SECURITY_AUDIT_EVENT_TYPES,
  type ClientRecordableVaultSecurityEvent,
} from "@/lib/vault/vault-security-event-types";
import { getVaultSecurityEventLabel } from "@/lib/vault/vault-security-event-types";

const CLIENT_EVENT_SET = new Set<string>(CLIENT_RECORDABLE_VAULT_SECURITY_EVENTS);

const ALLOWED_CLIENT_METHODS = new Set([
  "password",
  "recovery_phrase",
  "passkey",
  "passkey_prf",
  "portable_passkey",
]);

export type VaultSecurityEventView = {
  id: string;
  eventType: string;
  label: string;
  createdAt: string;
};

export const vaultSecurityService = {
  async listEvents(userId: string, limit = 25): Promise<VaultSecurityEventView[]> {
    const rows = await auditRepository.listForUser(userId, VAULT_SECURITY_AUDIT_EVENT_TYPES, limit);
    return rows.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      label: getVaultSecurityEventLabel(row.eventType, row.metadata),
      createdAt: row.createdAt.toISOString(),
    }));
  },

  async recordClientEvent(
    userId: string,
    eventType: ClientRecordableVaultSecurityEvent,
    metadata?: { method?: string }
  ): Promise<void> {
    if (!CLIENT_EVENT_SET.has(eventType)) {
      throw new Error("Invalid vault security event type");
    }

    const safeMetadata: Record<string, unknown> = {};
    if (metadata?.method) {
      if (!ALLOWED_CLIENT_METHODS.has(metadata.method)) {
        throw new Error("Invalid unlock method label");
      }
      safeMetadata.method = metadata.method;
    }

    await auditRepository.record(eventType, userId, safeMetadata);
  },
};
