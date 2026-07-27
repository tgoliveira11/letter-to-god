import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import NotesPage from "@/app/(vault)/notes/page";
import NewNotePage from "@/app/(vault)/notes/new/page";
import AccountSettingsPage from "@/app/(vault)/settings/account/page";
import { SmartFilterChips } from "@/features/notes/smart-filter-chips";
import { NoteListRow } from "@/components/notes/note-list-row";
import { AUTHENTICATED_WIDTH_CLASS } from "@/lib/ui/authenticated-layout";

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
    createNote: vi.fn(),
    toggleNoteResolved: vi.fn(),
    busy: false,
    error: null,
  })),
}));

vi.mock("@/features/notes/use-categories-tags", () => ({
  useCategoriesTags: vi.fn(() => ({
    categories: [],
    tags: [],
    createCategory: vi.fn(),
    createTag: vi.fn(),
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

vi.mock("@/features/vault/use-vault-activity", () => ({
  touchVaultActivity: vi.fn(),
}));

vi.mock("@/features/vault/use-vault-auto-locked-copy", () => ({
  useVaultAutoLockedCopy: vi.fn(() => false),
}));

vi.mock("@/features/notes/use-note-vault-before-auto-lock", () => ({
  useNoteVaultBeforeAutoLock: vi.fn(),
}));

vi.mock("@/lib/crypto-client/note-drafts", () => ({
  NEW_NOTE_DRAFT_KEY: "new",
  loadEncryptedNoteDraft: vi.fn().mockResolvedValue(null),
  saveEncryptedNoteDraft: vi.fn(),
  deleteEncryptedNoteDraft: vi.fn(),
  listEncryptedNoteDraftKeys: vi.fn().mockResolvedValue([]),
}));

const sampleEntry = {
  id: "n1",
  title: "Morning prayer",
  categoryId: "c1" as string | null,
  tagIds: ["t1"],
  answered: false,
  pinned: false,
  favorite: false,
  archived: false,
  trashed: false,
  trashedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
};

vi.mock("@/features/notes/use-vault-index", () => {
  // Stable reference, built lazily on first call (so `sampleEntry` is already
  // initialized): a fresh object per render loops the notes page effects.
  let value: unknown;
  return {
    useVaultIndex: vi.fn(
      () =>
        (value ??= {
          index: {
            categories: [{ id: "c1", name: "Prayer", createdAt: "", updatedAt: "" }],
            tags: [{ id: "t1", name: "faith", createdAt: "", updatedAt: "" }],
            entries: [sampleEntry],
            savedViews: [],
            version: 3,
          },
          loading: false,
          error: null,
          mutateIndex: vi.fn(),
        })
    ),
  };
});

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    status: "authenticated",
    data: { user: { id: "user-1", email: "user@test.local" } },
  })),
}));

vi.mock("@tgoliveira/secure-auth/react/client", () => ({
  defaultSignOutAccount: vi.fn(async () => undefined),
}));

vi.mock("@tgoliveira/secure-auth/react", () => ({
  AccountSettingsPage: () => (
    <div data-testid="secure-auth-account-settings">
      <p>user@test.local</p>
      <button type="button">Delete my account permanently</button>
    </div>
  ),
  SecuritySettingsPage: () => <div><h3>Passkeys</h3></div>,
}));

describe("authenticated UI refinement pass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("layout widths", () => {
    it("defines standard authenticated width tokens", () => {
      expect(AUTHENTICATED_WIDTH_CLASS.settings).toContain("800");
      // Notes list spans the full main column (mockup) — no max-width cap.
      expect(AUTHENTICATED_WIDTH_CLASS.notes).toBe("max-w-none");
      expect(AUTHENTICATED_WIDTH_CLASS.editor).toContain("880");
    });

    it("/notes uses notes dashboard width container", () => {
      render(<NotesPage />);
      const main = document.getElementById("main-content");
      expect(main?.className).toContain(AUTHENTICATED_WIDTH_CLASS.notes);
    });

    it("/notes/new uses notes width container when unlocked", () => {
      render(<NewNotePage />);
      const main = document.getElementById("main-content");
      expect(main?.className).toContain(AUTHENTICATED_WIDTH_CLASS.notes);
      expect(screen.getByTestId("note-editor-surface")).toBeTruthy();
    });

    it("/settings/account uses readable settings width", () => {
      render(<AccountSettingsPage />);
      const main = document.getElementById("main-content");
      expect(main?.className).toContain(AUTHENTICATED_WIDTH_CLASS.settings);
    });
  });

  describe("/notes header and counter", () => {
    it("shows the search bar, chips, and note counter (simplified header)", () => {
      render(<NotesPage />);
      expect(screen.getByTestId("note-search")).toBeTruthy();
      expect(screen.getByTestId("smart-filter-chips")).toBeTruthy();
      expect(screen.getByTestId("notes-counter")).toBeTruthy();
    });
  });

  describe("smart filter chips", () => {
    it("renders separated chip labels without concatenation", () => {
      render(<SmartFilterChips value="all-active" onChange={vi.fn()} />);
      expect(screen.getByTestId("smart-filter-chip-all-active").textContent).toBe("All active");
      expect(screen.getByTestId("smart-filter-chip-pinned").textContent).toBe("Pinned");
      expect(screen.getByTestId("smart-filter-chip-favorites").textContent).toBe("Favorites");
      expect(screen.getAllByRole("tab").length).toBeGreaterThan(5);
    });

    it("exposes selected chip state accessibly", () => {
      render(<SmartFilterChips value="pinned" onChange={vi.fn()} />);
      expect(screen.getByTestId("smart-filter-chip-pinned").getAttribute("aria-selected")).toBe("true");
    });
  });

  describe("list mode structure", () => {
    it("renders structured list row with category column", () => {
      const toggle = vi.fn();
      render(
        <NoteListRow
          id="n1"
          title="Prayed that today"
          answered={false}
          createdAt="2026-01-01T00:00:00.000Z"
          updatedAt="2026-01-02T00:00:00.000Z"
          categoryName="Prayer"
          tagNames={["faith"]}
          onToggleResolved={toggle}
        />
      );
      expect(screen.getByTestId("note-list-row")).toBeTruthy();
      expect(screen.getByText("Prayed that today")).toBeTruthy();
      expect(screen.getByText("Prayer")).toBeTruthy();
      expect(screen.queryByText("faith")).toBeNull();
      expect(screen.getByText(/Updated/i)).toBeTruthy();
      expect(screen.getByRole("link", { name: /open note: prayed that today/i })).toHaveAttribute(
        "href",
        "/notes/n1"
      );
    });

  });

  describe("/settings/account layout", () => {
    it("keeps a single visible page heading", () => {
      render(<AccountSettingsPage />);
      const headings = screen.getAllByRole("heading", { name: /account settings/i });
      expect(headings).toHaveLength(1);
    });

    it("associates delete warning with account section", () => {
      render(<AccountSettingsPage />);
      const accountSection = screen.getByRole("heading", { name: /^account$/i }).closest("section");
      expect(accountSection?.textContent).toMatch(/delete your account/i);
      expect(screen.getByRole("button", { name: /delete my account permanently/i })).toBeTruthy();
    });
  });
});
