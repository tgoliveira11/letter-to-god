"use client";

import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { useCallback, useEffect, useState } from "react";
import {
  maybeUpgradePasswordEnvelopeAfterUnlock,
  maybeUpgradeRecoveryEnvelopeAfterUnlock,
  withVaultUnlockRateLimit,
  type EncryptedPayload as VaultCoreEncryptedPayload,
} from "@tgoliveira/vault-core";
import { unwrapVaultKeyFromRecovery } from "@/lib/crypto-client/vault";
import {
  hasUnlockedVaultSession,
  beginVaultOwnerOperation,
  getCurrentVaultSessionLease,
  lockVaultSessionManually,
  registerVaultUnloadGuard,
  unlockVaultSession,
} from "@/lib/crypto-client/vault-session";
import {
  assertVaultSessionLeaseCurrent,
  isVaultSessionOperationCurrent,
  VaultSessionOperationCancelledError,
} from "@tgoliveira/vault-core/browser";
import { vaultApi } from "@/lib/api-client/vault";
import { unlockVaultWithPasskey } from "@/features/passkey/unlock-with-passkey";
import { recordVaultSecurityEvent } from "@/features/vault/record-vault-security-event";
import {
  unwrapVaultKeyFromPassword,
  unwrapVaultKeyFromRecoveryPhrase,
} from "@/lib/crypto-client/vault-envelope";
import type { KdfMetadata, EncryptedPayload } from "@/lib/validation/encrypted-payload";
import { getVaultUnlockRateLimiter } from "@/lib/vault/vault-rate-limit";
import { envelopeScope } from "@/lib/vault/vault-envelope-scope";
import { SELAHKEEP_VAULT_PROFILE } from "@/modules/vault/selahkeep-profile";
import { useApplicationState } from "@/components/application-state-provider";
import { unlockWithPortablePasskey } from "@/features/passkey/portable-vault-broker";

