import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({ data: { user: { id: "user-1" } }, status: "authenticated" })),
}));
import NotesPage from "@/app/(vault)/notes/page";
import { ToolbarMenu } from "@/components/ui/toolbar-menu";
import { ViewModeToggle } from "@/features/notes/view-mode-toggle";
import { NoteCard } from "@/components/notes/note-card";
import { NoteListRow } from "@/components/notes/note-list-row";
import { NoteStateIndicators } from "@/components/notes/note-state-indicators";
import { NoteResolvedToggle } from "@/components/notes/note-resolved-toggle";

const routerPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: routerPush, replace: vi.fn(), back: vi.fn() })),
  usePathname: vi.fn(() => "/notes"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
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

vi.mock("@/features/notes/use-notes", () => ({
  useNotes: vi.fn(() => ({
    toggleNoteResolved: vi.fn(),
  })),
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

vi.mock("@/lib/crypto-client/note-drafts", () => ({
  listEncryptedNoteDraftKeys: vi.fn().mockResolvedValue([]),
}));

const baseEntry = {
  id: "n1",
  title: "Morning prayer",
  categoryId: "c1" as string | null,
  tagIds: ["t1"],
  answered: false,
  pinned: true,
  favorite: true,
  archived: false,
  trashed: false,
  trashedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

// Stable reference — a fresh object per render makes the notes page effects
// (keyed on `index`) re-run every render, an infinite loop that OOMs the worker.
const defaultVaultIndexValue = {
  index: {
    categories: [{ id: "c1", name: "Prayer", createdAt: "", updatedAt: "" }],
    tags: [{ id: "t1", name: "faith", createdAt: "", updatedAt: "" }],
    entries: [baseEntry],
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

describe("SelahKeep notes toolbar refinement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // The rich notes toolbar (Views/Filters/Sort menus + Cards/List toggle) was
  // simplified away on the page; the underlying components are still covered
  // standalone below.
  describe("toolbar primitives (standalone)", () => {
    it("closes ToolbarMenu on Escape and returns focus to trigger", () => {
      render(
        <ToolbarMenu label="Test menu" testId="test-toolbar-menu">
          <p>Menu content</p>
        </ToolbarMenu>
      );
      const trigger = screen.getByTestId("test-toolbar-menu");
      fireEvent.click(trigger);
      expect(screen.getByTestId("test-toolbar-menu-panel")).toBeTruthy();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByTestId("test-toolbar-menu-panel")).toBeNull();
      expect(document.activeElement).toBe(trigger);
    });

    it("ViewModeToggle standalone uses view-mode-toggle wrapper", () => {
      render(<ViewModeToggle mode="cards" onChange={vi.fn()} />);
      expect(screen.getByRole("group", { name: "View mode" }).className).toContain("view-mode-toggle");
    });
  });

  describe("list mode metadata", () => {
    it("shows category in list row", () => {
      render(
        <NoteListRow
          id="n1"
          title="Prayed that today"
          answered={false}
          createdAt="2026-01-01T00:00:00.000Z"
          updatedAt="2026-01-02T00:00:00.000Z"
          categoryName="Prayer"
          tagNames={["faith"]}
        />
      );
      expect(screen.getByText("Prayer")).toBeTruthy();
    });

    it("does not show tags in list row", () => {
      render(
        <NoteListRow
          id="n1"
          title="Prayed that today"
          answered={false}
          createdAt="2026-01-01T00:00:00.000Z"
          updatedAt="2026-01-02T00:00:00.000Z"
          categoryName="Prayer"
          tagNames={["faith"]}
        />
      );
      expect(screen.queryByText("faith")).toBeNull();
      expect(screen.queryByText("#faith")).toBeNull();
    });

    it("still shows tags in card mode", () => {
      render(
        <NoteCard
          id="n1"
          title="Prayer note"
          answered={false}
          createdAt="2026-01-01T00:00:00.000Z"
          updatedAt="2026-01-02T00:00:00.000Z"
          categoryName="Prayer"
          tagNames={["faith"]}
        />
      );
      expect(within(screen.getByTestId("note-card-metadata")).getByText("#faith")).toBeTruthy();
    });

    it("keeps list row structured with link and separate action", () => {
      const toggle = vi.fn();
      render(
        <NoteListRow
          id="n1"
          title="Structured row"
          answered={false}
          createdAt="2026-01-01T00:00:00.000Z"
          updatedAt="2026-01-02T00:00:00.000Z"
          categoryName="Prayer"
          onToggleResolved={toggle}
        />
      );
      expect(screen.getByRole("link", { name: /open note: structured row/i })).toHaveAttribute(
        "href",
        "/notes/n1"
      );
      fireEvent.click(screen.getByLabelText(/mark as resolved/i));
      expect(toggle).toHaveBeenCalled();
      expect(routerPush).not.toHaveBeenCalled();
    });
  });

  describe("note state indicators", () => {
    it("shows resolved indicator in card mode", () => {
      render(
        <NoteStateIndicators answered pinned favorite archived={false} trashed={false} />
      );
      expect(screen.getByTestId("note-resolved-indicator")).toBeTruthy();
      expect(screen.getByLabelText("Resolved")).toBeTruthy();
    });

    it("shows unresolved indicator in card mode", () => {
      render(
        <NoteStateIndicators answered={false} pinned favorite archived={false} trashed={false} />
      );
      expect(screen.getByTestId("note-unresolved-indicator")).toBeTruthy();
      expect(screen.getByLabelText("Unresolved")).toBeTruthy();
    });

    it("shows pinned and favorite for active notes", () => {
      render(<NoteStateIndicators answered={false} pinned favorite archived={false} trashed={false} />);
      expect(screen.getByLabelText("Pinned note")).toBeTruthy();
      expect(screen.getByLabelText("Favorite note")).toBeTruthy();
    });

    it("shows archived indicator when archived", () => {
      render(<NoteStateIndicators answered={false} archived trashed={false} />);
      expect(screen.getByLabelText("Archived note")).toBeTruthy();
    });

    it("shows trash indicator when trashed", () => {
      render(<NoteStateIndicators answered={false} trashed />);
      expect(screen.getByLabelText("Note in trash")).toBeTruthy();
    });

    it("hides pinned and favorite when archived", () => {
      render(<NoteStateIndicators answered={false} pinned favorite archived trashed={false} />);
      expect(screen.queryByLabelText("Pinned note")).toBeNull();
      expect(screen.queryByLabelText("Favorite note")).toBeNull();
      expect(screen.getByLabelText("Archived note")).toBeTruthy();
    });

    it("active note can show resolved + pinned + favorite in card", () => {
      render(
        <NoteCard
          id="n1"
          title="Full state"
          answered
          pinned
          favorite
          createdAt="2026-01-01T00:00:00.000Z"
          updatedAt="2026-01-02T00:00:00.000Z"
        />
      );
      expect(screen.getByLabelText("Resolved")).toBeTruthy();
      expect(screen.getByLabelText("Pinned note")).toBeTruthy();
      expect(screen.getByLabelText("Favorite note")).toBeTruthy();
    });

    it("list row shows indicators outside the navigation link", () => {
      render(
        <NoteListRow
          id="n1"
          title="Indicator row"
          answered={false}
          pinned
          favorite
          createdAt="2026-01-01T00:00:00.000Z"
          updatedAt="2026-01-02T00:00:00.000Z"
          categoryName="Prayer"
        />
      );
      const link = screen.getByRole("link", { name: /open note: indicator row/i });
      expect(within(link).queryByLabelText("Pinned note")).toBeNull();
      expect(screen.getByLabelText("Pinned note")).toBeTruthy();
    });
  });

  describe("regression", () => {
    it("search still renders on notes page", () => {
      render(<NotesPage />);
      expect(screen.getByTestId("note-search")).toBeTruthy();
    });

    it("resolved toggle remains a separate control from card link", () => {
      const onToggle = vi.fn();
      render(
        <NoteCard
          id="n1"
          title="Toggle test"
          answered={false}
          createdAt="2026-01-01T00:00:00.000Z"
          updatedAt="2026-01-02T00:00:00.000Z"
          onToggleResolved={onToggle}
        />
      );
      fireEvent.click(screen.getByLabelText(/mark as resolved/i));
      expect(onToggle).toHaveBeenCalled();
    });

    it("NoteResolvedToggle does not render inside navigation link", () => {
      render(<NoteResolvedToggle answered={false} onToggle={vi.fn()} />);
      expect(screen.getByLabelText(/mark as resolved/i).closest("a")).toBeNull();
    });
  });
});
