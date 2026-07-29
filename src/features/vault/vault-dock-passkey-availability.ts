import type { VaultStatus } from "@/lib/api-client/vault";
import {
  resolveVaultDockPasskeyAvailability as resolveVaultDockPasskeyAvailabilityCore,
  type VaultDockPasskeyAvailability,
  type VaultServerStatusSnapshot,
} from "@tgoliveira/vault-core/react";

export type { VaultDockPasskeyAvailability };

export function toVaultServerStatusSnapshot(
  vaultStatus: VaultStatus | null
): VaultServerStatusSnapshot | null {
  if (!vaultStatus) return null;
  return {
    configured: vaultStatus.setupComplete ?? vaultStatus.hasVault ?? false,
    hasPasskeyPrfEnvelope:
      vaultStatus.availableUnlockMethods?.passkey ?? vaultStatus.hasPasskey ?? false,
    passkeyUnlockAvailableOnThisDevice:
      vaultStatus.hasPortablePasskey || vaultStatus.passkeyUnlockAvailableOnThisDevice,
  };
}

/** Whether passkey PRF quick unlock may appear in the Vault Status Dock. */
export function resolveVaultDockPasskeyAvailability(
  vaultStatus: VaultStatus | null
): VaultDockPasskeyAvailability {
  return resolveVaultDockPasskeyAvailabilityCore(toVaultServerStatusSnapshot(vaultStatus));
}

export function useVaultDockPasskeyAvailable(
  vaultStatus: VaultStatus | null
): VaultDockPasskeyAvailability {
  return resolveVaultDockPasskeyAvailability(vaultStatus);
}
