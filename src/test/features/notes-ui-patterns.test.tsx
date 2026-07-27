import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({ data: { user: { id: "user-1" } }, status: "authenticated" })),
}));
import NotesPage from "@/app/(vault)/notes/page";
import { SmartFilterChips } from "@/features/notes/smart-filter-chips";
import { NoteCard } from "@/components/notes/note-card";
import { NoteListRow } from "@/components/notes/note-list-row";
import { PageHeader } from "@/components/ui/page-header";
import { defaultNoteFilters } from "@/features/notes/note-filters";
import { shouldShowNotesListControls } from "@/lib/notes/notes-list-controls-visibility";

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
  favorite: false,
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
    savedViews: [
      {
        id: "sv1",
        name: "Pinned prayers",
        criteria: {
          smartFilter: "pinned",
          search: "",
          categoryId: "all",
          tagId: "all",
          resolved: "all",
          sort: "updated-desc",
        },
        createdAt: "",
        updatedAt: "",
      },
    ],
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

describe("SelahKeep notes UI patterns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the simplified notes header (title + new note action)", () => {
    render(<NotesPage />);
    expect(screen.getByRole("heading", { name: "Notes" })).toBeTruthy();
    expect(screen.getByTestId("new-note-action")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /new daily note/i })).toBeNull();
  });

  it("renders the search bar, primary filter chips, and counter (no rich toolbar)", () => {
    render(<NotesPage />);
    expect(screen.getByTestId("note-search")).toBeTruthy();
    expect(screen.getByTestId("smart-filter-chips")).toBeTruthy();
    expect(screen.getByTestId("notes-counter")).toBeTruthy();
    // The rich toolbar (Views/Filters/Sort/saved views) was simplified away.
    expect(screen.queryByTestId("notes-list-controls")).toBeNull();
    expect(screen.queryByTestId("saved-views-menu")).toBeNull();
  });

  it("filters by the primary chips (All / Pinned / Recently viewed)", () => {
    render(<NotesPage />);
    expect(screen.getByTestId("smart-filter-chip-all-active")).toBeTruthy();
    const pinned = screen.getByTestId("smart-filter-chip-pinned");
    expect(pinned.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(pinned);
    expect(pinned.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("smart-filter-chip-recently-viewed")).toBeTruthy();
  });

  it("selects smart filter chips with accessible state", () => {
    const onChange = vi.fn();
    render(<SmartFilterChips value="all-active" onChange={onChange} />);
    const pinned = screen.getByTestId("smart-filter-chip-pinned");
    expect(pinned.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(pinned);
    expect(onChange).toHaveBeenCalledWith("pinned");
  });

  it("hides entire controls region when product visibility rule is false", () => {
    expect(
      shouldShowNotesListControls({
        hasOrganizers: false,
        totalNotes: 0,
        smartFilter: "all-active",
        filters: defaultNoteFilters,
        hasSavedViews: false,
      })
    ).toBe(false);
  });

  it("renders card mode with rich metadata", () => {
    render(
      <NoteCard
        id="n1"
        title="Prayer note"
        answered={false}
        createdAt="2026-01-01T00:00:00.000Z"
        updatedAt="2026-01-02T00:00:00.000Z"
        categoryName="Prayer"
        tagNames={["faith"]}
        pinned
      />
    );
    expect(screen.getByTestId("note-card")).toBeTruthy();
    expect(screen.getByTestId("note-pinned-badge")).toBeTruthy();
    expect(screen.getByText("Prayer")).toBeTruthy();
  });

  it("renders list mode as compact rows with category only", () => {
    render(
      <NoteListRow
        id="n1"
        title="Scan friendly row"
        answered
        createdAt="2026-01-01T00:00:00.000Z"
        updatedAt="2026-01-02T00:00:00.000Z"
        categoryName="Prayer"
        tagNames={["faith"]}
      />
    );
    const row = screen.getByTestId("note-list-row");
    expect(row.className).toContain("note-list-row");
    expect(screen.getByText("Prayer")).toBeTruthy();
    expect(screen.queryByText("faith")).toBeNull();
    expect(screen.getByText(/Updated/i)).toBeTruthy();
  });

  it("shows polished zero-notes empty state copy", async () => {
    // Persistent (not Once): NotesPage renders multiple times; every render
    // must see the empty index for the zero-notes empty state to hold.
    useVaultIndexMock.mockReturnValue({
      index: {
        categories: [],
        tags: [],
        entries: [],
        savedViews: [],
        version: 3,
      },
      loading: false,
      error: null,
      mutateIndex: vi.fn(),
    });

    render(<NotesPage />);
    expect(await screen.findByText("A quiet, empty page")).toBeTruthy();
    expect(screen.queryByTestId("notes-list-controls")).toBeNull();
    expect(screen.getByTestId("empty-state-new-note")).toBeTruthy();
  });

  it("exposes reusable page header primitive", () => {
    render(<PageHeader title="Vault settings" description="Manage vault behavior." />);
    expect(screen.getByRole("heading", { name: "Vault settings" })).toBeTruthy();
  });

  it("opens new note menu with daily and template options", () => {
    render(<NotesPage />);
    fireEvent.click(screen.getByTestId("new-note-action"));
    expect(screen.getByTestId("new-note-blank")).toBeTruthy();
    expect(screen.getByTestId("new-daily-note")).toBeTruthy();
    expect(screen.getByTestId("new-note-template-prayer")).toBeTruthy();
  });
});
