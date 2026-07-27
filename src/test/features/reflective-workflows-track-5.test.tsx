import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import NoteDetailPage from "@/app/(vault)/notes/[id]/page";
import RemembrancePage from "@/app/(vault)/notes/remembrance/page";
import WeeklyReflectionPage from "@/app/(vault)/notes/weekly-reflection/page";
import { ResolvedReflectionDialog } from "@/components/notes/resolved-reflection-dialog";
import { NoteTimeline } from "@/components/notes/note-timeline";
import { PromptCards } from "@/components/notes/prompt-cards";
import { SavedViewsMenu } from "@/features/notes/saved-views-menu";
import { normalizeNoteMetadata } from "@/lib/notes/note-metadata";
import { USER_ID, NOTE_ID } from "@/test/helpers/fixtures";
import { generateUserVaultKey } from "@/lib/crypto-client/vault";
import {
  beginVaultOwnerOperation,
  unlockVaultSession,
} from "@/lib/crypto-client/vault-session";

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({ data: { user: { id: USER_ID } }, status: "authenticated" })),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })),
  usePathname: vi.fn(() => "/notes"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useParams: vi.fn(() => ({ id: NOTE_ID })),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/features/vault/use-require-vault", () => ({
  useRequireVault: vi.fn(),
}));

vi.mock("@/features/vault/use-vault-client-status", () => ({
  useVaultClientStatus: vi.fn(),
}));

vi.mock("@/features/notes/use-vault-index", () => ({
  useVaultIndex: vi.fn(),
}));

vi.mock("@/features/notes/use-notes", () => ({
  useNotes: vi.fn(),
}));

vi.mock("@/features/notes/use-categories-tags", () => ({
  useCategoriesTags: vi.fn(),
}));

vi.mock("@/features/notes/note-search-context", () => ({
  useNoteSearchContext: vi.fn(() => ({ query: "", setQuery: vi.fn() })),
}));

vi.mock("@/lib/api-client/notes", () => ({
  notesApi: { get: vi.fn() },
}));

vi.mock("@/lib/crypto-client/notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crypto-client/notes")>();
  return { ...actual, decryptNote: vi.fn() };
});

vi.mock("@/lib/crypto-client/vault-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crypto-client/vault-session")>();
  return {
    ...actual,
    subscribeVaultSession: vi.fn(() => () => {}),
    subscribeVaultActivityTimer: vi.fn(() => () => {}),
    getVaultAutoLockRemainingMs: vi.fn(() => 14 * 60 * 1000 + 32 * 1000),
    lockVaultSession: vi.fn(),
    lockVaultSessionManually: vi.fn(),
    registerVaultBeforeAutoLock: vi.fn(() => () => {}),
    isVaultManuallyLocked: vi.fn(() => false),
    wasVaultLockedByInactivity: vi.fn(() => false),
    registerVaultUnloadGuard: vi.fn(() => () => {}),
  };
});

vi.mock("@/features/vault/use-vault-activity", () => ({
  touchVaultActivity: vi.fn(),
}));

vi.mock("@/lib/crypto-client/note-drafts", () => ({
  loadEncryptedNoteDraft: vi.fn().mockResolvedValue(null),
  saveEncryptedNoteDraft: vi.fn(),
  deleteEncryptedNoteDraft: vi.fn(),
}));

vi.mock("@/features/notes/eager-decrypt-notes", () => ({
  getCachedNoteBody: vi.fn(() => null),
}));

import { useRequireVault } from "@/features/vault/use-require-vault";
import { useVaultClientStatus } from "@/features/vault/use-vault-client-status";
import { useVaultIndex } from "@/features/notes/use-vault-index";
import { useNotes } from "@/features/notes/use-notes";
import { useCategoriesTags } from "@/features/notes/use-categories-tags";
import { notesApi } from "@/lib/api-client/notes";
import { decryptNote } from "@/lib/crypto-client/notes";

const readyVault = {
  status: "ready" as const,
  userId: USER_ID,
  vaultUnlocked: true,
};

const unlockedClient = {
  status: "ready" as const,
  clientStatus: "unlocked" as const,
};

const metadata = normalizeNoteMetadata({
  title: "Prayer for peace",
  categoryId: null,
  tagIds: [],
  answered: false,
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-02T00:00:00.000Z",
});