export function useVault() {
  const { ownerId: userId, features } = useApplicationState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const unlockLimiter = getVaultUnlockRateLimiter();

  useEffect(() => {
    return registerVaultUnloadGuard();
  }, []);

  const lockVault = useCallback(() => {
    lockVaultSessionManually();
  }, []);

  const unlockFromPasskey = useCallback(
    async (
      prefetchedOptions?: PublicKeyCredentialRequestOptionsJSON | null,
      credentialId?: string
    ) => {
      if (!userId) throw new Error("Not authenticated");
      const operation = beginVaultOwnerOperation(userId);
      setLoading(true);
      setError(null);
      try {
        const key = await withVaultUnlockRateLimit(unlockLimiter, userId, "passkey_prf", async () =>
          unlockVaultWithPasskey(userId, credentialId, prefetchedOptions, operation)
        );
        const lease = getCurrentVaultSessionLease(userId);
        if (!lease) throw new VaultSessionOperationCancelledError("stale_operation");
        assertVaultSessionLeaseCurrent(lease);
        void recordVaultSecurityEvent("vault_unlocked", { method: "passkey_prf" });
        return key;
      } catch (e) {
        if (!(e instanceof VaultSessionOperationCancelledError)) {
          setError(e instanceof Error ? e.message : "Passkey unlock failed");
        }
        throw e;
      } finally {
        if (isVaultSessionOperationCurrent(operation)) setLoading(false);
      }
    },
    [unlockLimiter, userId]
  );

  const unlockFromPortablePasskey = useCallback(async () => {
    if (!userId) throw new Error("Not authenticated");
    if (!features.portableVaultBroker.enabled) {
      throw new Error("Portable passkey unlock is not enabled");
    }
    const operation = beginVaultOwnerOperation(userId);
    setLoading(true);
    setError(null);
    try {
      const key = await withVaultUnlockRateLimit(
        unlockLimiter,
        userId,
        "passkey_prf",
        async () => {
          const { active } = await vaultApi.listPortablePasskeys();
          const mapping = active[0];
          if (!mapping) throw new Error("No portable passkey is configured");
          const vaultKey = await unlockWithPortablePasskey({
            mapping,
            brokerUrl: features.portableVaultBroker.brokerUrl,
          });
          if (!isVaultSessionOperationCurrent(operation)) {
            throw new VaultSessionOperationCancelledError("stale_operation");
          }
          await unlockVaultSession(vaultKey, "portable_passkey", operation);
          return vaultKey;
        }
      );
      const lease = getCurrentVaultSessionLease(userId);
      if (!lease) throw new VaultSessionOperationCancelledError("stale_operation");
      assertVaultSessionLeaseCurrent(lease);
      void recordVaultSecurityEvent("vault_unlocked", { method: "portable_passkey" });
      return key;
    } catch (e) {
      if (!(e instanceof VaultSessionOperationCancelledError)) {
        setError(e instanceof Error ? e.message : "Portable passkey unlock failed");
      }
      throw e;
    } finally {
      if (isVaultSessionOperationCurrent(operation)) setLoading(false);
    }
  }, [features.portableVaultBroker, unlockLimiter, userId]);

  const unlockFromRecoveryCode = useCallback(
    async (recoveryCode: string) => {
      if (!userId) throw new Error("Not authenticated");
      const operation = beginVaultOwnerOperation(userId);
      setLoading(true);
      setError(null);
      try {
        await withVaultUnlockRateLimit(unlockLimiter, userId, "recovery_phrase", async () => {
          const { encryptedVaultKey, kdfMetadata } = await vaultApi.unlockWithRecoveryCode();
          if (!encryptedVaultKey || !kdfMetadata) {
            throw new Error("No recovery code configured");
          }
          await unwrapVaultKeyFromRecovery(recoveryCode, encryptedVaultKey, kdfMetadata, {
            applySession: true,
            operation,
          });
        });
      } catch (e) {
        if (!(e instanceof VaultSessionOperationCancelledError)) {
          setError(e instanceof Error ? e.message : "Recovery unlock failed");
        }
        throw e;
      } finally {
        if (isVaultSessionOperationCurrent(operation)) setLoading(false);
      }
    },
    [unlockLimiter, userId]
  );

  const unlockFromVaultPassword = useCallback(
    async (vaultPassword: string) => {
      if (!userId) throw new Error("Not authenticated");
      const operation = beginVaultOwnerOperation(userId);
      setLoading(true);
      setError(null);
      try {
        const vaultKey = await withVaultUnlockRateLimit(unlockLimiter, userId, "password", async () => {
          const { encryptedVaultKey, kdfMetadata } = await vaultApi.unlockEnvelope("password");
          if (!encryptedVaultKey || !kdfMetadata) {
            throw new Error("Vault password unlock is not configured");
          }
          const scope = envelopeScope(userId);
          const key = await unwrapVaultKeyFromPassword(
            vaultPassword,
            encryptedVaultKey,
            kdfMetadata as KdfMetadata,
            {
              applySession: true,
              unlockMethod: "password",
              userId,
              operation,
            }
          );
          const lease = getCurrentVaultSessionLease(userId);
          if (!lease) throw new VaultSessionOperationCancelledError("stale_operation");
          const upgrade = await maybeUpgradePasswordEnvelopeAfterUnlock({
            vaultKey: key,
            vaultPassword,
            envelope: {
              encryptedVaultKey: encryptedVaultKey as VaultCoreEncryptedPayload,
              kdfMetadata,
            } as Parameters<typeof maybeUpgradePasswordEnvelopeAfterUnlock>[0]["envelope"],
            scope,
            profile: SELAHKEEP_VAULT_PROFILE,
          });
          assertVaultSessionLeaseCurrent(lease);
          if (upgrade.upgradedEnvelope) {
            await vaultApi.replacePasswordEnvelope({
              encryptedVaultKey: upgrade.upgradedEnvelope
                .encryptedVaultKey as EncryptedPayload,
              kdfMetadata: upgrade.upgradedEnvelope.kdfMetadata as KdfMetadata,
            });
            assertVaultSessionLeaseCurrent(lease);
          }
          return key;
        });
        void recordVaultSecurityEvent("vault_unlocked", { method: "password" });
        return vaultKey;
      } catch (e) {
        if (!(e instanceof VaultSessionOperationCancelledError)) {
          setError(e instanceof Error ? e.message : "Vault password unlock failed");
        }
        throw e;
      } finally {
        if (isVaultSessionOperationCurrent(operation)) setLoading(false);
      }
    },
    [unlockLimiter, userId]
  );

  const unlockFromRecoveryPhrase = useCallback(
    async (recoveryPhrase: string) => {
      if (!userId) throw new Error("Not authenticated");
      const operation = beginVaultOwnerOperation(userId);
      setLoading(true);
      setError(null);
      try {
        const vaultKey = await withVaultUnlockRateLimit(
          unlockLimiter,
          userId,
          "recovery_phrase",
          async () => {
            const { encryptedVaultKey, kdfMetadata, publicMetadata } =
              await vaultApi.unlockEnvelope("recovery_phrase");
            if (!encryptedVaultKey || !kdfMetadata) {
              throw new Error("Recovery phrase unlock is not configured");
            }
            const scope = envelopeScope(userId);
            const key = await unwrapVaultKeyFromRecoveryPhrase(
              recoveryPhrase,
              encryptedVaultKey,
              kdfMetadata as KdfMetadata,
              {
                applySession: true,
                unlockMethod: "recovery_phrase",
                userId,
                expectedWordCount:
                  publicMetadata?.phraseLength === 12 || publicMetadata?.phraseLength === 24
                    ? publicMetadata.phraseLength
                    : undefined,
                operation,
              }
            );
            const lease = getCurrentVaultSessionLease(userId);
            if (!lease) throw new VaultSessionOperationCancelledError("stale_operation");
            const upgrade = await maybeUpgradeRecoveryEnvelopeAfterUnlock({
              vaultKey: key,
              recoveryPhrase,
              envelope: {
                encryptedVaultKey: encryptedVaultKey as VaultCoreEncryptedPayload,
                kdfMetadata,
                publicMetadata,
              } as Parameters<typeof maybeUpgradeRecoveryEnvelopeAfterUnlock>[0]["envelope"],
              scope,
              profile: SELAHKEEP_VAULT_PROFILE,
            });
            assertVaultSessionLeaseCurrent(lease);
            if (upgrade.upgradedEnvelope) {
              await vaultApi.replaceRecoveryPhrase({
                encryptedVaultKey: upgrade.upgradedEnvelope
                  .encryptedVaultKey as EncryptedPayload,
                kdfMetadata: upgrade.upgradedEnvelope.kdfMetadata as KdfMetadata,
                publicMetadata: upgrade.upgradedEnvelope.publicMetadata as
                  | { phraseLength: 12 | 24 }
                  | undefined,
              });
              assertVaultSessionLeaseCurrent(lease);
            }
            return key;
          }
        );
        void recordVaultSecurityEvent("vault_unlocked", { method: "recovery_phrase" });
        return vaultKey;
      } catch (e) {
        if (!(e instanceof VaultSessionOperationCancelledError)) {
          setError(e instanceof Error ? e.message : "Recovery phrase unlock failed");
        }
        throw e;
      } finally {
        if (isVaultSessionOperationCurrent(operation)) setLoading(false);
      }
    },
    [unlockLimiter, userId]
  );

  return {
    loading,
    error,
    isUnlocked: hasUnlockedVaultSession(),
    unlockFromPasskey,
    unlockFromPortablePasskey,
    unlockFromRecoveryCode,
    unlockFromVaultPassword,
    unlockFromRecoveryPhrase,
    lockVault,
  };
}
