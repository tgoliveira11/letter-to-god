"use client";

import { useEffect, useRef, useState } from "react";
import { useOnVaultLocked } from "@tgoliveira/vault-core/react";
import { notesApi } from "@/lib/api-client/notes";
import { decryptNote } from "@/lib/crypto-client/notes";
import { getCachedNoteBody, setCachedNoteBody } from "@/features/notes/eager-decrypt-notes";
import { buildNotePreview, extractNoteExcerpt } from "@/lib/notes/note-excerpt";
import type { VaultIndexPlaintext } from "@/lib/crypto-client/vault-index-types";
import { AsyncOwnershipController, isAsyncOwnershipCancellation } from "@/lib/application-state/async-ownership";
import {
  assertVaultAsyncOwnershipCurrent,
  captureVaultAsyncOwnership,
  type VaultAsyncOwnership,
} from "@/lib/application-state/vault-async-ownership";
import { useApplicationState } from "@/components/application-state-provider";

/**
 * Decrypt note bodies in memory for list excerpts after vault unlock.
 * Cleared when vault locks; never sent to server. Returns both the inline
 * two-line `excerpts` and richer `previews` (markdown kept) for hover popovers.
 */
export function useNoteListExcerpts(
  index: VaultIndexPlaintext | null,
  vaultUnlocked: boolean,
  enabled: boolean
): { excerpts: Map<string, string>; previews: Map<string, string>; loading: boolean } {
  const [excerpts, setExcerpts] = useState<Map<string, string>>(new Map());
  const [previews, setPreviews] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const ownershipRef = useRef(new AsyncOwnershipController());
  const { ownerId } = useApplicationState();

  const entryKey = index?.entries.map((entry) => entry.id).join(",") ?? "";

  useEffect(() => {
    const controller = ownershipRef.current;
    if (!enabled || !vaultUnlocked || !index) {
      setExcerpts(new Map());
      setPreviews(new Map());
      setLoading(false);
      return;
    }

    if (!ownerId) {
      ownershipRef.current.invalidate();
      setExcerpts(new Map());
      return;
    }
    const activeIndex = index;
    let ownership: VaultAsyncOwnership;
    try {
      ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId,
        resourceId: `note-excerpts:${entryKey}`,
      });
    } catch {
      setExcerpts(new Map());
      setPreviews(new Map());
      setLoading(false);
      return;
    }

    async function load() {
      setLoading(true);
      const next = new Map<string, string>();
      const nextPreviews = new Map<string, string>();
      const nextBodies = new Map<string, string>();
      try {
        const activeEntries = activeIndex.entries.filter((entry) => !entry.trashed);
        await Promise.all(
          activeEntries.slice(0, 50).map(async (entry) => {
            let body = getCachedNoteBody(entry.id);
            if (body === undefined) {
              const note = await notesApi.get(entry.id);
              assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
              const decrypted = await decryptNote(
                note.encryptedMetadata,
                note.encryptedBody,
                note.encryptedWrappedNoteKey,
                ownership.lease.vaultKey
              );
              assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
              body = decrypted.body;
              nextBodies.set(entry.id, body);
            }
            const excerpt = extractNoteExcerpt(body);
            if (excerpt) next.set(entry.id, excerpt);
            const preview = buildNotePreview(body);
            if (preview) nextPreviews.set(entry.id, preview);
          })
        );
        assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
        for (const [noteId, body] of nextBodies) setCachedNoteBody(noteId, body);
        setExcerpts(next);
        setPreviews(nextPreviews);
      } catch (cause) {
        if (!isAsyncOwnershipCancellation(cause)) {
          setExcerpts(new Map());
          setPreviews(new Map());
        }
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) setLoading(false);
      }
    }

    void load();
    return () => {
      controller.invalidate();
    };
  }, [enabled, vaultUnlocked, entryKey, index, ownerId]);

  useOnVaultLocked(() => {
    ownershipRef.current.invalidate();
    setExcerpts(new Map());
    setPreviews(new Map());
    setLoading(false);
  });

  return { excerpts, previews, loading };
}
