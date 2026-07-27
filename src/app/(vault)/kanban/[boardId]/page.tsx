"use client";

import { notFound } from "next/navigation";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AuthenticatedPage } from "@/components/layout/authenticated-page";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";
import { Alert } from "@/components/ui/alert";
import { VaultLockedState } from "@/features/vault/vault-locked-state";
import { useRequireVault } from "@/features/vault/use-require-vault";
import { useVaultClientStatus } from "@/features/vault/use-vault-client-status";
import { useKanban } from "@/features/notes/use-kanban";
import { useKanbanBoardToNoteSync } from "@/features/notes/use-kanban-board-to-note-sync";
import { useNotes } from "@/features/notes/use-notes";
import { KanbanBoard } from "@/features/kanban/board";
import { isKanbanEnabled } from "@/lib/notes/kanban-config";
import { buildNoteBodyFromBoard } from "@/lib/notes/kanban-sync";

export default function KanbanBoardPage() {
  if (!isKanbanEnabled()) notFound();

  const params = useParams();
  const boardId = params.boardId as string;
  const vault = useRequireVault();
  const vaultClient = useVaultClientStatus();
  const vaultUserId = vault.status === "ready" ? vault.userId : null;
  const vaultUnlocked = vault.status === "ready" ? vault.vaultUnlocked : false;
  const clientStatus = vaultClient.status === "ready" ? vaultClient.clientStatus : null;
  const canRead = vault.status === "ready" && vaultUnlocked && clientStatus === "unlocked";
  const { board, loading, saving, error, loadBoard, saveBoard, claimBoardForNote, encryptedWrappedKey } =
    useKanban(vaultUserId);
  const { createNote, updateNote, resolveNoteWithReflection, toggleNoteResolved, busy } =
    useNotes(vaultUserId);
  useKanbanBoardToNoteSync({
    board,
    enabled: Boolean(board?.scope === "note"),
    saveBoard,
    updateNote,
    encryptedWrappedKey,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [creatingNote, setCreatingNote] = useState(false);

  useEffect(() => {
    if (canRead) void loadBoard(boardId).catch(() => undefined);
  }, [boardId, canRead, loadBoard]);

  if (vault.status === "loading" || vault.status === "redirecting" || vaultClient.status === "loading") {
    return (
      <AuthenticatedPage width="notes">
        <LoadingState label="Opening board" />
      </AuthenticatedPage>
    );
  }

  if (vault.status === "error" || vaultClient.status === "error") {
    return (
      <AuthenticatedPage width="notes">
        <ErrorState message="We could not verify your vault status." />
      </AuthenticatedPage>
    );
  }

  if (clientStatus && clientStatus !== "unlocked") {
    return (
      <AuthenticatedPage width="notes">
        <VaultLockedState variant="read-note" returnTo={`/kanban/${boardId}`} />
      </AuthenticatedPage>
    );
  }

  if (loading || !board) {
    return (
      <AuthenticatedPage width="notes">
        <LoadingState label="Opening board" />
      </AuthenticatedPage>
    );
  }

  return (
    <AuthenticatedPage width="notes">
      {(error || actionError) && (
        <Alert variant="danger" className="mb-4">
          {error ?? actionError}
        </Alert>
      )}
      <KanbanBoard
        board={board}
        saving={saving || busy}
        userId={vaultUserId}
        encryptedWrappedKey={encryptedWrappedKey}
        onBackHref={board.scope === "note" && board.noteId ? `/notes/${board.noteId}` : "/kanban"}
        onChange={async (next, options) => {
          await saveBoard(next, undefined, options);
        }}
        onRestore={async (restored) => {
          await saveBoard(restored, undefined, { appendVersion: true });
        }}
        onResolveNote={async () => {
          if (!board.noteId) return;
          setActionError(null);
          try {
            await resolveNoteWithReflection(board.noteId, null);
          } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to resolve note");
          }
        }}
        onReopenNote={async () => {
          if (!board.noteId) return;
          setActionError(null);
          try {
            await toggleNoteResolved(board.noteId, false);
          } catch (error) {
            setActionError(error instanceof Error ? error.message : "Failed to reopen note");
          }
        }}
        onCreateNote={
          board.scope === "standalone"
            ? async () => {
                setActionError(null);
                setCreatingNote(true);
                try {
                  const note = await createNote({
                    title: board.title,
                    body: buildNoteBodyFromBoard(board),
                  });
                  await claimBoardForNote(board, note.id, note.encryptedWrappedNoteKey);
                } catch (error) {
                  setActionError(
                    error instanceof Error ? error.message : "Failed to create note from board"
                  );
                } finally {
                  setCreatingNote(false);
                }
              }
            : undefined
        }
        creatingNote={creatingNote}
      />
    </AuthenticatedPage>
  );
}
