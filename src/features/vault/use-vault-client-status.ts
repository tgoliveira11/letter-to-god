"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { vaultApi, type VaultStatus } from "@/lib/api-client/vault";
import {
  deriveClientStatusFromServer,
  type VaultClientStatus,
  type VaultSetupPhase,
} from "@/lib/vault/vault-status";
import { useVaultSessionUnlocked } from "@/features/vault/use-vault-session-unlocked";
import { subscribeVaultSession } from "@/lib/crypto-client/vault-session";
import { useApplicationState } from "@/components/application-state-provider";

type VaultClientStatusState =
  | { status: "loading" }
  | { status: "ready"; serverStatus: VaultStatus; setupPhase: VaultSetupPhase; clientStatus: VaultClientStatus }
  | { status: "error"; message: string };

export function useVaultClientStatus(): VaultClientStatusState & { recheck: () => void } {
  const application = useApplicationState();
  const ownerId = application.ownerId;
  const vaultUnlocked = useVaultSessionUnlocked();
  const [serverStatus, setServerStatus] = useState<VaultStatus | null>(() =>
    application.vaultStatus !== "unavailable" ? application.vaultStatus : null
  );
  const [fetchError, setFetchError] = useState<string | null>(() =>
    application.vaultStatus === "unavailable" ? "Failed to load vault status" : null
  );
  const [hasLoaded, setHasLoaded] = useState(
    application.vaultStatus !== null && application.vaultStatus !== "unavailable"
  );
  const [recheckToken, setRecheckToken] = useState(0);
  const requestGenerationRef = useRef(0);

  const recheck = useCallback(() => {
    setRecheckToken((token) => token + 1);
  }, []);

  useEffect(() => subscribeVaultSession(recheck), [recheck]);

  useEffect(() => {
    if (!ownerId) {
      return;
    }

    const generation = ++requestGenerationRef.current;
    const requestOwnerId = ownerId;

    vaultApi
      .status()
      .then((status) => {
        if (
          generation === requestGenerationRef.current &&
          requestOwnerId === ownerId
        ) {
          setServerStatus(status);
          setFetchError(null);
          setHasLoaded(true);
        }
      })
      .catch((error: unknown) => {
        if (
          generation === requestGenerationRef.current &&
          requestOwnerId === ownerId
        ) {
          setServerStatus(null);
          setFetchError(error instanceof Error ? error.message : "Failed to load vault status");
          setHasLoaded(true);
        }
      });

    return () => {
      requestGenerationRef.current += 1;
    };
  }, [ownerId, recheckToken]);

  if (!ownerId || !hasLoaded) {
    return { status: "loading", recheck };
  }

  if (fetchError || !serverStatus) {
    return {
      status: "error",
      message: fetchError ?? "Failed to load vault status",
      recheck,
    };
  }

  const clientStatus = deriveClientStatusFromServer(serverStatus, vaultUnlocked);

  return {
    status: "ready",
    serverStatus,
    setupPhase: serverStatus.setupPhase,
    clientStatus,
    recheck,
  };
}
