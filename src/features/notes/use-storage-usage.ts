"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOnVaultLocked } from "@tgoliveira/vault-core/react";
import { storageUsageApi, type StorageUsageResponse } from "@/lib/api-client/note-attachments";
import { useApplicationState } from "@/components/application-state-provider";
import { AsyncOwnershipController, isAsyncOwnershipCancellation } from "@/lib/application-state/async-ownership";
import { assertVaultAsyncOwnershipCurrent, captureVaultAsyncOwnership } from "@/lib/application-state/vault-async-ownership";

export function useStorageUsage(enabled: boolean) {
  const { ownerId } = useApplicationState();
  const [usage, setUsage] = useState<StorageUsageResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownershipRef = useRef(new AsyncOwnershipController());

  const reload = useCallback(async () => {
    if (!enabled || !ownerId) return;
    const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
      ownerId,
      resourceId: "storage-usage",
    });
    setLoading(true);
    setError(null);
    try {
      const data = await storageUsageApi.get();
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setUsage(data);
    } catch (e) {
      if (!isAsyncOwnershipCancellation(e)) {
        setError(e instanceof Error ? e.message : "Failed to load storage usage");
        setUsage(null);
      }
    } finally {
      if (ownershipRef.current.isCurrent(ownership.token)) setLoading(false);
    }
  }, [enabled, ownerId]);

  useEffect(() => {
    if (!enabled || !ownerId) {
      ownershipRef.current.invalidate();
      setUsage(null);
      setLoading(false);
      setError(null);
      return;
    }
    void reload().catch((cause: unknown) => {
      if (!isAsyncOwnershipCancellation(cause)) {
        setError(cause instanceof Error ? cause.message : "Failed to load storage usage");
      }
      setLoading(false);
    });
  }, [enabled, ownerId, reload]);

  useOnVaultLocked(() => {
    ownershipRef.current.invalidate();
    setUsage(null);
    setLoading(false);
    setError(null);
  });

  return { usage, loading, error, reload };
}

export function formatStorageMb(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb < 0.1) return "< 0.1 MB";
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}
