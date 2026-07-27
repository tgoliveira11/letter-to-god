"use client";

import { notFound } from "next/navigation";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthenticatedPage } from "@/components/layout/authenticated-page";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";
import { Alert } from "@/components/ui/alert";
import { VaultLockedState } from "@/features/vault/vault-locked-state";
import { useRequireVault } from "@/features/vault/use-require-vault";
import { useVaultClientStatus } from "@/features/vault/use-vault-client-status";
import { useVaultIndex } from "@/features/notes/use-vault-index";
import { useKanban } from "@/features/notes/use-kanban";
import { KanbanBoardList } from "@/features/kanban/board-list";
import { isKanbanEnabled } from "@/lib/notes/kanban-config";

export default function KanbanBoardsPage() {
  if (!isKanbanEnabled()) notFound();

  const router = useRouter();
  const vault = useRequireVault();
  const vaultClient = useVaultClientStatus();
  const clientStatus = vaultClient.status === "ready" ? vaultClient.clientStatus : null;
  const vaultUserId = vault.status === "ready" ? vault.userId : null;
  const vaultUnlocked = vault.status === "ready" ? vault.vaultUnlocked : false;
  const canRead = vault.status === "ready" && vaultUnlocked && clientStatus === "unlocked";
  const { index } = useVaultIndex(vaultUserId, vaultUnlocked);
  const {
    standaloneBoards,
    noteBoundBoards,
    loading,
    saving,
    error,
    loadStandaloneBoards,
    createStandaloneBoard,
  } = useKanban(vaultUserId);

  useEffect(() => {
    if (canRead) void loadStandaloneBoards().catch(() => undefined);
  }, [canRead, loadStandaloneBoards]);

  if (vault.status === "loading" || vault.status === "redirecting" || vaultClient.status === "loading") {
    return (
      <AuthenticatedPage width="notes">
        <LoadingState label="Opening boards" />
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
        <VaultLockedState variant="notes-list" returnTo="/kanban" />
      </AuthenticatedPage>
    );
  }

  return (
    <AuthenticatedPage width="notes">
      <PageHeader
        title="Boards"
        description="Standalone Kanban boards stay encrypted in your vault."
      />
      {error && (
        <Alert variant="danger" className="mb-4">
          {error}
        </Alert>
      )}
      <KanbanBoardList
        boards={standaloneBoards}
        noteBoards={noteBoundBoards}
        cachedBoards={index?.kanbanBoards ?? []}
        loading={loading || saving}
        onCreate={async (title) => {
          const board = await createStandaloneBoard(title);
          router.push(`/kanban/${board.boardId}`);
        }}
      />
    </AuthenticatedPage>
  );
}
