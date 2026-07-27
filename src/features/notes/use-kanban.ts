"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useOnVaultLocked } from "@tgoliveira/vault-core/react";
import { kanbanApi, type KanbanBoardResponse, type KanbanBoardVersionResponse } from "@/lib/api-client/kanban";
import { vaultApi } from "@/lib/api-client/vault";
import { createCoalescedTaskQueue } from "@/lib/async/coalesced-task-queue";
import {
  decryptKanbanBoard,
  decryptKanbanVersion,
  encryptKanbanBoard,
  encryptKanbanVersion,
  generateBoardKey,
  wrapBoardKey,
} from "@/lib/crypto-client/kanban";
import {
  createEmptyVaultIndex,
  decryptVaultIndex,
  encryptVaultIndex,
  removeStandaloneKanbanBoardIndexEntry,
  updateVaultIndexEntry,
  upsertStandaloneKanbanBoardIndexEntry,
} from "@/lib/crypto-client/vault-index";
import {
  createKanbanBoardFromNote,
  createStandaloneKanbanBoard,
} from "@/lib/notes/kanban-from-note";
import { syncBoardFromNoteBody } from "@/lib/notes/kanban-sync";
import { getKanbanProgress } from "@/lib/notes/kanban-progress";
import type { KanbanBoardPlaintext } from "@/lib/notes/kanban-types";
import type { EncryptedPayload } from "@/lib/validation/encrypted-payload";
import { AsyncOwnershipController, isAsyncOwnershipCancellation } from "@/lib/application-state/async-ownership";
import { assertVaultAsyncOwnershipCurrent, captureVaultAsyncOwnership } from "@/lib/application-state/vault-async-ownership";
import { useApplicationState } from "@/components/application-state-provider";

type AssertCurrent = () => void;

async function syncVaultIndex(
  userId: string,
  vaultKey: CryptoKey,
  mutate: (index: ReturnType<typeof createEmptyVaultIndex>) => ReturnType<typeof createEmptyVaultIndex>,
  assertCurrent: AssertCurrent
) {
  const { encryptedVaultIndex } = await vaultApi.getIndex();
  assertCurrent();
  const current = encryptedVaultIndex
    ? await decryptVaultIndex(encryptedVaultIndex, userId, vaultKey)
    : createEmptyVaultIndex();
  assertCurrent();
  const next = mutate(current);
  const encrypted = await encryptVaultIndex(next, userId, vaultKey);
  assertCurrent();
  await vaultApi.updateIndex(encrypted);
  assertCurrent();
}

function indexPatchForBoard(board: KanbanBoardPlaintext) {
  const progress = getKanbanProgress(board);
  return {
    hasKanban: true,
    kanbanTotal: progress.total,
    kanbanDone: progress.done,
    updatedAt: board.updatedAt,
  };
}

async function appendKanbanVersionSnapshot(
  userId: string,
  board: KanbanBoardPlaintext,
  encryptedWrappedKey: EncryptedPayload,
  assertCurrent: AssertCurrent
): Promise<boolean> {
  try {
    const versionId = crypto.randomUUID();
    const payload = await encryptKanbanVersion(
      userId,
      versionId,
      board,
      encryptedWrappedKey
    );
    assertCurrent();
    await kanbanApi.createVersion(board.boardId, payload);
    assertCurrent();
    return true;
  } catch (cause) {
    if (isAsyncOwnershipCancellation(cause)) throw cause;
    return false;
  }
}

export interface UseKanbanState {
  board: KanbanBoardPlaintext | null;
  encryptedWrappedKey: EncryptedPayload | null;
  response: KanbanBoardResponse | null;
  standaloneBoards: KanbanBoardPlaintext[];
  noteBoundBoards: KanbanBoardPlaintext[];
  loading: boolean;
  saving: boolean;
  error: string | null;
}