describe("reflective workflows track 5", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await unlockVaultSession(
      await generateUserVaultKey(),
      "password",
      beginVaultOwnerOperation(USER_ID)
    );
    vi.mocked(useRequireVault).mockReturnValue(readyVault);
    vi.mocked(useVaultClientStatus).mockReturnValue(unlockedClient);
    vi.mocked(useVaultIndex).mockReturnValue({
      index: { version: 3, categories: [], tags: [], entries: [], savedViews: [] },
      loading: false,
      error: null,
      mutateIndex: vi.fn(),
    });
    vi.mocked(useCategoriesTags).mockReturnValue({
      categories: [],
      tags: [],
      createCategory: vi.fn(),
      createTag: vi.fn(),
    });
    vi.mocked(notesApi.get).mockResolvedValue({
      id: NOTE_ID,
      encryptedMetadata: {},
      encryptedBody: {},
      encryptedWrappedNoteKey: {},
      createdAt: metadata.createdAt,
      updatedAt: metadata.updatedAt,
    } as never);
    vi.mocked(decryptNote).mockResolvedValue({
      metadata,
      body: "Note body",
    });
  });

  describe("ResolvedReflectionDialog", () => {
    it("renders three actions", () => {
      render(
        <ResolvedReflectionDialog
          open
          onSaveAndResolve={vi.fn()}
          onResolveWithoutReflection={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      expect(screen.getByTestId("save-reflection-resolve")).toBeInTheDocument();
      expect(screen.getByTestId("resolve-without-reflection")).toBeInTheDocument();
      expect(screen.getByTestId("cancel-resolve")).toBeInTheDocument();
    });

    it("disables save until reflection content exists", async () => {
      const onSave = vi.fn();
      render(
        <ResolvedReflectionDialog
          open
          onSaveAndResolve={onSave}
          onResolveWithoutReflection={vi.fn()}
          onCancel={vi.fn()}
        />
      );
      expect(screen.getByTestId("save-reflection-resolve")).toBeDisabled();
      fireEvent.change(screen.getByTestId("reflection-what-changed"), {
        target: { value: "Shifted" },
      });
      fireEvent.click(screen.getByTestId("save-reflection-resolve"));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ whatChanged: "Shifted" })
      );
    });
  });

  describe("NoteTimeline", () => {
    it("expands on toggle", async () => {
      const withEvents = normalizeNoteMetadata({
        ...metadata,
        lifecycleEvents: [
          { id: "e1", type: "created", occurredAt: "2026-06-01T00:00:00.000Z" },
          { id: "e2", type: "resolved", occurredAt: "2026-06-03T00:00:00.000Z" },
        ],
      });
      render(<NoteTimeline metadata={withEvents} />);
      expect(screen.queryByTestId("note-timeline-list")).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("note-timeline-toggle"));
      expect(screen.getByTestId("note-timeline-list")).toBeInTheDocument();
      expect(screen.getByTestId("timeline-event-resolved")).toBeInTheDocument();
    });
  });

  describe("PromptCards", () => {
    it("inserts markdown on prompt click", () => {
      const onInsert = vi.fn();
      render(<PromptCards context="new-note" onInsert={onInsert} />);
      const first = screen.getByTestId("prompt-cards-new-note").querySelector("button");
      expect(first).toBeTruthy();
      fireEvent.click(first!);
      expect(onInsert).toHaveBeenCalledWith(expect.stringMatching(/^## /));
    });
  });

  describe("SavedViewsMenu navigation", () => {
    it("links to remembrance and weekly reflection", async () => {
      render(
        <SavedViewsMenu
          views={[]}
          activeViewId={null}
          currentCriteria={{ smartFilter: "all-active" }}
          onApply={vi.fn()}
          onSave={vi.fn()}
          onDelete={vi.fn()}
          onRecentlyViewed={vi.fn()}
        />
      );
      fireEvent.click(screen.getByTestId("saved-views-menu"));
      await waitFor(() => expect(screen.getByTestId("view-remembrance")).toBeInTheDocument());
      expect(screen.getByTestId("view-remembrance")).toHaveAttribute("href", "/notes/remembrance");
      expect(screen.getByTestId("view-weekly-reflection")).toHaveAttribute(
        "href",
        "/notes/weekly-reflection"
      );
    });
  });

  describe("Note detail resolve flow", () => {
    it("opens reflection dialog when marking resolved", async () => {
      vi.mocked(useNotes).mockReturnValue({
        updateNote: vi.fn(),
        moveNoteToTrash: vi.fn(),
        restoreNoteFromTrash: vi.fn(),
        permanentlyDeleteNote: vi.fn(),
        toggleNoteResolved: vi.fn(),
        resolveNoteWithReflection: vi.fn(),
        toggleNotePinned: vi.fn(),
        toggleNoteFavorite: vi.fn(),
        toggleNoteArchived: vi.fn(),
        duplicateNote: vi.fn(),
        busy: false,
        error: null,
      } as never);

      render(<NoteDetailPage />);
      await waitFor(() => expect(screen.getByTestId("note-reading-view")).toBeInTheDocument());
      const resolveButton = screen.getByTestId("note-mark-resolved-button");
      fireEvent.click(resolveButton);
      expect(screen.getByTestId("resolved-reflection-dialog")).toBeInTheDocument();
    });
  });

  describe("Remembrance locked state", () => {
    it("shows vault protected message when locked", () => {
      vi.mocked(useVaultClientStatus).mockReturnValue({
        status: "ready",
        clientStatus: "locked",
      } as never);
      render(<RemembrancePage />);
      expect(screen.getByText(/Remembrance/i)).toBeInTheDocument();
    });
  });

  describe("Weekly reflection page", () => {
    it("renders sections when unlocked", async () => {
      vi.mocked(useVaultIndex).mockReturnValue({
        index: {
          version: 3,
          categories: [],
          tags: [],
          entries: [
            {
              id: "n1",
              title: "This week",
              categoryId: null,
              tagIds: [],
              answered: false,
              pinned: false,
              favorite: false,
              archived: false,
              trashed: false,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
          savedViews: [],
        },
        loading: false,
        error: null,
        mutateIndex: vi.fn(),
      });
      vi.mocked(useNotes).mockReturnValue({
        createNote: vi.fn(),
        busy: false,
        error: null,
      } as never);

      render(<WeeklyReflectionPage />);
      await waitFor(() =>
        expect(screen.getByTestId("weekly-section-notes-created-this-week")).toBeInTheDocument()
      );
      expect(screen.getByTestId("create-weekly-reflection-note")).toBeInTheDocument();
    });
  });
});
