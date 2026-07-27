"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOnVaultLocked } from "@tgoliveira/vault-core/react";
import { notesApi } from "@/lib/api-client/notes";
import { decryptNote, type NoteMetadataPlaintext } from "@/lib/crypto-client/notes";
import { syncNoteAndBoardFromBoardChange } from "@/lib/notes/kanban-sync";
import type { KanbanBoardPlaintext } from "@/lib/notes/kanban-types";
import type { EncryptedPayload } from "@/lib/validation/encrypted-payload";
import { useApplicationState } from "@/components/application-state-provider";
import { AsyncOwnershipController, isAsyncOwnershipCancellation } from "@/lib/application-state/async-ownership";
import { assertVaultAsyncOwnershipCurrent, captureVaultAsyncOwnership } from "@/lib/application-state/vault-async-ownership";

const BOARD_TO_NOTE_DEBOUNCE_MS = 800;

export interface UseKanbanBoardToNoteSyncOptions {
  board: KanbanBoardPlaintext | null;
  enabled: boolean;
  saveBoard: (
    board: KanbanBoardPlaintext,
    wrappedKey?: EncryptedPayload | null,
    options?: { appendVersion?: boolean }
  ) => Promise<KanbanBoardPlaintext>;
  updateNote: (
    noteId: string,
    metadata: NoteMetadataPlaintext,
    body: string,
    wrappedKey: EncryptedPayload
  ) => Promise<unknown>;
  encryptedWrappedKey: EncryptedPayload | null;
}

function boardFingerprint(board: KanbanBoardPlaintext): string {
  return JSON.stringify({
    updatedAt: board.updatedAt,
    cards: board.cards.map((card) => ({
      id: card.id,
      title: card.title,
      description: card.description,
      columnId: card.columnId,
      order: card.order,
      dueDate: card.dueDate,
      priority: card.priority,
      tagNames: card.tagNames,
      source: card.source,
      statusHistory: card.statusHistory,
    })),
  });
}

/** Loads note plaintext for a note-bound board and syncs board edits back to the note. */
export function useKanbanBoardToNoteSync({
  board,
  enabled,
  saveBoard,
  updateNote,
  encryptedWrappedKey,
}: UseKanbanBoardToNoteSyncOptions) {
  const { ownerId } = useApplicationState();
  const [noteBody, setNoteBody] = useState("");
  const [noteMetadata, setNoteMetadata] = useState<NoteMetadataPlaintext | null>(null);
  const [wrappedKey, setWrappedKey] = useState<EncryptedPayload | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedBoardRef = useRef<string | null>(null);
  const syncingRef = useRef(false);
  const ownershipRef = useRef(new AsyncOwnershipController());
  const boardId = board?.boardId;
  const boardNoteId = board?.noteId;
  const boardScope = board?.scope;

  useEffect(() => {
    const controller = ownershipRef.current;
    if (!enabled || !ownerId || !boardId || boardScope !== "note" || !boardNoteId) {
      ownershipRef.current.invalidate();
      setNoteBody("");
      setNoteMetadata(null);
      setWrappedKey(null);
      return;
    }

    const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
      ownerId,
      resourceId: `kanban-note-sync:${boardId}:${boardNoteId}`,
      encryptedKeyFingerprint: encryptedWrappedKey
        ? `${encryptedWrappedKey.version}:${encryptedWrappedKey.iv}:${encryptedWrappedKey.ciphertext}`
        : null,
    });
    setNoteLoading(true);

    void (async () => {
      try {
        const row = await notesApi.get(boardNoteId);
        assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
        const decrypted = await decryptNote(
          row.encryptedMetadata,
          row.encryptedBody,
          row.encryptedWrappedNoteKey
        );
        assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
        setNoteBody(decrypted.body);
        setNoteMetadata(decrypted.metadata);
        setWrappedKey(row.encryptedWrappedNoteKey);
        lastSyncedBoardRef.current = null;
      } catch (cause) {
        if (!isAsyncOwnershipCancellation(cause)) {
          setNoteBody("");
          setNoteMetadata(null);
          setWrappedKey(null);
        }
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) setNoteLoading(false);
      }
    })();

    return () => {
      controller.invalidate();
    };
  }, [boardId, boardNoteId, boardScope, enabled, encryptedWrappedKey, ownerId]);

  const fingerprint = board ? boardFingerprint(board) : null;

  const runSync = useCallback(async () => {
    if (
      !enabled ||
      syncingRef.current ||
      !board ||
      board.scope !== "note" ||
      !board.noteId ||
      !noteMetadata ||
      !wrappedKey ||
      noteLoading
    ) {
      return;
    }
    if (lastSyncedBoardRef.current === fingerprint) return;
    if (!ownerId) return;

    const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
      ownerId,
      resourceId: `kanban-note-sync:${board.boardId}:${board.noteId}:save`,
      encryptedKeyFingerprint: wrappedKey
        ? `${wrappedKey.version}:${wrappedKey.iv}:${wrappedKey.ciphertext}`
        : null,
    });

    const result = syncNoteAndBoardFromBoardChange(board, noteBody);
    if (!result.changed) {
      lastSyncedBoardRef.current = fingerprint;
      return;
    }

    syncingRef.current = true;
    try {
      lastSyncedBoardRef.current = fingerprint;
      setNoteBody(result.body);
      await updateNote(board.noteId, noteMetadata, result.body, wrappedKey);
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      await saveBoard(result.board, encryptedWrappedKey, { appendVersion: true });
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
    } finally {
      if (ownershipRef.current.isCurrent(ownership.token)) syncingRef.current = false;
    }
  }, [
    board,
    fingerprint,
    enabled,
    encryptedWrappedKey,
    noteBody,
    noteLoading,
    noteMetadata,
    saveBoard,
    updateNote,
    wrappedKey,
    ownerId,
  ]);

  useEffect(() => {
    if (!enabled || !board || board.scope !== "note" || noteLoading || !noteMetadata) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // Mutation hooks already expose non-cancellation failures in their own UI state.
      void runSync().catch(() => undefined);
    }, BOARD_TO_NOTE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      syncingRef.current = false;
    };
  }, [fingerprint, enabled, board, noteLoading, noteMetadata, runSync]);

  useOnVaultLocked(() => {
    ownershipRef.current.invalidate();
    if (timerRef.current) clearTimeout(timerRef.current);
    syncingRef.current = false;
    setNoteBody("");
    setNoteMetadata(null);
    setWrappedKey(null);
    setNoteLoading(false);
  });

  return { noteBody, noteLoading, runSync };
}