export function useKanban(userId: string | null) {
  const [state, setState] = useState<UseKanbanState>({
    board: null,
    encryptedWrappedKey: null,
    response: null,
    standaloneBoards: [],
    noteBoundBoards: [],
    loading: false,
    saving: false,
    error: null,
  });
  const encryptedWrappedKeyRef = useRef<EncryptedPayload | null>(null);
  const ownershipRef = useRef(new AsyncOwnershipController());
  encryptedWrappedKeyRef.current = state.encryptedWrappedKey;

  const persistBoardRef = useRef<
    (job: {
      board: KanbanBoardPlaintext;
      encryptedWrappedKey: EncryptedPayload;
      options: { appendVersion?: boolean };
    }) => Promise<void>
  >(() => Promise.resolve());

  persistBoardRef.current = async ({ board, encryptedWrappedKey, options }) => {
    if (!userId) throw new Error("Not authenticated");
    const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
      ownerId: userId,
      resourceId: `kanban:${board.boardId}`,
      encryptedKeyFingerprint: `${encryptedWrappedKey.version}:${encryptedWrappedKey.iv}:${encryptedWrappedKey.ciphertext}`,
    });
    const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
    setState((current) => ({ ...current, saving: true, error: null }));
    try {
      const payload = await encryptKanbanBoard(userId, board.boardId, board, encryptedWrappedKey);
      assertCurrent();
      const row = await kanbanApi.update(board.boardId, payload);
      assertCurrent();
      if (options.appendVersion) {
        await appendKanbanVersionSnapshot(userId, board, encryptedWrappedKey, assertCurrent);
      }
      if (board.scope === "note" && board.noteId) {
        await syncVaultIndex(
          userId,
          ownership.lease.vaultKey,
          (index) => updateVaultIndexEntry(index, board.noteId!, indexPatchForBoard(board)),
          assertCurrent
        );
      } else {
        const progress = getKanbanProgress(board);
        await syncVaultIndex(
          userId,
          ownership.lease.vaultKey,
          (index) =>
            upsertStandaloneKanbanBoardIndexEntry(index, {
              id: board.boardId,
              title: board.title,
              total: progress.total,
              done: progress.done,
              updatedAt: board.updatedAt,
            }),
          assertCurrent
        );
      }
      assertCurrent();
      setState((current) => ({
        ...current,
        board,
        encryptedWrappedKey,
        response: row,
        standaloneBoards:
          board.scope === "standalone"
            ? [board, ...current.standaloneBoards.filter((item) => item.boardId !== board.boardId)]
            : current.standaloneBoards,
        noteBoundBoards:
          board.scope === "note"
            ? [board, ...current.noteBoundBoards.filter((item) => item.boardId !== board.boardId)]
            : current.noteBoundBoards,
      }));
    } catch (error) {
      if (!isAsyncOwnershipCancellation(error)) {
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Failed to save board",
        }));
      }
      throw error;
    } finally {
      if (ownershipRef.current.isCurrent(ownership.token)) {
        setState((current) => ({ ...current, saving: false }));
      }
    }
  };

  const enqueueBoardSaveRef = useRef(
    createCoalescedTaskQueue<{
      board: KanbanBoardPlaintext;
      encryptedWrappedKey: EncryptedPayload;
      options: { appendVersion?: boolean };
    }>((job) => persistBoardRef.current(job))
  );

  useOnVaultLocked(() => {
    ownershipRef.current.invalidate();
    setState((current) => ({
      ...current,
      board: null,
      encryptedWrappedKey: null,
      response: null,
      standaloneBoards: [],
      noteBoundBoards: [],
      loading: false,
      saving: false,
      error: null,
    }));
  });

  async function decryptBoardRows(
    rows: KanbanBoardResponse[],
    assertCurrent: AssertCurrent
  ): Promise<KanbanBoardPlaintext[]> {
    const results = await Promise.allSettled(
      rows.map((row) => decryptKanbanBoard(row.encryptedBoard, row.encryptedWrappedKey))
    );
    assertCurrent();
    const boards: KanbanBoardPlaintext[] = [];
    for (const result of results) {
      if (result.status === "fulfilled") {
        boards.push(result.value);
      }
    }
    return boards;
  }

  const hydrateBoard = useCallback(async (row: KanbanBoardResponse, assertCurrent: AssertCurrent) => {
    const board = await decryptKanbanBoard(row.encryptedBoard, row.encryptedWrappedKey);
    assertCurrent();
    setState((current) => ({
      ...current,
      board,
      encryptedWrappedKey: row.encryptedWrappedKey,
      response: row,
    }));
    return board;
  }, []);

  const loadBoard = useCallback(
    async (boardId: string) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `kanban:${boardId}`,
      });
      const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        const row = await kanbanApi.get(boardId);
        assertCurrent();
        return await hydrateBoard(row, assertCurrent);
      } catch (error) {
        if (!isAsyncOwnershipCancellation(error)) {
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : "Failed to load board",
          }));
        }
        throw error;
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) {
          setState((current) => ({ ...current, loading: false }));
        }
      }
    },
    [hydrateBoard, userId]
  );

  const loadBoardForNote = useCallback(
    async (noteId: string) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `kanban:note:${noteId}`,
      });
      const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setState((current) => ({ ...current, loading: true, error: null }));
      try {
        const rows = await kanbanApi.list({ noteId });
        assertCurrent();
        if (rows.length === 0) {
          setState((current) => ({
            ...current,
            board: null,
            encryptedWrappedKey: null,
            response: null,
          }));
          return null;
        }
        return await hydrateBoard(rows[0], assertCurrent);
      } catch (error) {
        if (!isAsyncOwnershipCancellation(error)) {
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : "Failed to load board",
          }));
        }
        throw error;
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) {
          setState((current) => ({ ...current, loading: false }));
        }
      }
    },
    [hydrateBoard, userId]
  );

  const loadStandaloneBoards = useCallback(async () => {
    if (!userId) throw new Error("Not authenticated");
    const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
      ownerId: userId,
      resourceId: "kanban:list",
    });
    const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const rows = await kanbanApi.list();
      assertCurrent();
      const boards = await decryptBoardRows(rows, assertCurrent);
      const standaloneBoards = boards.filter((board) => board.scope === "standalone");
      const noteBoundBoards = boards.filter((board) => board.scope === "note");
      setState((current) => ({ ...current, standaloneBoards, noteBoundBoards }));
      return standaloneBoards;
    } catch (error) {
      if (!isAsyncOwnershipCancellation(error)) {
        setState((current) => ({
          ...current,
          error: error instanceof Error ? error.message : "Failed to load boards",
        }));
      }
      throw error;
    } finally {
      if (ownershipRef.current.isCurrent(ownership.token)) {
        setState((current) => ({ ...current, loading: false }));
      }
    }
  }, [userId]);

  const saveBoard = useCallback(
    async (
      board: KanbanBoardPlaintext,
      encryptedWrappedKey = encryptedWrappedKeyRef.current,
      options: { appendVersion?: boolean } = {}
    ) => {
      if (!userId) throw new Error("Not authenticated");
      if (!encryptedWrappedKey) throw new Error("Board key is unavailable");
      await enqueueBoardSaveRef.current({
        board,
        encryptedWrappedKey,
        options,
      });
      return board;
    },
    [userId]
  );

  const createNoteBoard = useCallback(
    async (
      noteId: string,
      noteTitle: string,
      body: string,
      encryptedWrappedNoteKey: EncryptedPayload
    ) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `kanban:note:${noteId}:create`,
      });
      const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setState((current) => ({ ...current, saving: true, error: null }));
      try {
        const board = createKanbanBoardFromNote(noteId, noteTitle, body);
        const payload = await encryptKanbanBoard(
          userId,
          board.boardId,
          board,
          encryptedWrappedNoteKey
        );
        assertCurrent();
        const row = await kanbanApi.create({ ...payload, noteId });
        assertCurrent();
        await appendKanbanVersionSnapshot(userId, board, encryptedWrappedNoteKey, assertCurrent);
        await syncVaultIndex(
          userId,
          ownership.lease.vaultKey,
          (index) => updateVaultIndexEntry(index, noteId, indexPatchForBoard(board)),
          assertCurrent
        );
        setState((current) => ({
          ...current,
          board,
          encryptedWrappedKey: encryptedWrappedNoteKey,
          response: row,
          noteBoundBoards: [board, ...current.noteBoundBoards.filter((item) => item.boardId !== board.boardId)],
        }));
        return board;
      } catch (error) {
        if (!isAsyncOwnershipCancellation(error)) {
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : "Failed to create board",
          }));
        }
        throw error;
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) {
          setState((current) => ({ ...current, saving: false }));
        }
      }
    },
    [userId]
  );

  const createStandaloneBoard = useCallback(
    async (title: string) => {
      if (!userId) throw new Error("Not authenticated");
      const boardId = crypto.randomUUID();
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `kanban:${boardId}:create`,
      });
      const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setState((current) => ({ ...current, saving: true, error: null }));
      try {
        const board = { ...createStandaloneKanbanBoard(title), boardId };
        const boardKey = await generateBoardKey();
        assertCurrent();
        const wrappedKey = await wrapBoardKey(userId, board.boardId, boardKey);
        assertCurrent();
        const payload = await encryptKanbanBoard(userId, board.boardId, board, wrappedKey);
        assertCurrent();
        const row = await kanbanApi.create({ ...payload, noteId: null });
        assertCurrent();
        await appendKanbanVersionSnapshot(userId, board, wrappedKey, assertCurrent);
        await syncVaultIndex(
          userId,
          ownership.lease.vaultKey,
          (index) =>
            upsertStandaloneKanbanBoardIndexEntry(index, {
              id: board.boardId,
              title: board.title,
              total: 0,
              done: 0,
              updatedAt: board.updatedAt,
            }),
          assertCurrent
        );
        setState((current) => ({
          ...current,
          board,
          encryptedWrappedKey: wrappedKey,
          response: row,
          standaloneBoards: [board, ...current.standaloneBoards],
          noteBoundBoards: current.noteBoundBoards,
        }));
        return board;
      } catch (error) {
        if (!isAsyncOwnershipCancellation(error)) {
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : "Failed to create board",
          }));
        }
        throw error;
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) {
          setState((current) => ({ ...current, saving: false }));
        }
      }
    },
    [userId]
  );

  const regenerateFromNote = useCallback(
    async (body: string) => {
      if (!state.board) throw new Error("No board loaded");
      const result = syncBoardFromNoteBody(state.board, body);
      await saveBoard(result.board, state.encryptedWrappedKey, {
        appendVersion: result.added > 0 || result.removed > 0,
      });
      return { board: result.board, added: result.added, removed: result.removed };
    },
    [saveBoard, state.board, state.encryptedWrappedKey]
  );

  const claimBoardForNote = useCallback(
    async (
      board: KanbanBoardPlaintext,
      noteId: string,
      encryptedWrappedNoteKey: EncryptedPayload
    ) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `kanban:${board.boardId}:claim:${noteId}`,
      });
      const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setState((current) => ({ ...current, saving: true, error: null }));
      try {
        const nextBoard: KanbanBoardPlaintext = { ...board, scope: "note", noteId };
        const payload = await encryptKanbanBoard(userId, board.boardId, nextBoard, encryptedWrappedNoteKey);
        assertCurrent();
        const row = await kanbanApi.update(board.boardId, { ...payload, claimNoteId: noteId });
        assertCurrent();
        await appendKanbanVersionSnapshot(userId, nextBoard, encryptedWrappedNoteKey, assertCurrent);
        await syncVaultIndex(
          userId,
          ownership.lease.vaultKey,
          (index) =>
            updateVaultIndexEntry(
              removeStandaloneKanbanBoardIndexEntry(index, board.boardId),
              noteId,
              indexPatchForBoard(nextBoard)
            ),
          assertCurrent
        );
        setState((current) => ({
          ...current,
          board: nextBoard,
          encryptedWrappedKey: encryptedWrappedNoteKey,
          response: row,
          standaloneBoards: current.standaloneBoards.filter((item) => item.boardId !== board.boardId),
          noteBoundBoards: [
            nextBoard,
            ...current.noteBoundBoards.filter((item) => item.boardId !== board.boardId),
          ],
        }));
        return nextBoard;
      } catch (error) {
        if (!isAsyncOwnershipCancellation(error)) {
          setState((current) => ({
            ...current,
            error: error instanceof Error ? error.message : "Failed to link board to note",
          }));
        }
        throw error;
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) {
          setState((current) => ({ ...current, saving: false }));
        }
      }
    },
    [userId]
  );

  const deleteBoard = useCallback(
    async (board: KanbanBoardPlaintext) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `kanban:${board.boardId}:delete`,
      });
      const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      await kanbanApi.delete(board.boardId);
      assertCurrent();
      if (board.scope === "standalone") {
        await syncVaultIndex(
          userId,
          ownership.lease.vaultKey,
          (index) => removeStandaloneKanbanBoardIndexEntry(index, board.boardId),
          assertCurrent
        );
      }
      assertCurrent();
      setState((current) => ({
        ...current,
        board: current.board?.boardId === board.boardId ? null : current.board,
        standaloneBoards: current.standaloneBoards.filter((item) => item.boardId !== board.boardId),
        noteBoundBoards: current.noteBoundBoards.filter((item) => item.boardId !== board.boardId),
      }));
    },
    [userId]
  );

  return {
    ...state,
    loadBoard,
    loadBoardForNote,
    loadStandaloneBoards,
    createNoteBoard,
    createStandaloneBoard,
    saveBoard,
    regenerateFromNote,
    claimBoardForNote,
    deleteBoard,
  };
}

