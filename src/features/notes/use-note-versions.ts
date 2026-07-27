"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOnVaultLocked } from "@tgoliveira/vault-core/react";
import { noteVersionsApi, type NoteVersionResponse } from "@/lib/api-client/note-versions";
import {
  decryptNoteVersion,
  decryptNoteVersionMetadata,
  type DecryptedNoteVersion,
} from "@/lib/crypto-client/note-versions";
import { useApplicationState } from "@/components/application-state-provider";
import { AsyncOwnershipController, isAsyncOwnershipCancellation } from "@/lib/application-state/async-ownership";
import { assertVaultAsyncOwnershipCurrent, captureVaultAsyncOwnership } from "@/lib/application-state/vault-async-ownership";

export interface NoteVersionSummary {
  id: string;
  versionNumber: number;
  createdAt: string;
  title: string;
  raw: NoteVersionResponse;
}

/**
 * Loads and decrypts the encrypted version history for a note. Metadata is
 * decrypted up front for the list; full content (body) is decrypted on demand
 * for preview / diff. All decryption is client-side via the active vault key.
 */
export function useNoteVersions(noteId: string | null, enabled: boolean) {
  const { ownerId } = useApplicationState();
  const [versions, setVersions] = useState<NoteVersionSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownershipRef = useRef(new AsyncOwnershipController());

  const reload = useCallback(async () => {
    if (!noteId || !enabled || !ownerId) return;
    const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
      ownerId,
      resourceId: `note-versions:${noteId}`,
    });
    setLoading(true);
    setError(null);
    try {
      const rows = await noteVersionsApi.list(noteId);
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      const summaries = await Promise.all(
        rows.map(async (row) => {
          const metadata = await decryptNoteVersionMetadata(
            row.encryptedMetadata,
            row.encryptedWrappedNoteKey
          );
          return {
            id: row.id,
            versionNumber: row.versionNumber,
            createdAt: row.createdAt,
            title: metadata.title,
            raw: row,
          } satisfies NoteVersionSummary;
        })
      );
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setVersions(summaries);
    } catch (e) {
      if (!isAsyncOwnershipCancellation(e)) {
        setError(e instanceof Error ? e.message : "Failed to load version history");
      }
    } finally {
      if (ownershipRef.current.isCurrent(ownership.token)) setLoading(false);
    }
  }, [noteId, enabled, ownerId]);

  useEffect(() => {
    if (!enabled) {
      ownershipRef.current.invalidate();
      setVersions([]);
      return;
    }
    void reload();
  }, [enabled, reload]);

  useOnVaultLocked(() => {
    ownershipRef.current.invalidate();
    setVersions([]);
    setError(null);
    setLoading(false);
  });

  const loadVersionContent = useCallback(
    async (summary: NoteVersionSummary): Promise<DecryptedNoteVersion> => {
      if (!ownerId || !noteId) throw new Error("Vault is locked");
      const wrapped = summary.raw.encryptedWrappedNoteKey;
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId,
        resourceId: `note-version:${noteId}:${summary.id}`,
        encryptedKeyFingerprint: `${wrapped.version}:${wrapped.iv}:${wrapped.ciphertext}`,
      });
      const decrypted = await decryptNoteVersion(
        summary.raw.encryptedMetadata,
        summary.raw.encryptedBody,
        summary.raw.encryptedWrappedNoteKey
      );
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      return decrypted;
    },
    [noteId, ownerId]
  );

  return { versions, loading, error, reload, loadVersionContent };
}
