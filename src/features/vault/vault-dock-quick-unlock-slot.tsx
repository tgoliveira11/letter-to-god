"use client";

import { useEffect, useRef, useState } from "react";
import { VaultDockQuickUnlock } from "@tgoliveira/vault-core/react";
import type { VaultPasskeyUnlockPrefetch } from "@/features/passkey/use-vault-passkey-unlock-prefetch";
import type { VaultServerStatusSnapshot } from "@tgoliveira/vault-core/react";
import { Alert } from "@/components/ui/alert";
import { getVaultUnlockRateLimiter } from "@/lib/vault/vault-rate-limit";

type VaultUnlockRateLimiter = ReturnType<typeof getVaultUnlockRateLimiter>;

interface VaultDockQuickUnlockSlotProps {
  loading: boolean;
  error: string | null;
  serverStatus: VaultServerStatusSnapshot;
  passkeyReady: boolean;
  portablePasskey: boolean;
  unlockRateLimiter: VaultUnlockRateLimiter;
  rateLimitScopeKey: string;
  refreshPasskeyOptions: () => Promise<VaultPasskeyUnlockPrefetch | null>;
  onUnlockPassword: (password: string) => Promise<void>;
  onUnlockPasskey: (prefetch: VaultPasskeyUnlockPrefetch | null) => Promise<void>;
  onPasskeyUnlockFailed: (error: unknown) => void;
  onPasskeyUnlockCancelled: (error: unknown) => void;
  bindAutoStartPasskey: (handler: (() => void) | null) => void;
}

/**
 * Renders only while the dock quick-unlock panel is expanded. Refreshes WebAuthn
 * options on each mount (expand), then starts the passkey ceremony once options
 * are ready.
 *
 * vault-core's built-in auto-start runs on expand *before* options exist and can
 * lose its pending slot if the dock collapses during the fetch (sessionStorage
 * dedupe then blocks the next expand for ~10s). We disable that path and auto-
 * start here only after prefetch succeeds.
 */
export function VaultDockQuickUnlockSlot({
  loading,
  error,
  serverStatus,
  passkeyReady,
  portablePasskey,
  unlockRateLimiter,
  rateLimitScopeKey,
  refreshPasskeyOptions,
  onUnlockPassword,
  onUnlockPasskey,
  onPasskeyUnlockFailed,
  onPasskeyUnlockCancelled,
  bindAutoStartPasskey,
}: VaultDockQuickUnlockSlotProps) {
  const [passkeyOptionsReady, setPasskeyOptionsReady] = useState(false);
  const latestPrefetchRef = useRef<VaultPasskeyUnlockPrefetch | null>(null);
  const autoStartedRef = useRef(false);
  const onUnlockPasskeyRef = useRef(onUnlockPasskey);

  useEffect(() => {
    onUnlockPasskeyRef.current = onUnlockPasskey;
  }, [onUnlockPasskey]);

  useEffect(() => {
    let cancelled = false;
    autoStartedRef.current = false;
    setPasskeyOptionsReady(false);
    latestPrefetchRef.current = null;

    if (portablePasskey) {
      setPasskeyOptionsReady(true);
      return () => setPasskeyOptionsReady(false);
    }

    void refreshPasskeyOptions().then((prefetch) => {
      if (cancelled) return;
      latestPrefetchRef.current = prefetch;
      setPasskeyOptionsReady(prefetch?.options != null);
    });

    return () => {
      cancelled = true;
      setPasskeyOptionsReady(false);
      latestPrefetchRef.current = null;
    };
  }, [portablePasskey, refreshPasskeyOptions]);

  useEffect(() => {
    if (portablePasskey || !passkeyReady || !passkeyOptionsReady || loading) return;
    if (autoStartedRef.current) return;
    if (!latestPrefetchRef.current?.options) return;
    autoStartedRef.current = true;
    void onUnlockPasskeyRef.current(latestPrefetchRef.current);
  }, [portablePasskey, passkeyReady, passkeyOptionsReady, loading]);

  // Keep vault-core's bind slot clear so expand-time auto-start never races us.
  useEffect(() => {
    bindAutoStartPasskey(null);
    return () => bindAutoStartPasskey(null);
  }, [bindAutoStartPasskey]);

  return (
    <VaultDockQuickUnlock
      loading={loading}
      emergencyModeEnabled={false}
      error={error}
      serverStatus={serverStatus}
      passkeyReady={passkeyReady}
      passkeyOptionsReady={passkeyOptionsReady}
      autoStartPasskey={false}
      unlockRateLimiter={unlockRateLimiter}
      rateLimitScopeKey={rateLimitScopeKey}
      bindAutoStartPasskey={bindAutoStartPasskey}
      onPasskeyUnlockFailed={onPasskeyUnlockFailed}
      onPasskeyUnlockCancelled={onPasskeyUnlockCancelled}
      onUnlockPassword={onUnlockPassword}
      onUnlockPasskey={() => onUnlockPasskey(latestPrefetchRef.current)}
      renderError={(message) => (
        <Alert variant="danger" title="Unlock failed">
          {message}
        </Alert>
      )}
    />
  );
}
