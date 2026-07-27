import {
  beginVaultOwnerOperation,
  lockVaultSession,
  unlockVaultSession,
} from "@/lib/crypto-client/vault-session";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import userEvent from "@testing-library/user-event";
import NotesPage from "@/app/(vault)/notes/page";
import NewNotePage from "@/app/(vault)/notes/new/page";
import NoteDetailPage from "@/app/(vault)/notes/[id]/page";
import { TagChipInput } from "@/features/notes/tag-chip-input";
import { NoteCategoryLabel, NoteTagChip } from "@/components/notes/note-labels";
import { hasNoteOrganizers, NoteFilters } from "@/features/notes/note-filters";
import { encryptNote } from "@/lib/crypto-client/notes";import { generateUserVaultKey } from "@/lib/crypto-client/vault";
import { USER_ID, NOTE_ID } from "@/test/helpers/fixtures";

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({ data: { user: { id: USER_ID } }, status: "authenticated" })),
}));

const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: routerPush, replace: vi.fn(), back: vi.fn() })),
  usePathname: vi.fn(() => "/notes"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useParams: vi.fn(() => ({ id: NOTE_ID })),
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

vi.mock("@/lib/api-client/notes", () => ({
  notesApi: {
    get: vi.fn(),
  },
}));

vi.mock("@/lib/api-client/note-versions", () => ({
  noteVersionsApi: { list: vi.fn().mockResolvedValue([]), get: vi.fn(), create: vi.fn() },
}));

vi.mock("@/lib/crypto-client/notes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crypto-client/notes")>();
  return {
    ...actual,
    decryptNote: vi.fn(),
  };
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
  useVaultActivity: vi.fn(),
  touchVaultActivity: vi.fn(),
}));

vi.mock("@/lib/crypto-client/note-drafts", () => ({
  NEW_NOTE_DRAFT_KEY: "new",
  loadEncryptedNoteDraft: vi.fn().mockResolvedValue(null),
  saveEncryptedNoteDraft: vi.fn().mockResolvedValue(undefined),
  deleteEncryptedNoteDraft: vi.fn().mockResolvedValue(undefined),
  listEncryptedNoteDraftKeys: vi.fn().mockResolvedValue([]),
}));

