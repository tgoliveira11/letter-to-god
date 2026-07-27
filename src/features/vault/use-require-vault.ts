"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { hasUnlockedVaultSession } from "@/lib/crypto-client/vault";
import { purgeTrustedDeviceIdb } from "@/lib/crypto-client/vault-idb-cleanup";
import {
  isVaultManuallyLocked,
  setUnlockedVaultSession,
  subscribeVaultSession,
} from "@/lib/crypto-client/vault-session";
import { applyUnlockBehavior } from "@/features/notes/eager-decrypt-notes";
import { useApplicationState } from "@/components/application-state-provider";

type VaultGateState =
  | { status: "loading" }
  | { status: "redirecting" }
  | { status: "ready"; userId: string; vaultUnlocked: boolean }
  | { status: "error"; message: string };

type VaultReadyState =
  | { status: "pending" }
  | { status: "ready"; userId: string; vaultUnlocked: boolean }
  | { status: "error"; message: string };

/**
 * Ensures the user is authenticated. Account session alone never unlocks the vault.
 */
export function useRequireVault(): VaultGateState & { recheckVault: () => void } {
  const application = useApplicationState();
  const userId = application.ownerId;
  const router = useRouter();
  const [readyState, setReadyState] = useState<VaultReadyState>({ status: "pending" });
  const [recheckToken, setRecheckToken] = useState(0);

  const recheckVault = useCallback(() => {
    setRecheckToken((token) => token + 1);
  }, []);

  useEffect(() => {
    return subscribeVaultSession(() => {
      setRecheckToken((token) => token + 1);
    });
  }, []);

  useEffect(() => {
    void purgeTrustedDeviceIdb();
  }, []);

  useEffect(() => {
    if (!userId) {
      router.push("/login");
    }
  }, [router, userId]);

  useEffect(() => {
    if (!userId) return;
    const activeUserId = userId;
    let cancelled = false;

    async function ensureAuth() {
      if (isVaultManuallyLocked()) {
        if (!cancelled) {
          setReadyState({ status: "ready", userId: activeUserId, vaultUnlocked: false });
        }
        return;
      }

      const vaultUnlocked = hasUnlockedVaultSession();

      if (!cancelled) {
        setReadyState({ status: "ready", userId: activeUserId, vaultUnlocked });
      }

      if (vaultUnlocked && !cancelled) {
        void applyUnlockBehavior(activeUserId).catch(() => undefined);
      }
    }

    ensureAuth();

    return () => {
      cancelled = true;
    };
  }, [recheckToken, userId]);

  if (!userId) {
    return { status: "redirecting", recheckVault };
  }

  if (readyState.status === "pending") {
    return { status: "loading", recheckVault };
  }

  return { ...readyState, recheckVault };
}

/** Call after generating a new vault key during first-time setup. */
export async function rememberVaultKey(userId: string, vaultKey: CryptoKey): Promise<void> {
  const { beginVaultOwnerOperation } = await import("@/lib/crypto-client/vault-session");
  const operation = beginVaultOwnerOperation(userId);
  await setUnlockedVaultSession({ userVaultKey: vaultKey, method: "password", operation });
}
