import type { DbClient } from "@/lib/db";
import { passkeyRepository } from "@/server/repositories/passkey-repository";
import { vaultPasskeyDeviceBindingRepository } from "@/server/repositories/vault-passkey-device-binding-repository";
import { vaultRepository } from "@/server/repositories/vault-repository";

/** True when the HttpOnly cookie binding matches an active vault passkey credential + envelope. */
export async function resolvePasskeyUnlockAvailableOnThisDevice(
  userId: string,
  deviceBindingId?: string
): Promise<boolean> {
  if (!deviceBindingId) return false;

  const binding = await vaultPasskeyDeviceBindingRepository.findByIdForUser(
    deviceBindingId,
    userId
  );
  if (!binding) return false;

  const credential = await passkeyRepository.findByIdForUser(binding.passkeyCredentialId, userId);
  if (!credential?.vaultUnlockEnabled) return false;

  const variants = await vaultRepository.findActivePasskeyEnvelopeVariants(
    userId,
    credential.id,
    credential.credentialId,
    binding.selectedEnvelopeVariantId
  );

  return variants.length > 0;
}

export async function bindVaultPasskeyToThisDevice(
  userId: string,
  passkeyCredentialDbId: string,
  options: {
    deviceLabel?: string | null;
    existingBindingId?: string;
    selectedEnvelopeVariantId?: string | null;
  },
  client?: DbClient
): Promise<{ bindingId: string }> {
  return vaultPasskeyDeviceBindingRepository.bindPasskeyToDevice(
    userId,
    passkeyCredentialDbId,
    options,
    client
  );
}

export async function touchVaultPasskeyDeviceBindingLastUsed(
  userId: string,
  deviceBindingId: string
): Promise<void> {
  await vaultPasskeyDeviceBindingRepository.touchLastUsedAt(deviceBindingId, userId);
}

/** Removes only this browser's routing binding; credential and envelope variants remain active. */
export async function unbindVaultPasskeyFromThisDevice(
  userId: string,
  deviceBindingId: string
): Promise<boolean> {
  return vaultPasskeyDeviceBindingRepository.deleteByIdForUser(deviceBindingId, userId);
}
