import type { ClientRecordableVaultSecurityEvent } from "@/lib/vault/vault-security-event-types";

export async function recordVaultSecurityEvent(
  eventType: ClientRecordableVaultSecurityEvent,
  metadata?: {
    method?: "password" | "recovery_phrase" | "passkey" | "passkey_prf" | "portable_passkey";
  }
): Promise<void> {
  try {
    await fetch("/api/vault/security-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType, metadata }),
    });
  } catch {
    // Non-critical telemetry; never block vault UX.
  }
}
