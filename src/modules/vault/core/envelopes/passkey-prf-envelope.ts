import {
  unlockWithPasskeyPrfEnvelope,
  unlockVaultFromPasskeyEnvelope as unlockVaultFromPasskeyEnvelopeCore,
  unwrapVaultKeyFromPasskey as unwrapVaultKeyFromPasskeyCore,
  VaultKeyNotExtractableError,
  VaultAuthorizationError,
  type EncryptedPayload as VaultCoreEncryptedPayload,
  type VaultPasskeyEnvelopeVariant,
} from "@tgoliveira/vault-core";
import {
  createPasskeyPrfEnvelopeWithSessionCache,
  INNER_VAULT_KEY_CACHE_MISMATCH_MESSAGE,
  cacheVaultInnerKeyMaterialFromPasskeyUnlock,
  unlockWithPasskeyPrfEnvelopeCandidates,
  type UnlockPasskeyPrfEnvelopeCandidatesResult,
  assertVaultSessionOperationCurrent,
  type VaultSessionOperation,
} from "@tgoliveira/vault-core/browser";
import type { EncryptedPayload } from "@/lib/validation/encrypted-payload";
import { setUnlockedVaultSession } from "@/lib/crypto-client/vault-session";
import { PASSKEY_VAULT_UNLOCK_REWRAP_REQUIRES_UNLOCK_MESSAGE } from "@/lib/passkey/messages";
import { SELAHKEEP_VAULT_PROFILE } from "../../selahkeep-profile";

function asVaultCorePayload(payload: EncryptedPayload): VaultCoreEncryptedPayload {
  return payload as VaultCoreEncryptedPayload;
}

function envelopeScope(userId: string, resourceId?: string) {
  return { userId, resourceId: resourceId ?? userId };
}

export async function wrapVaultKeyForPasskey(
  vaultKey: CryptoKey,
  prfOutput: Uint8Array,
  userId: string,
  resourceId: string,
  operation?: VaultSessionOperation
): Promise<EncryptedPayload> {
  try {
    const envelope = await createPasskeyPrfEnvelopeWithSessionCache(
      vaultKey,
      prfOutput,
      { userId, resourceId },
      SELAHKEEP_VAULT_PROFILE,
      undefined,
      { operation }
    );
    return envelope.encryptedVaultKey as EncryptedPayload;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      error instanceof VaultKeyNotExtractableError ||
      message.includes("Cannot wrap a non-extractable vault key") ||
      (error instanceof VaultAuthorizationError &&
        message.includes(INNER_VAULT_KEY_CACHE_MISMATCH_MESSAGE))
    ) {
      throw new Error(PASSKEY_VAULT_UNLOCK_REWRAP_REQUIRES_UNLOCK_MESSAGE);
    }
    if (message.includes(INNER_VAULT_KEY_CACHE_MISMATCH_MESSAGE)) {
      throw new Error(PASSKEY_VAULT_UNLOCK_REWRAP_REQUIRES_UNLOCK_MESSAGE);
    }
    throw error;
  }
}

export async function unwrapVaultKeyFromPasskey(
  encryptedVaultKey: EncryptedPayload,
  prfOutput: Uint8Array,
  options?: {
    applySession?: boolean;
    userId?: string;
    resourceId?: string;
    operation?: VaultSessionOperation;
  }
): Promise<CryptoKey> {
  const scope = envelopeScope(options?.userId ?? encryptedVaultKey.aad.userId, options?.resourceId);
  const payload = asVaultCorePayload(encryptedVaultKey);
  const vaultKey = await unwrapVaultKeyFromPasskeyCore(
    payload,
    prfOutput,
    scope,
    SELAHKEEP_VAULT_PROFILE
  );
  if (options?.operation) assertVaultSessionOperationCurrent(options.operation);

  await cacheVaultInnerKeyMaterialFromPasskeyUnlock(
    vaultKey,
    { encryptedVaultKey: payload },
    prfOutput,
    { operation: options?.operation }
  );
  if (options?.operation) assertVaultSessionOperationCurrent(options.operation);

  if (options?.applySession ?? true) {
    await setUnlockedVaultSession({
      userVaultKey: vaultKey,
      method: "passkey_prf",
      operation: options?.operation,
    });
  }
  return vaultKey;
}

export async function unlockVaultFromPasskeyEnvelope(
  userId: string,
  encryptedVaultKey: EncryptedPayload,
  prfOutput: Uint8Array | null,
  options?: {
    prfRequired?: boolean;
    applySession?: boolean;
    resourceId?: string;
    operation?: VaultSessionOperation;
  }
): Promise<CryptoKey> {
  const scope = envelopeScope(userId, options?.resourceId);
  const payload = asVaultCorePayload(encryptedVaultKey);
  const vaultKey = await unlockVaultFromPasskeyEnvelopeCore(
    payload,
    prfOutput,
    scope,
    SELAHKEEP_VAULT_PROFILE,
    { prfRequired: options?.prfRequired }
  );
  if (options?.operation) assertVaultSessionOperationCurrent(options.operation);

  if (prfOutput) {
    await cacheVaultInnerKeyMaterialFromPasskeyUnlock(
      vaultKey,
      { encryptedVaultKey: payload },
      prfOutput,
      { operation: options?.operation }
    );
    if (options?.operation) assertVaultSessionOperationCurrent(options.operation);
  }

  if (options?.applySession ?? true) {
    await setUnlockedVaultSession({
      userVaultKey: vaultKey,
      method: "passkey_prf",
      operation: options?.operation,
    });
  }
  return vaultKey;
}

export async function unlockVaultFromPasskeyEnvelopeCandidates(input: {
  userId: string;
  verifiedCredentialId: string;
  candidates: readonly VaultPasskeyEnvelopeVariant[];
  prfOutput: Uint8Array | null;
  applySession?: boolean;
  cacheInnerKey?: boolean;
  operation?: VaultSessionOperation;
}): Promise<UnlockPasskeyPrfEnvelopeCandidatesResult> {
  const result = await unlockWithPasskeyPrfEnvelopeCandidates({
    verifiedCredentialId: input.verifiedCredentialId,
    candidates: input.candidates,
    prfOutput: input.prfOutput,
    expectedScope: envelopeScope(input.userId),
    profile: SELAHKEEP_VAULT_PROFILE,
  });
  if (input.operation) assertVaultSessionOperationCurrent(input.operation);

  if (result.status !== "matched") return result;

  const matchedCandidate = input.candidates.find(
    (candidate) => candidate.envelopeVariantId === result.envelopeVariantId
  );
  if (!matchedCandidate) {
    return {
      status: "malformed_candidate",
      reason: "invalid_candidate",
      candidateIndex: null,
    };
  }

  if ((input.cacheInnerKey ?? true) && input.prfOutput) {
    await cacheVaultInnerKeyMaterialFromPasskeyUnlock(
      result.vaultKey,
      matchedCandidate.envelope,
      input.prfOutput,
      { operation: input.operation }
    );
    if (input.operation) assertVaultSessionOperationCurrent(input.operation);
  }
  if (input.applySession ?? true) {
    await setUnlockedVaultSession({
      userVaultKey: result.vaultKey,
      method: "passkey_prf",
      operation: input.operation,
    });
  }
  return result;
}

export {
  PasskeyPrfRequiredError,
  PasskeyUnlockError,
  createPasskeyPrfEnvelope,
  unlockWithPasskeyPrfEnvelope,
} from "@tgoliveira/vault-core";
