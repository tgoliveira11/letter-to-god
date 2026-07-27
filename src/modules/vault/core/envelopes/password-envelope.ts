import {
  createPasswordEnvelope,
  unlockWithPasswordEnvelope,
  type Argon2idKdfMetadata as VaultCoreArgon2idKdfMetadata,
  type EncryptedPayload as VaultCoreEncryptedPayload,
  type KdfMetadata as VaultCoreKdfMetadata,
} from "@tgoliveira/vault-core";
import {
  assertVaultSessionOperationCurrent,
  cacheVaultInnerKeyMaterialAfterPasswordUnlock,
  type VaultSessionOperation,
} from "@tgoliveira/vault-core/browser";
import type { EncryptedPayload, KdfMetadata } from "@/lib/validation/encrypted-payload";
import {
  setUnlockedVaultSession,
  type VaultUnlockMethod,
} from "@/lib/crypto-client/vault-session";
import { SELAHKEEP_VAULT_PROFILE } from "../../selahkeep-profile";

type WrapOptions = {
  userId: string;
  resourceId: string;
};

function asVaultCorePayload(payload: EncryptedPayload): VaultCoreEncryptedPayload {
  return payload as VaultCoreEncryptedPayload;
}

function envelopeScope(userId: string, resourceId?: string) {
  return { userId, resourceId: resourceId ?? userId };
}

export async function wrapVaultKeyForPassword(
  vaultKey: CryptoKey,
  vaultPassword: string,
  options: WrapOptions
): Promise<{ encryptedVaultKey: EncryptedPayload; kdfMetadata: VaultCoreArgon2idKdfMetadata }> {
  const { envelope, kdfMetadata } = await createPasswordEnvelope(
    vaultKey,
    vaultPassword,
    options,
    SELAHKEEP_VAULT_PROFILE
  );
  return {
    encryptedVaultKey: envelope.encryptedVaultKey as EncryptedPayload,
    kdfMetadata,
  };
}

export async function unwrapVaultKeyFromPassword(
  vaultPassword: string,
  encryptedVaultKey: EncryptedPayload,
  kdfMetadata: KdfMetadata,
  options?: {
    applySession?: boolean;
    unlockMethod?: VaultUnlockMethod;
    userId?: string;
    resourceId?: string;
    operation?: VaultSessionOperation;
  }
): Promise<CryptoKey> {
  const scope = envelopeScope(options?.userId ?? encryptedVaultKey.aad.userId, options?.resourceId);
  const envelope = {
    encryptedVaultKey: asVaultCorePayload(encryptedVaultKey),
    kdfMetadata: kdfMetadata as VaultCoreKdfMetadata,
  };
  const vaultKey = await unlockWithPasswordEnvelope(
    vaultPassword,
    envelope,
    scope,
    SELAHKEEP_VAULT_PROFILE
  );
  if (options?.operation) assertVaultSessionOperationCurrent(options.operation);

  if (kdfMetadata.kdf === "argon2id") {
    await cacheVaultInnerKeyMaterialAfterPasswordUnlock(vaultKey, envelope, vaultPassword, {
      operation: options?.operation,
    });
    if (options?.operation) assertVaultSessionOperationCurrent(options.operation);
  }

  if (options?.applySession ?? true) {
    await setUnlockedVaultSession({
      userVaultKey: vaultKey,
      method: options?.unlockMethod ?? "password",
      operation: options?.operation,
    });
  }
  return vaultKey;
}

export {
  createPasswordEnvelope,
  unlockWithPasswordEnvelope,
} from "@tgoliveira/vault-core";

export type { VaultCoreArgon2idKdfMetadata as Argon2idKdfMetadata };
