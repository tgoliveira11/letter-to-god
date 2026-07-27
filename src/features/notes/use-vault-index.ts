"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOnVaultLocked } from "@tgoliveira/vault-core/react";
import { vaultApi } from "@/lib/api-client/vault";
import {
  createEmptyVaultIndex,
  decryptVaultIndex,
  encryptVaultIndex,
  type VaultIndexPlaintext,
} from "@/lib/crypto-client/vault-index";
import { subscribeVaultSession } from "@/lib/crypto-client/vault-session";
import {
  AsyncOwnershipController,
  isAsyncOwnershipCancellation,
} from "@/lib/application-state/async-ownership";
import {
  assertVaultAsyncOwnershipCurrent,
  captureVaultAsyncOwnership,
} from "@/lib/application-state/vault-async-ownership";

export function useVaultIndex(userId: string | null, vaultUnlocked: boolean) {
  const canLoad = Boolean(userId && vaultUnlocked);
  const [index, setIndex] = useState<VaultIndexPlaintext | null>(null);
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
        resourceId: "vault-index",
      });
      setLoading(true);
      setError(null);
      try {
        const { encryptedVaultIndex } = await vaultApi.getIndex();
        assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
        const decrypted = encryptedVaultIndex
          ? await decryptVaultIndex(encryptedVaultIndex, userId!, ownership.lease.vaultKey)
          : createEmptyVaultIndex();
        assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
        if (!cancelled) setIndex(decrypted);
      } catch (e) {
        if (!cancelled && !isAsyncOwnershipCancellation(e)) {
          setError(e instanceof Error ? e.message : "Failed to load vault index");
          setIndex(null);
        }
      } finally {
        if (!cancelled && ownershipRef.current.isCurrent(ownership.token)) setLoading(false);
      }
    }

    void load().catch((error: unknown) => {
      if (!isAsyncOwnershipCancellation(error)) {
        setError(error instanceof Error ? error.message : "Failed to load vault index");
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
        setIndex(null);
      }),
    []
  );

  useOnVaultLocked(() => {
    ownershipRef.current.invalidate();
    setIndex(null);
  });

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  const persistIndex = useCallback(
    async (next: VaultIndexPlaintext) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: "vault-index",
      });

      const encrypted = await encryptVaultIndex(next, userId, ownership.lease.vaultKey);
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      await vaultApi.updateIndex(encrypted);
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setIndex(next);
    },
    [userId]
  );

  const mutateIndex = useCallback(
    async (mutate: (current: VaultIndexPlaintext) => VaultIndexPlaintext) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: "vault-index",
      });

      const { encryptedVaultIndex } = await vaultApi.getIndex();
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      const current = encryptedVaultIndex
        ? await decryptVaultIndex(encryptedVaultIndex, userId, ownership.lease.vaultKey)
        : createEmptyVaultIndex();
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      const next = mutate(current);
      await persistIndex(next);
      return next;
    },
    [persistIndex, userId]
  );

  return {
    index: canLoad ? index : null,
    loading: canLoad ? loading : false,
    error: canLoad ? error : null,
    reload,
    persistIndex,
    mutateIndex,
  };
}
