import {
  createRecoveryEnvelope,
  unlockWithRecoveryEnvelope,
  type Argon2idKdfMetadata as VaultCoreArgon2idKdfMetadata,
  type EncryptedPayload as VaultCoreEncryptedPayload,
  type KdfMetadata as VaultCoreKdfMetadata,
} from "@tgoliveira/vault-core";
import {
  assertVaultSessionOperationCurrent,
  cacheVaultInnerKeyMaterialAfterRecoveryUnlock,
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

export async function wrapVaultKeyForRecoveryPhrase(
  vaultKey: CryptoKey,
  recoveryPhrase: string,
  options: WrapOptions,
  publicMetadata?: { phraseLength: 12 | 24 }
): Promise<{ encryptedVaultKey: EncryptedPayload; kdfMetadata: VaultCoreArgon2idKdfMetadata }> {
  const { envelope, kdfMetadata } = await createRecoveryEnvelope(
    vaultKey,
    recoveryPhrase,
    options,
    SELAHKEEP_VAULT_PROFILE,
    publicMetadata
  );
  return {
    encryptedVaultKey: envelope.encryptedVaultKey as EncryptedPayload,
    kdfMetadata,
  };
}

export async function unwrapVaultKeyFromRecoveryPhrase(
  recoveryPhrase: string,
  encryptedVaultKey: EncryptedPayload,
  kdfMetadata: KdfMetadata,
  options?: {
    applySession?: boolean;
    unlockMethod?: VaultUnlockMethod;
    userId?: string;
    resourceId?: string;
    expectedWordCount?: 12 | 24 | null;
    operation?: VaultSessionOperation;
  }
): Promise<CryptoKey> {
  const scope = envelopeScope(options?.userId ?? encryptedVaultKey.aad.userId, options?.resourceId);
  const envelope = {
    method: "recovery_phrase" as const,
    encryptedVaultKey: asVaultCorePayload(encryptedVaultKey),
    kdfMetadata: kdfMetadata as VaultCoreKdfMetadata,
  };
  const vaultKey = await unlockWithRecoveryEnvelope(
    recoveryPhrase,
    envelope,
    scope,
    SELAHKEEP_VAULT_PROFILE,
    { expectedWordCount: options?.expectedWordCount ?? null }
  );
  if (options?.operation) assertVaultSessionOperationCurrent(options.operation);

  if (kdfMetadata.kdf === "argon2id") {
    await cacheVaultInnerKeyMaterialAfterRecoveryUnlock(vaultKey, envelope, recoveryPhrase, {
      operation: options?.operation,
    });
    if (options?.operation) assertVaultSessionOperationCurrent(options.operation);
  }

  if (options?.applySession ?? true) {
    await setUnlockedVaultSession({
      userVaultKey: vaultKey,
      method: options?.unlockMethod ?? "recovery_phrase",
      operation: options?.operation,
    });
  }
  return vaultKey;
}

export {
  createRecoveryPhrase,
  generateRecoveryPhrase,
  normalizeRecoveryPhrase,
  validateRecoveryPhraseFormat,
  assertRecoveryPhraseConfirmation,
  assertRecoveryPhraseWordConfirmation,
  assertRecoveryPhraseUnlockInput,
  pickRecoveryConfirmationIndices,
  getRecoveryConfirmationPromptCount,
  getRecoveryPhraseWordCount,
  parseRecoveryPhraseWordCount,
  DEFAULT_RECOVERY_PHRASE_WORD_COUNT,
  RECOVERY_PHRASE_WORDLIST_SOURCE,
  deriveRecoveryPhraseKey,
  deriveRecoveryPhraseKeyFromMetadata,
  type RecoveryPhraseWordCount,
  createRecoveryEnvelope,
  unlockWithRecoveryEnvelope,
} from "@tgoliveira/vault-core";

/** @deprecated Use RecoveryPhraseWordCount */
export type RecoveryPhraseLength = import("@tgoliveira/vault-core").RecoveryPhraseWordCount;

export type { VaultCoreArgon2idKdfMetadata as Argon2idKdfMetadata };