const sampleIndex = {
  version: 3 as const,
  categories: [{ id: "c1", name: "Personal", createdAt: "", updatedAt: "" }],
  tags: [{ id: "t1", name: "faith", createdAt: "", updatedAt: "" }],
  savedViews: [],
  entries: [
    {
      id: "note-1",
      title: "Morning prayer",
      categoryId: "c1",
      tagIds: ["t1"],
      answered: false,
      pinned: false,
      favorite: false,
      archived: false,
      trashed: false,
      trashedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

function mockVaultReady(unlocked: boolean) {
  return {
    status: "ready" as const,
    userId: USER_ID,
    vaultUnlocked: unlocked,
    recheckVault: vi.fn(),
  };
}

function mockClientStatus(
  clientStatus: "not_configured" | "setup_incomplete" | "locked" | "unlocked"
) {
  const setupPhase =
    clientStatus === "not_configured"
      ? ("not_configured" as const)
      : clientStatus === "setup_incomplete"
        ? ("setup_incomplete" as const)
        : ("complete" as const);

  return {
    status: "ready" as const,
    clientStatus,
    setupPhase,
    serverStatus: {
      initialized: clientStatus !== "not_configured",
      setupPhase,
    },
    recheck: vi.fn(),
  };
}

function switchEditorToMarkdownMode() {
  fireEvent.click(screen.getByTestId("editor-mode-markdown"));
}

function setNoteBody(value: string) {
  switchEditorToMarkdownMode();
  fireEvent.change(screen.getByTestId("markdown-expert-textarea"), { target: { value } });
}

describe("notes UX", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await unlockVaultSession(
      await generateUserVaultKey(),
      "password",
      beginVaultOwnerOperation(USER_ID)
    );

    const { useRequireVault } = await import("@/features/vault/use-require-vault");
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    const { useVaultIndex } = await import("@/features/notes/use-vault-index");
    const { useNotes } = await import("@/features/notes/use-notes");
    const { useCategoriesTags } = await import("@/features/notes/use-categories-tags");

    vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(true));
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("unlocked"));
    vi.mocked(useVaultIndex).mockReturnValue({
      index: sampleIndex,
      loading: false,
      error: null,
      mutateIndex: vi.fn(),
      reload: vi.fn(),
      persistIndex: vi.fn(),
    });
    vi.mocked(useNotes).mockReturnValue({
      createNote: vi.fn(),
      updateNote: vi.fn(),
      deleteNote: vi.fn(),
      moveNoteToTrash: vi.fn(),
      restoreNoteFromTrash: vi.fn(),
      permanentlyDeleteNote: vi.fn(),
      toggleNoteResolved: vi.fn(),
      toggleNotePinned: vi.fn(),
      toggleNoteFavorite: vi.fn(),
      toggleNoteArchived: vi.fn(),
      duplicateNote: vi.fn(),
      busy: false,
      error: null,
    });
    vi.mocked(useCategoriesTags).mockReturnValue({
      categories: sampleIndex.categories,
      tags: sampleIndex.tags,
      loading: false,
      error: null,
      createCategory: vi.fn(),
      renameCategory: vi.fn(),
      removeCategory: vi.fn(),
      createTag: vi.fn(async (name: string) => ({
        id: `tag-${name}`,
        name,
        createdAt: "",
        updatedAt: "",
      })),
      renameTag: vi.fn(),
      removeTag: vi.fn(),
    });
  });

  describe("/notes search and vault UI", () => {
    it("always shows the search bar and counter (simplified header)", async () => {
      const { useVaultIndex } = await import("@/features/notes/use-vault-index");
      vi.mocked(useVaultIndex).mockReturnValue({
        index: { ...sampleIndex, categories: [], tags: [], entries: [] },
        loading: false,
        error: null,
        mutateIndex: vi.fn(),
      });

      render(<NotesPage />);
      expect(await screen.findByText("Notes")).toBeTruthy();
      expect(screen.getByTestId("note-search")).toBeTruthy();
      expect(screen.getByTestId("notes-counter")).toBeTruthy();
    });

    it("shows search/filter when at least one category exists", async () => {
      const { useVaultIndex } = await import("@/features/notes/use-vault-index");
      vi.mocked(useVaultIndex).mockReturnValue({
        index: { ...sampleIndex, tags: [] },
        loading: false,
        error: null,
        mutateIndex: vi.fn(),
      });

      render(<NotesPage />);
      expect(await screen.findByLabelText(/search/i)).toBeTruthy();
    });

    it("shows search/filter when at least one tag exists", async () => {
      const { useVaultIndex } = await import("@/features/notes/use-vault-index");
      vi.mocked(useVaultIndex).mockReturnValue({
        index: { ...sampleIndex, categories: [] },
        loading: false,
        error: null,
        mutateIndex: vi.fn(),
      });

      render(<NotesPage />);
      expect(await screen.findByLabelText(/search/i)).toBeTruthy();
    });

    it("renders notes shell when vault is locked (overlay handled by layout gate)", async () => {
      const replace = vi.fn();
      const { useRouter } = await import("next/navigation");
      vi.mocked(useRouter).mockReturnValue({ push: vi.fn(), replace, back: vi.fn() });
      const { useRequireVault } = await import("@/features/vault/use-require-vault");
      const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
      vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(false));
      vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("locked"));

      render(<NotesPage />);
      expect(await screen.findByRole("heading", { name: /^notes$/i })).toBeTruthy();
      expect(replace).not.toHaveBeenCalled();
      expect(screen.queryByTestId("notes-vault-locked-state")).toBeNull();
    });

    it("does not show page-level vault open indicator when unlocked", async () => {
      render(<NotesPage />);
      expect((await screen.findAllByTestId("new-note-action")).length).toBeGreaterThan(0);
      expect(screen.queryByTestId("notes-vault-indicator")).toBeNull();
      expect(screen.queryByText("Vault open")).toBeNull();
    });

    it("shows notes counter", async () => {
      render(<NotesPage />);
      expect(await screen.findByTestId("notes-counter")).toHaveTextContent("1 note");
    });

    it("shows filtered notes counter", async () => {
      const { useVaultIndex } = await import("@/features/notes/use-vault-index");
      vi.mocked(useVaultIndex).mockReturnValue({
        index: {
          ...sampleIndex,
          entries: [
            ...sampleIndex.entries,
            {
              id: "note-2",
              title: "Evening",
              categoryId: null,
              tagIds: [],
              answered: true,
              createdAt: "2026-01-02T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
            },
          ],
        },
        loading: false,
        error: null,
        mutateIndex: vi.fn(),
        reload: vi.fn(),
        persistIndex: vi.fn(),
      });

      render(<NotesPage />);
      expect(await screen.findByTestId("notes-counter")).toHaveTextContent("2 notes");
    });

    it("shows resolve quick action on note cards", async () => {
      render(<NotesPage />);
      expect(await screen.findByLabelText(/mark as resolved/i)).toBeTruthy();
    });

    it("calls toggleNoteResolved when resolve action is clicked", async () => {
      const { useNotes } = await import("@/features/notes/use-notes");
      const { useVaultIndex } = await import("@/features/notes/use-vault-index");
      const toggleNoteResolved = vi.fn().mockResolvedValue({});
      const mutateIndex = vi.fn().mockImplementation(async (fn) => fn(sampleIndex));
      vi.mocked(useNotes).mockReturnValue({
        createNote: vi.fn(),
        updateNote: vi.fn(),
        deleteNote: vi.fn(),
        toggleNoteResolved,
        busy: false,
        error: null,
      });
      vi.mocked(useVaultIndex).mockReturnValue({
        index: sampleIndex,
        loading: false,
        error: null,
        mutateIndex,
        reload: vi.fn(),
        persistIndex: vi.fn(),
      });

      render(<NotesPage />);
      fireEvent.click(await screen.findByLabelText(/mark as resolved/i));
      await waitFor(() => expect(toggleNoteResolved).toHaveBeenCalledWith("note-1", true));
    });

    it("shows the updated date on note cards", async () => {
      render(<NotesPage />);
      const title = await screen.findByText("Morning prayer");
      const card = title.closest("a");
      // Per the Stillness hero spec, the card footer shows the updated date;
      // the created date lives on the note detail page.
      expect(card?.textContent).toMatch(/Updated/);
    });

    it("shows unresolved indicator on open notes in card mode", async () => {
      render(<NotesPage />);
      expect(await screen.findByTestId("note-unresolved-indicator")).toBeTruthy();
    });

    it("routes no-vault state to /vault/setup", async () => {
      const { useRequireVault } = await import("@/features/vault/use-require-vault");
      const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
      vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(false));
      vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("not_configured"));

      render(<NotesPage />);
      expect(screen.getByRole("link", { name: /set up your vault/i }).getAttribute("href")).toBe(
        "/vault/setup"
      );
    });
  });

  describe("/notes/new", () => {
    it("requires a title before saving", async () => {
      render(<NewNotePage />);
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "" } });
      setNoteBody("Body");
      const saveButton = screen.getByTestId("note-editor-save-primary");
      expect(saveButton).toBeDisabled();
      expect(saveButton.getAttribute("title")).toMatch(/add a title before saving/i);
    });

    it("rejects whitespace-only titles", () => {
      render(<NewNotePage />);
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "   " } });
      setNoteBody("Body");
      const saveButton = screen.getByTestId("note-editor-save-primary");
      expect(saveButton).toBeDisabled();
    });

    it("allows save with a valid title", async () => {
      const { useNotes } = await import("@/features/notes/use-notes");
      const createNote = vi.fn().mockResolvedValue({ id: NOTE_ID });
      vi.mocked(useNotes).mockReturnValue({
        createNote,
        updateNote: vi.fn(),
        deleteNote: vi.fn(),
        toggleNoteResolved: vi.fn(),
        busy: false,
        error: null,
      });

      render(<NewNotePage />);
      fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Morning" } });
      setNoteBody("Body");
      fireEvent.click(screen.getByTestId("note-editor-save-primary"));

      await waitFor(() => {
        expect(createNote).toHaveBeenCalledWith(
          expect.objectContaining({ title: "Morning", answered: false })
        );
      });
    });

    it("shows create-category field when no user categories exist on blank note", async () => {
      const { useCategoriesTags } = await import("@/features/notes/use-categories-tags");
      vi.mocked(useCategoriesTags).mockReturnValue({
        categories: [],
        tags: sampleIndex.tags,
        loading: false,
        error: null,
        createCategory: vi.fn(),
        renameCategory: vi.fn(),
        removeCategory: vi.fn(),
        createTag: vi.fn(),
        renameTag: vi.fn(),
        removeTag: vi.fn(),
      });

      render(<NewNotePage />);
      expect(screen.getByPlaceholderText(/new category name/i)).toBeTruthy();
      expect(screen.queryByRole("combobox", { name: /^category$/i })).toBeNull();
    });

    it("shows category dropdown for user-created categories on blank note", async () => {
      render(<NewNotePage />);
      const select = screen.getByRole("combobox", { name: /^category$/i }) as HTMLSelectElement;
      expect(Array.from(select.options).some((o) => o.textContent === "Personal")).toBe(true);
    });

    it("does not show resolved toggle on new note page", () => {
      render(<NewNotePage />);
      expect(screen.queryByLabelText(/mark as resolved/i)).toBeNull();
    });

    it("renders markdown preview bold text", () => {
      render(<NewNotePage />);
      setNoteBody("**bold**");
      const preview = screen.getByTestId("markdown-preview");
      expect(preview.querySelector("strong")?.textContent).toBe("bold");
    });

    it("renders markdown preview checklist items", () => {
      render(<NewNotePage />);
      setNoteBody("- [ ] item one\n- [x] item two");
      const preview = screen.getByTestId("markdown-preview");
      expect(preview.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThanOrEqual(2);
      expect(preview.querySelector('input[type="checkbox"][disabled]')).toBeNull();
    });

    it("toggles checklist in new note preview without saving", async () => {
      render(<NewNotePage />);
      setNoteBody("- [ ] item one");
      const textarea = screen.getByTestId("markdown-expert-textarea") as HTMLTextAreaElement;
      const checkbox = screen.getByTestId("markdown-preview").querySelector(
        'input[type="checkbox"]'
      ) as HTMLInputElement;
      fireEvent.click(checkbox);
      expect(textarea.value).toBe("- [x] item one");
    });

    it("does not show template picker on new note page", () => {
      render(<NewNotePage />);
      expect(screen.queryByTestId("note-template-picker")).toBeNull();
      expect(screen.queryByTestId("new-note-template-section")).toBeNull();
    });

    it("sanitizes unsafe markdown preview content", () => {
      render(<NewNotePage />);
      setNoteBody('<script>alert("xss")</script>\n\n**safe**');
      const preview = screen.getByTestId("markdown-preview");
      expect(preview.innerHTML).not.toContain("<script");
      expect(preview.querySelector("strong")?.textContent).toBe("safe");
    });

    it("still sends encrypted payload only when saving", async () => {
      const vaultKey = await generateUserVaultKey();
      await unlockVaultSession(vaultKey, "password", beginVaultOwnerOperation(USER_ID));
      const encrypted = await encryptNote(USER_ID, NOTE_ID, {
        title: "Encrypted title",
        body: "Encrypted body",
        tagIds: [],
        answered: false,
      });

      expect(encrypted.encryptedMetadata).toBeTruthy();
      expect(encrypted.encryptedBody).toBeTruthy();
      expect(JSON.stringify(encrypted)).not.toContain("Encrypted title");
      expect(JSON.stringify(encrypted)).not.toContain("Encrypted body");
    });
  });

  describe("/notes/[id]", () => {
    beforeEach(async () => {
      const { decryptNote } = await import("@/lib/crypto-client/notes");
      const { notesApi } = await import("@/lib/api-client/notes");

      vi.mocked(notesApi.get).mockResolvedValue({
        id: NOTE_ID,
        encryptedMetadata: {},
        encryptedBody: {},
        encryptedWrappedNoteKey: {},
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      } as never);

      vi.mocked(decryptNote).mockResolvedValue({
        metadata: {
          title: "Prayer note",
          body: "**answered**",
          categoryId: "c1",
          tagIds: ["t1"],
          answered: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
        body: "**answered**",
      });
    });

    it("shows protected message without decrypted content when locked", async () => {
      const { useRequireVault } = await import("@/features/vault/use-require-vault");
      const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
      vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(false));
      vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("locked"));

      render(<NoteDetailPage />);
      expect(await screen.findByTestId("vault-locked-state-read-note")).toBeTruthy();
      expect(screen.getByRole("heading", { name: /unlock to read this note/i })).toBeTruthy();
      expect(screen.queryByTestId("notes-vault-indicator")).toBeNull();
      expect(screen.queryByText("Prayer note")).toBeNull();
      expect(screen.queryByTestId("markdown-preview")).toBeNull();
      expect(screen.queryByRole("link", { name: /unlock vault/i })).toBeNull();
    });

    it("does not show page-level vault open indicator when unlocked", async () => {
      render(<NoteDetailPage />);
      await screen.findByText("Prayer note");
      expect(screen.queryByTestId("notes-vault-indicator")).toBeNull();
      expect(screen.queryByText("Vault open")).toBeNull();
    });

    it("shows created and updated dates in the detail rail", async () => {
      render(<NoteDetailPage />);
      const rail = await screen.findByTestId("note-detail-rail");
      expect(within(rail).getByText("Created")).toBeTruthy();
      expect(within(rail).getByText("Updated")).toBeTruthy();
    });

    it("shows resolve action in view mode matching list pattern", async () => {
      render(<NoteDetailPage />);
      await screen.findByText("Prayer note");
      expect(screen.getByTestId("note-mark-resolved-button")).toBeTruthy();
      expect(screen.getByTestId("note-reading-view")).toBeTruthy();
      expect(screen.getByRole("button", { name: /^edit$/i })).toBeTruthy();
      expect(screen.queryAllByRole("button", { name: /mark resolved/i })).toHaveLength(1);
      // Destructive actions live in the right rail (guarded by a confirm dialog), per the mockup.
      expect(screen.getByTestId("note-detail-rail-actions")).toBeTruthy();
    });

    it("opens reflection dialog from detail resolve icon", async () => {
      const { useNotes } = await import("@/features/notes/use-notes");
      vi.mocked(useNotes).mockReturnValue({
        createNote: vi.fn(),
        updateNote: vi.fn(),
        deleteNote: vi.fn(),
        toggleNoteResolved: vi.fn(),
        resolveNoteWithReflection: vi.fn(),
        busy: false,
        error: null,
      } as never);

      render(<NoteDetailPage />);
      fireEvent.click(await screen.findByTestId("note-mark-resolved-button"));
      await waitFor(() =>
        expect(screen.getByTestId("resolved-reflection-dialog")).toBeInTheDocument()
      );
    });

    it("renders resolved markdown on detail view", async () => {
      render(<NoteDetailPage />);
      expect(await screen.findByText("Prayer note")).toBeTruthy();
      const preview = screen.getByTestId("markdown-preview");
      expect(preview.querySelector("strong")?.textContent).toBe("answered");
    });

    it("renders bullet list on detail view", async () => {
      const { decryptNote } = await import("@/lib/crypto-client/notes");
      vi.mocked(decryptNote).mockResolvedValueOnce({
        metadata: {
          title: "List note",
          body: "- item 1\n- item 2",
          categoryId: null,
          tagIds: [],
          answered: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        body: "- item 1\n- item 2",
      });

      render(<NoteDetailPage />);
      expect(await screen.findByText("List note")).toBeTruthy();
      const preview = screen.getByTestId("markdown-preview");
      expect(preview.querySelector("ul")).toBeTruthy();
      expect(preview.querySelectorAll("li")).toHaveLength(2);
    });

    it("edit mode textarea shows raw markdown and preview renders resolved markdown", async () => {
      render(<NoteDetailPage />);
      await screen.findByText("Prayer note");
      fireEvent.click(screen.getByRole("button", { name: /edit/i }));
      switchEditorToMarkdownMode();

      const textarea = screen.getByTestId("markdown-expert-textarea") as HTMLTextAreaElement;
      expect(textarea.value).toBe("**answered**");

      const preview = screen.getByTestId("markdown-preview");
      expect(preview.querySelector("strong")?.textContent).toBe("answered");
    });

    it("displays category differently from tags", async () => {
      render(<NoteDetailPage />);
      await screen.findByText("Prayer note");
      expect(screen.getByText("Personal")).toBeTruthy();
      expect(screen.getByText("#faith")).toBeTruthy();
    });

    it("shows resolved checkbox only while editing in category fields", async () => {
      render(<NoteDetailPage />);
      await screen.findByText("Prayer note");
      expect(screen.getByTestId("note-mark-resolved-button")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /edit/i }));
      expect(screen.getAllByLabelText(/mark as resolved/i).length).toBeGreaterThanOrEqual(1);
    });

    it("persists checklist toggle in view mode", async () => {
      const { decryptNote } = await import("@/lib/crypto-client/notes");
      const { useNotes } = await import("@/features/notes/use-notes");
      vi.mocked(decryptNote).mockResolvedValueOnce({
        metadata: {
          title: "Checklist note",
          body: "- [ ] task",
          categoryId: null,
          tagIds: [],
          answered: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        body: "- [ ] task",
      });
      const updateNote = vi.fn().mockResolvedValue({});
      vi.mocked(useNotes).mockReturnValue({
        createNote: vi.fn(),
        updateNote,
        deleteNote: vi.fn(),
        toggleNoteResolved: vi.fn(),
        busy: false,
        error: null,
      });

      render(<NoteDetailPage />);
      await screen.findByText("Checklist note");
      const checkbox = screen.getByTestId("markdown-preview").querySelector(
        'input[type="checkbox"]'
      ) as HTMLInputElement;
      fireEvent.click(checkbox);

      await waitFor(
        () => expect(updateNote).toHaveBeenCalled(),
        { timeout: 3000 }
      );
    });

    it("toggles checklist in edit preview", async () => {
      const { decryptNote } = await import("@/lib/crypto-client/notes");
      vi.mocked(decryptNote).mockResolvedValueOnce({
        metadata: {
          title: "Edit checklist",
          body: "- [ ] task",
          categoryId: null,
          tagIds: [],
          answered: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        body: "- [ ] task",
      });

      render(<NoteDetailPage />);
      await screen.findByText("Edit checklist");
      fireEvent.click(screen.getByRole("button", { name: /edit/i }));
      switchEditorToMarkdownMode();
      const textarea = screen.getByTestId("markdown-expert-textarea") as HTMLTextAreaElement;
      const checkbox = screen.getByTestId("markdown-preview").querySelector(
        'input[type="checkbox"]'
      ) as HTMLInputElement;
      fireEvent.click(checkbox);
      expect(textarea.value).toBe("- [x] task");
    });
  });

  describe("tag chip input", () => {
    it("commits on Space, ArrowRight, Enter, and Tab", async () => {
      const onCreateTag = vi.fn(async (name: string) => ({
        id: `id-${name}`,
        name,
        createdAt: "",
        updatedAt: "",
      }));
      const onTagIdsChange = vi.fn();

      render(
        <TagChipInput
          tags={[]}
          tagIds={[]}
          onTagIdsChange={onTagIdsChange}
          onCreateTag={onCreateTag}
        />
      );

      const input = screen.getByLabelText(/add tags/i);

      fireEvent.change(input, { target: { value: "faith" } });
      fireEvent.keyDown(input, { key: " " });
      await waitFor(() => expect(onCreateTag).toHaveBeenCalledWith("faith"));

      onCreateTag.mockClear();
      fireEvent.change(input, { target: { value: "hope" } });
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(onCreateTag).toHaveBeenCalledWith("hope"));

      onCreateTag.mockClear();
      fireEvent.change(input, { target: { value: "peace" } });
      fireEvent.keyDown(input, { key: "ArrowRight" });
      await waitFor(() => expect(onCreateTag).toHaveBeenCalledWith("peace"));

      onCreateTag.mockClear();
      fireEvent.change(input, { target: { value: "joy" } });
      fireEvent.keyDown(input, { key: "Tab" });
      await waitFor(() => expect(onCreateTag).toHaveBeenCalledWith("joy"));
    });

    it("keeps focus in input after Space commit", async () => {
      const onCreateTag = vi.fn(async (name: string) => ({
        id: `id-${name}`,
        name,
        createdAt: "",
        updatedAt: "",
      }));

      render(
        <TagChipInput tags={[]} tagIds={[]} onTagIdsChange={vi.fn()} onCreateTag={onCreateTag} />
      );

      const input = screen.getByLabelText(/add tags/i) as HTMLInputElement;
      await act(async () => {
        fireEvent.change(input, { target: { value: "faith" } });
        fireEvent.keyDown(input, { key: " " });
      });
      await waitFor(() => expect(onCreateTag).toHaveBeenCalled());
      expect(input.value).toBe("");
    });
  });

  describe("note labels", () => {
    it("renders category without hash and tags with hash", () => {
      const { container: category } = render(<NoteCategoryLabel name="Prayer" />);
      const { container: tag } = render(<NoteTagChip name="faith" />);
      expect(category.textContent).toBe("📁Prayer");
      expect(tag.textContent).toBe("#faith");
    });
  });

  describe("note filter helper", () => {
    it("reports organizer availability", () => {
      expect(hasNoteOrganizers([], [])).toBe(false);
      expect(hasNoteOrganizers([{ id: "c1", name: "Prayer", createdAt: "", updatedAt: "" }], [])).toBe(
        true
      );
      expect(hasNoteOrganizers([], [{ id: "t1", name: "faith", createdAt: "", updatedAt: "" }])).toBe(
        true
      );
    });

    it("returns null when no organizers exist", () => {
      const { container } = render(
        <NoteFilters
          filters={{ search: "", categoryId: "all", tagId: "all", resolved: "all" }}
          categories={[]}
          tags={[]}
          onChange={vi.fn()}
        />
      );
      expect(container).toBeEmptyDOMElement();
    });
  });
});
