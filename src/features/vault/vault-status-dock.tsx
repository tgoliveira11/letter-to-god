"use client";

import Link from "next/link";
import { useCallback, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  VaultStatusDock as CoreVaultStatusDock,
  createVaultFullUnlockPageMatcher,
} from "@tgoliveira/vault-core/react";
import { useVault } from "@/features/vault/use-vault";
import { useVaultClientStatus } from "@/features/vault/use-vault-client-status";
import { VaultDockQuickUnlockSlot } from "@/features/vault/vault-dock-quick-unlock-slot";
import { useVaultPasskeyUnlockPrefetch } from "@/features/passkey/use-vault-passkey-unlock-prefetch";
import type { VaultPasskeyUnlockPrefetch } from "@/features/passkey/use-vault-passkey-unlock-prefetch";
import { useVaultDockPasskeyAvailable } from "@/features/vault/vault-dock-passkey-availability";
import { hasUnlockedVaultSession } from "@/lib/crypto-client/vault";
import { buildVaultUnlockHref } from "@/lib/notes/safe-return-to";
import { getVaultUnlockRateLimiter } from "@/lib/vault/vault-rate-limit";
import { toVaultServerStatusSnapshot } from "@/lib/vault/vault-server-snapshot";
import { isVaultFullUnlockPage } from "@/features/vault/vault-status-dock-routes";
import { lockVaultSessionManually, touchVaultSession } from "@/lib/crypto-client/vault-session";
import { useBrowserCapabilities } from "@/components/browser-capabilities-provider";
import { useApplicationState } from "@/components/application-state-provider";

const UNLOCK_PATH = "/vault/unlock";
const DOCK_COLLAPSED_KEY = "selahkeep:vault-status-dock:collapsed";

export function VaultStatusDock() {
  const application = useApplicationState();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const capabilities = useBrowserCapabilities();
  const vaultClient = useVaultClientStatus();
  const {
    loading,
    error,
    unlockFromPasskey,
    unlockFromVaultPassword,
  } = useVault();
  const serverStatus = vaultClient.status === "ready" ? vaultClient.serverStatus : null;
  const passkeyAvailability = useVaultDockPasskeyAvailable(serverStatus);
  const { refresh: refreshPasskeyOptions } = useVaultPasskeyUnlockPrefetch(
    passkeyAvailability.showPasskey
  );
  /** Survives VaultDockQuickUnlock remounts (e.g. React Strict Mode, page re-render on unlock). */
  const passkeyUnlockInFlightRef = useRef(false);

  const runDockPasskeyUnlock = useCallback(
    async (
      collapse: () => void,
      prefetch: VaultPasskeyUnlockPrefetch | null
    ) => {
      if (!passkeyAvailability.showPasskey || passkeyUnlockInFlightRef.current) return;
      passkeyUnlockInFlightRef.current = true;
      try {
        await unlockFromPasskey(prefetch?.options, prefetch?.credentialId);
        collapse();
      } finally {
        passkeyUnlockInFlightRef.current = false;
      }
    },
    [passkeyAvailability.showPasskey, unlockFromPasskey]
  );

  const handleDockPasskeyUnlockFailed = useCallback(
    (error: unknown, onNavigateToUnlockPage: (error: unknown) => void) => {
      if (hasUnlockedVaultSession()) return;
      onNavigateToUnlockPage(error);
    },
    []
  );

  if (!application.ownerId) return null;
  if (vaultClient.status !== "ready") return null;
  if (capabilities.passkeyPrf.status === "checking") return null;
  if (isVaultFullUnlockPage(pathname)) return null;

  const { clientStatus } = vaultClient;
  const snapshot = toVaultServerStatusSnapshot(serverStatus!);
  const returnPath = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`;
  const rateLimiter = getVaultUnlockRateLimiter();
  const rateLimitScopeKey = application.ownerId;

  return (
    <CoreVaultStatusDock
      visible
      serverStatus={snapshot}
      prfSupported={capabilities.passkeyPrf.status === "supported"}
      pathname={pathname}
      unlockPath={UNLOCK_PATH}
      buildUnlockHref={(path) => buildVaultUnlockHref(path ?? returnPath)}
      isFullUnlockPage={createVaultFullUnlockPageMatcher(UNLOCK_PATH)}
      quickUnlockEnabled={clientStatus !== "not_configured" && clientStatus !== "setup_incomplete"}
      loading={loading}
      unlockError={error}
      collapsedPreferenceKey={DOCK_COLLAPSED_KEY}
      LinkComponent={Link}
      onLock={() => lockVaultSessionManually()}
      onStayUnlocked={() => touchVaultSession()}
      onNavigateToUnlock={(href) => router.push(href)}
      renderQuickUnlock={({
        loading: dockLoading,
        error: dockError,
        collapse,
        onPasskeyUnlockFailed,
        onPasskeyUnlockCancelled,
        bindAutoStartPasskey,
      }) => (
        <VaultDockQuickUnlockSlot
          loading={dockLoading}
          error={dockError}
          serverStatus={snapshot}
          passkeyReady={passkeyAvailability.showPasskey}
          unlockRateLimiter={rateLimiter}
          rateLimitScopeKey={rateLimitScopeKey}
          refreshPasskeyOptions={refreshPasskeyOptions}
          onPasskeyUnlockCancelled={onPasskeyUnlockCancelled}
          onPasskeyUnlockFailed={(passkeyError) =>
            handleDockPasskeyUnlockFailed(passkeyError, onPasskeyUnlockFailed)
          }
          bindAutoStartPasskey={bindAutoStartPasskey}
          onUnlockPassword={async (password) => {
            await unlockFromVaultPassword(password);
            collapse();
          }}
          onUnlockPasskey={(prefetch) => runDockPasskeyUnlock(collapse, prefetch)}
        />
      )}
    />
  );
}
