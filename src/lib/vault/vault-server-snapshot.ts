import type { VaultServerStatusSnapshot } from "@tgoliveira/vault-core/react";
import type { VaultStatus } from "@/lib/api-client/vault";
import { deriveSetupPhase } from "@/lib/vault/vault-status";

export function toVaultServerStatusSnapshot(status: VaultStatus): VaultServerStatusSnapshot {
  const setupPhase = status.setupPhase ?? deriveSetupPhase(status);
  const configured = setupPhase !== "not_configured";
  const hasPasskeyPrfEnvelope =
    status.hasPortablePasskey === true ||
    status.availableUnlockMethods?.passkey === true ||
    status.methods?.some((method) => method === "passkey_authorized_device") === true;

  return {
    configured,
    hasPasskeyPrfEnvelope,
    passkeyUnlockAvailableOnThisDevice:
      status.hasPortablePasskey || status.passkeyUnlockAvailableOnThisDevice,
  };
}
