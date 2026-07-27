"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOnVaultLocked } from "@tgoliveira/vault-core/react";
import { vaultApi } from "@/lib/api-client/vault";
import {
  decryptVaultSettings,
  encryptVaultSettings,
  defaultVaultSettings,
  type VaultSettingsPlaintext,
  type VaultUnlockBehavior,
} from "@/lib/crypto-client/vault-settings";
import { subscribeVaultSession } from "@/lib/crypto-client/vault-session";
import { AsyncOwnershipController, isAsyncOwnershipCancellation } from "@/lib/application-state/async-ownership";
import { assertVaultAsyncOwnershipCurrent, captureVaultAsyncOwnership } from "@/lib/application-state/vault-async-ownership";

export function useVaultSettings(userId: string | null, vaultUnlocked: boolean) {
  const canLoad = Boolean(userId && vaultUnlocked);
  const [settings, setSettings] = useState<VaultSettingsPlaintext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const ownershipRef = useRef(new AsyncOwnershipController());

  useEffect(() => {
    if (!canLoad) return;

    let cancelled = false;
    const controller = ownershipRef.current;

    async function load() {
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId!,
        resourceId: "vault-settings",
      });
      setLoading(true);
      setError(null);
      try {
        const { encryptedVaultSettings } = await vaultApi.getSettings();
        assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
        const decrypted = encryptedVaultSettings
          ? await decryptVaultSettings(encryptedVaultSettings, userId!, ownership.lease.vaultKey)
          : defaultVaultSettings();
        assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
        if (!cancelled) setSettings(decrypted);
      } catch (e) {
        if (!cancelled && !isAsyncOwnershipCancellation(e)) {
          setError(e instanceof Error ? e.message : "Failed to load vault settings");
          setSettings(null);
        }
      } finally {
        if (!cancelled && ownershipRef.current.isCurrent(ownership.token)) setLoading(false);
      }
    }

    void load().catch((error: unknown) => {
      if (!isAsyncOwnershipCancellation(error)) {
        setError(error instanceof Error ? error.message : "Failed to load vault settings");
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
      controller.invalidate();
    };
  }, [canLoad, reloadToken, userId]);

  useEffect(
    () =>
      subscribeVaultSession(() => {
        ownershipRef.current.invalidate();
        setSettings(null);
      }),
    []
  );

  useOnVaultLocked(() => {
    ownershipRef.current.invalidate();
    setSettings(null);
  });

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  const updateUnlockBehavior = useCallback(
    async (unlockBehavior: VaultUnlockBehavior) => {
      if (!userId || !settings) throw new Error("Vault settings unavailable");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: "vault-settings",
      });

      const next = { ...settings, unlockBehavior };
      const encrypted = await encryptVaultSettings(next, userId, ownership.lease.vaultKey);
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      await vaultApi.updateSettings(encrypted);
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setSettings(next);
      return next;
    },
    [userId, settings]
  );

  return {
    settings: canLoad ? settings : null,
    loading: canLoad ? loading : false,
    error: canLoad ? error : null,
    reload,
    updateUnlockBehavior,
  };
}
