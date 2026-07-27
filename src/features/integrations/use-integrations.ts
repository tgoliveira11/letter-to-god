"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOnVaultLocked } from "@tgoliveira/vault-core/react";
import {
  integrationsApi,
  type CreateIntegrationResponse,
  type IntegrationGrantSummary,
  type IntegrationListItem,
} from "@/lib/api-client/integrations";
import { notesApi } from "@/lib/api-client/notes";
import { kanbanApi } from "@/lib/api-client/kanban";
import {
  deriveIntegrationKey,
  exportIntegrationKeyBase64Url,
  wrapResourceKeyForIntegration,
} from "@/lib/crypto-client/integrations";
import { unwrapNoteKey } from "@/lib/crypto-client/note-key";
import { unwrapContentKey } from "@/lib/crypto-client/kanban";
import { useApplicationState } from "@/components/application-state-provider";
import { AsyncOwnershipController, isAsyncOwnershipCancellation } from "@/lib/application-state/async-ownership";
import { assertVaultAsyncOwnershipCurrent, captureVaultAsyncOwnership } from "@/lib/application-state/vault-async-ownership";

export function useIntegrations(enabled: boolean) {
  const { ownerId } = useApplicationState();
  const [integrations, setIntegrations] = useState<IntegrationListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownershipRef = useRef(new AsyncOwnershipController());

  const reload = useCallback(async () => {
    if (!enabled || !ownerId) return;
    const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
      ownerId,
      resourceId: "integrations",
    });
    setLoading(true);
    setError(null);
    try {
      const rows = await integrationsApi.list();
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setIntegrations(rows);
    } catch (e) {
      if (!isAsyncOwnershipCancellation(e)) {
        setError(e instanceof Error ? e.message : "Failed to load integrations");
      }
    } finally {
      if (ownershipRef.current.isCurrent(ownership.token)) setLoading(false);
    }
  }, [enabled, ownerId]);

  useEffect(() => {
    if (!enabled || !ownerId) {
      ownershipRef.current.invalidate();
      setIntegrations([]);
      setLoading(false);
      setError(null);
      return;
    }
    void reload().catch((loadError: unknown) => {
      if (!isAsyncOwnershipCancellation(loadError)) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load integrations");
        setLoading(false);
      }
    });
  }, [enabled, ownerId, reload]);

  useOnVaultLocked(() => {
    ownershipRef.current.invalidate();
    setIntegrations([]);
    setError(null);
    setLoading(false);
  });

  const createIntegration = useCallback(async (name: string) => {
    if (!ownerId) throw new Error("Not authenticated");
    const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
      ownerId,
      resourceId: "integration:create",
    });
    const created = await integrationsApi.create(name);
    assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
    const iek = await deriveIntegrationKey(created.integrationId);
    assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
    const integrationKey = await exportIntegrationKeyBase64Url(iek);
    assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
    const rows = await integrationsApi.list();
    assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
    setIntegrations(rows);
    return { ...created, integrationKey } satisfies CreateIntegrationResponse & {
      integrationKey: string;
    };
  }, [ownerId]);

  const revokeIntegration = useCallback(
    async (id: string) => {
      if (!ownerId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId,
        resourceId: `integration:${id}`,
      });
      await integrationsApi.revoke(id);
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      const rows = await integrationsApi.list();
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setIntegrations(rows);
    },
    [ownerId]
  );

  const saveGrants = useCallback(
    async (
      userId: string,
      integrationId: string,
      items: Array<{
        resourceType: "note" | "kanban_board";
        resourceId: string;
        permissions: "read" | "write";
      }>
    ): Promise<IntegrationGrantSummary[]> => {
      if (!ownerId || ownerId !== userId) throw new Error("Account ownership changed");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId,
        resourceId: `integration-grants:${integrationId}`,
      });
      const iek = await deriveIntegrationKey(integrationId);
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      const grants = [];

      for (const item of items) {
        let resourceKey: CryptoKey;
        if (item.resourceType === "note") {
          const note = await notesApi.get(item.resourceId);
          assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
          resourceKey = await unwrapNoteKey(note.encryptedWrappedNoteKey);
        } else {
          const board = await kanbanApi.get(item.resourceId);
          assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
          resourceKey = await unwrapContentKey(board.encryptedWrappedKey);
        }
        assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);

        const encryptedWrappedKey = await wrapResourceKeyForIntegration(
          userId,
          integrationId,
          item.resourceId,
          resourceKey,
          iek
        );
        assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);

        grants.push({
          resourceType: item.resourceType,
          resourceId: item.resourceId,
          permissions: item.permissions,
          encryptedWrappedKey,
        });
      }

      const saved = await integrationsApi.upsertGrants(integrationId, { grants });
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      return saved;
    },
    [ownerId]
  );

  return {
    integrations,
    loading,
    error,
    reload,
    createIntegration,
    revokeIntegration,
    saveGrants,
  };
}