export function useKanbanVersions(boardId: string | null, enabled: boolean) {
  const { ownerId } = useApplicationState();
  const [versions, setVersions] = useState<KanbanBoardVersionResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownershipRef = useRef(new AsyncOwnershipController());

  const reload = useCallback(async () => {
    if (!boardId || !enabled || !ownerId) return;
    const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
      ownerId,
      resourceId: `kanban:${boardId}:versions`,
    });
    setLoading(true);
    setError(null);
    try {
      const rows = await kanbanApi.listVersions(boardId);
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setVersions(rows);
    } catch (cause) {
      if (!isAsyncOwnershipCancellation(cause)) {
        setError(cause instanceof Error ? cause.message : "Failed to load board history");
      }
    } finally {
      if (ownershipRef.current.isCurrent(ownership.token)) setLoading(false);
    }
  }, [boardId, enabled, ownerId]);

  useEffect(() => {
    if (!enabled) {
      ownershipRef.current.invalidate();
      setVersions([]);
      return;
    }
    void reload();
  }, [enabled, reload]);

  const loadVersionContent = useCallback(
    async (version: KanbanBoardVersionResponse): Promise<KanbanBoardPlaintext> => {
      if (!ownerId || !boardId) throw new Error("Board ownership is unavailable");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId,
        resourceId: `kanban:${boardId}:version:${version.id}`,
        encryptedKeyFingerprint: `${version.encryptedWrappedKey.version}:${version.encryptedWrappedKey.iv}:${version.encryptedWrappedKey.ciphertext}`,
      });
      const board = await decryptKanbanVersion(
        version.encryptedBoard,
        version.encryptedWrappedKey
      );
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      return board;
    },
    [boardId, ownerId]
  );

  useOnVaultLocked(() => {
    ownershipRef.current.invalidate();
    setVersions([]);
    setLoading(false);
    setError(null);
  });

  return { versions, loading, error, reload, loadVersionContent };
}
