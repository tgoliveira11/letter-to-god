import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import NewNotePage from "@/app/(vault)/notes/new/page";
import NotesPage from "@/app/(vault)/notes/page";
import { saveEncryptedNoteDraft } from "@/lib/crypto-client/note-drafts";

const useSearchParams = vi.fn(() => new URLSearchParams());

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })),
  usePathname: vi.fn(() => "/notes"),
  useSearchParams: () => useSearchParams(),
}));

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: { user: { id: "user-1" } },
    status: "authenticated",
  })),
}));

vi.mock("@/features/vault/use-require-vault", () => ({
  useRequireVault: vi.fn(() => ({
    status: "ready",
    userId: "user-1",
    vaultUnlocked: true,
    recheckVault: vi.fn(),
  })),
}));

vi.mock("@/features/vault/use-vault-client-status", () => ({
  useVaultClientStatus: vi.fn(() => ({
    status: "ready",
    clientStatus: "unlocked",
    setupPhase: "complete",
    serverStatus: { setupComplete: true },
    recheck: vi.fn(),
  })),
}));

const createCategory = vi.fn(async (name: string) => ({
  id: `cat-${name.toLowerCase().replace(/\s+/g, "-")}`,
  name,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}));

vi.mock("@/features/notes/use-categories-tags", () => ({
  useCategoriesTags: vi.fn(() => ({
    categories: [],
    tags: [],
    createCategory,
    createTag: vi.fn(),
  })),
}));

vi.mock("@/features/notes/use-notes", () => ({
  useNotes: vi.fn(() => ({
    createNote: vi.fn(),
    toggleNoteResolved: vi.fn(),
    busy: false,
    error: null,
  })),
}));

// Stable reference: the notes pages have effects keyed on `index` / `mutateIndex`.
// Returning a fresh object per render makes those effects re-run every render —
// an infinite render loop that exhausts the worker heap. Keep it constant.
const defaultVaultIndexValue = {
  index: {
    categories: [],
    tags: [],
    entries: [
      {
        id: "n1",
        title: "Only note",
        categoryId: null,
        tagIds: [],
        answered: false,
        pinned: false,
        favorite: false,
        archived: false,
        trashed: false,
        trashedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ],
    savedViews: [],
    version: 3,
  },
  loading: false,
  error: null,
  mutateIndex: vi.fn(),
};
const useVaultIndexMock = vi.fn(() => defaultVaultIndexValue);

vi.mock("@/features/notes/use-vault-index", () => ({
  useVaultIndex: (...args: unknown[]) => useVaultIndexMock(...args),
}));

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

vi.mock("@/features/vault/use-vault-auto-locked-copy", () => ({
  useVaultAutoLockedCopy: vi.fn(() => false),
}));

vi.mock("@/lib/crypto-client/note-drafts", () => ({
  NEW_NOTE_DRAFT_KEY: "new",
  loadEncryptedNoteDraft: vi.fn().mockResolvedValue(null),
  saveEncryptedNoteDraft: vi.fn().mockResolvedValue(undefined),
  deleteEncryptedNoteDraft: vi.fn().mockResolvedValue(undefined),
  listEncryptedNoteDraftKeys: vi.fn().mockResolvedValue([]),
}));

describe("notes refinements", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchParams.mockReturnValue(new URLSearchParams());
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("template category", () => {
    it("shows locked Prayer category when opened via template query link", async () => {
      useSearchParams.mockReturnValue(new URLSearchParams("template=prayer"));
      render(<NewNotePage />);

      const locked = await screen.findByTestId("template-locked-category");
      expect(locked.textContent).toMatch(/Prayer/);
      expect(locked.textContent).toMatch(/assigned automatically/i);
    });

    it("does not create category when opened via Prayer template link", async () => {
      useSearchParams.mockReturnValue(new URLSearchParams("template=prayer"));
      render(<NewNotePage />);
      await screen.findByTestId("template-locked-category");
      expect(createCategory).not.toHaveBeenCalled();
    });

    it("does not autosave after opening a template link alone", async () => {
      useSearchParams.mockReturnValue(new URLSearchParams("template=prayer"));
      render(<NewNotePage />);
      await screen.findByTestId("template-locked-category");

      vi.advanceTimersByTime(3000);
      expect(saveEncryptedNoteDraft).not.toHaveBeenCalled();
    });

    it("starts autosave after user edits body on a template link", async () => {
      useSearchParams.mockReturnValue(new URLSearchParams("template=prayer"));
      render(<NewNotePage />);
      await screen.findByTestId("template-locked-category");

      fireEvent.click(screen.getByTestId("editor-mode-markdown"));
      fireEvent.change(screen.getByTestId("markdown-expert-textarea"), { target: { value: "extra" } });

      vi.advanceTimersByTime(2000);

      await waitFor(() => {
        expect(saveEncryptedNoteDraft).toHaveBeenCalled();
      });
    });

    it("shows manual category controls for blank note without template query", async () => {
      render(<NewNotePage />);
      expect(screen.queryByTestId("template-locked-category")).toBeNull();
      expect(screen.getByPlaceholderText(/new category name/i)).toBeTruthy();
    });
  });

  describe("/notes header region", () => {
    it("shows the simplified search + chips + counter (no rich toolbar)", () => {
      render(<NotesPage />);
      expect(screen.getByTestId("note-search")).toBeTruthy();
      expect(screen.getByTestId("smart-filter-chips")).toBeTruthy();
      expect(screen.getByTestId("notes-counter")).toBeTruthy();
      expect(screen.queryByTestId("notes-list-controls")).toBeNull();
      expect(screen.queryByTestId("note-sort-menu")).toBeNull();
      expect(screen.queryByTestId("saved-views-menu")).toBeNull();
    });
  });
});
