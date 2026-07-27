"use client";

import { useEffect, useRef, useState } from "react";
import { useOnVaultLocked } from "@tgoliveira/vault-core/react";
import { notesApi } from "@/lib/api-client/notes";
import { decryptNote } from "@/lib/crypto-client/notes";
import {
  getCachedNoteBody,
  setCachedNoteBody,
} from "@/features/notes/eager-decrypt-notes";
import type { VaultIndexPlaintext } from "@/lib/crypto-client/vault-index-types";
import { parseSearchTerms } from "@/lib/notes/search-normalize";
import { AsyncOwnershipController, isAsyncOwnershipCancellation } from "@/lib/application-state/async-ownership";
import {
  assertVaultAsyncOwnershipCurrent,
  captureVaultAsyncOwnership,
  type VaultAsyncOwnership,
} from "@/lib/application-state/vault-async-ownership";
import { useApplicationState } from "@/components/application-state-provider";

/**
 * Load decrypted note bodies in memory for full-text search after vault unlock.
 * Bodies are never sent to the server and are cleared when the vault locks.
 */
export function useNoteSearchBodies(
  index: VaultIndexPlaintext | null,
  searchQuery: string,
  vaultUnlocked: boolean
): { bodies: Map<string, string> | undefined; loading: boolean } {
  const [bodies, setBodies] = useState<Map<string, string> | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const ownershipRef = useRef(new AsyncOwnershipController());
  const { ownerId } = useApplicationState();

  const terms = parseSearchTerms(searchQuery);
  const needsBodies = vaultUnlocked && Boolean(index) && terms.length > 0;

  const entryKey = index?.entries.map((entry) => entry.id).join(",") ?? "";

  useEffect(() => {
    const controller = ownershipRef.current;
    if (!needsBodies || !index) {
      setBodies(undefined);
      setLoading(false);
      return;
    }

    if (!ownerId) {
      ownershipRef.current.invalidate();
      setBodies(undefined);
      return;
    }
    const activeIndex = index;
    let ownership: VaultAsyncOwnership;
    try {
      ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId,
        resourceId: `note-search:${entryKey}:${searchQuery}`,
      });
    } catch {
      setBodies(undefined);
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      const next = new Map<string, string>();
      try {
        await Promise.all(
          activeIndex.entries.map(async (entry) => {
            const cached = getCachedNoteBody(entry.id);
            if (cached !== undefined) {
              next.set(entry.id, cached);
              return;
            }
            const note = await notesApi.get(entry.id);
            assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
            const decrypted = await decryptNote(
              note.encryptedMetadata,
              note.encryptedBody,
              note.encryptedWrappedNoteKey,
              ownership.lease.vaultKey
            );
            assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
            next.set(entry.id, decrypted.body);
          })
        );
        assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
        for (const [noteId, body] of next) setCachedNoteBody(noteId, body);
        setBodies(next);
      } catch (cause) {
        if (!isAsyncOwnershipCancellation(cause)) setBodies(undefined);
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) setLoading(false);
      }
    }

    void load();
    return () => {
      controller.invalidate();
    };
  }, [needsBodies, entryKey, searchQuery, index, ownerId]);

  useOnVaultLocked(() => {
    ownershipRef.current.invalidate();
    setBodies(undefined);
    setLoading(false);
  });

  return { bodies: needsBodies ? bodies : undefined, loading };
}
