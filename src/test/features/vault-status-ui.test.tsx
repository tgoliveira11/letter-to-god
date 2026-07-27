import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import NotesPage from "@/app/(vault)/notes/page";
import VaultSettingsPage from "@/app/(vault)/vault/settings/page";
import VaultUnlockPage from "@/app/(vault)/vault/unlock/page";
import { SiteShell } from "@/components/layout/site-shell";
import HomePage from "@/app/(public)/page";
import { VaultLockedState } from "@/features/vault/vault-locked-state";
import { VaultStatusPrompt } from "@/features/vault/vault-status-prompt";
import { buildVaultUnlockHref, readSelahkeepVaultUnlockReturnPath } from "@/lib/notes/safe-return-to";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })),
  usePathname: vi.fn(() => "/notes"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: { user: { id: "user-1", email: "user@example.com" } },
    status: "authenticated",
    update: vi.fn(),
  })),
}));

vi.mock("@/features/vault/use-require-vault", () => ({
  useRequireVault: vi.fn(),
}));

vi.mock("@/features/vault/use-vault-client-status", () => ({
  useVaultClientStatus: vi.fn(),
}));

vi.mock("@/components/vault-providers", () => ({
  useSelahkeepVaultAutoLockPreference: vi.fn(() => ({
    minutes: 15,
    setMinutes: vi.fn(),
    resetToAdminDefault: vi.fn(),
    adminMaxMinutes: 15,
    minMinutes: 1,
    usingUserPreference: false,
    resolutionStatus: "ready",
    retryResolution: vi.fn(),
  })),
}));

vi.mock("@/features/vault/use-vault", () => ({
  useVault: vi.fn(() => ({
    loading: false,
    error: null,
    unlockFromPasskey: vi.fn(),
    unlockFromRecoveryCode: vi.fn(),
    unlockFromVaultPassword: vi.fn(),
    unlockFromRecoveryPhrase: vi.fn(),
  })),
}));

vi.mock("@/features/notes/use-vault-index", () => ({
  useVaultIndex: vi.fn(() => ({
    index: null,
    loading: false,
    error: null,
    reload: vi.fn(),
    persistIndex: vi.fn(),
    mutateIndex: vi.fn(),
  })),
}));

vi.mock("@/features/notes/use-notes", () => ({
  useNotes: vi.fn(() => ({
    toggleNoteResolved: vi.fn(),
    moveNoteToTrash: vi.fn(),
    restoreNoteFromTrash: vi.fn(),
    permanentlyDeleteNote: vi.fn(),
    toggleNotePinned: vi.fn(),
    toggleNoteFavorite: vi.fn(),
    toggleNoteArchived: vi.fn(),
    duplicateNote: vi.fn(),
    busy: false,
    error: null,
  })),
}));

vi.mock("@/lib/crypto-client/note-drafts", () => ({
  listEncryptedNoteDraftKeys: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/features/passkey/passkey-vault-unlock-setup", () => ({
  PasskeyVaultUnlockSetup: () => <div data-testid="passkey-vault-unlock-setup" />,
}));

vi.mock("@/features/notes/use-vault-settings", () => ({
  useVaultSettings: vi.fn(() => ({
    settings: null,
    loading: false,
    error: null,
    updateUnlockBehavior: vi.fn(),
  })),
}));

vi.mock("@tgoliveira/vault-core/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tgoliveira/vault-core/react")>();
  return {
    ...actual,
    useVaultUnlockPageNavigation: vi.fn(),
    VaultUnlockPanel: ({
      serverStatus,
    }: {
      serverStatus?: { hasPasskeyPrfEnvelope?: boolean };
    }) => (
      <div data-testid="vault-unlock-panel">
        <p>Unlock SelahKeep</p>
        <p>Your vault is already unlocked</p>
        <a href="/notes">Go to notes</a>
        {serverStatus?.hasPasskeyPrfEnvelope ? (
          <button type="button">Unlock with passkey</button>
        ) : null}
        <div role="tab">Vault password</div>
        <div role="tab">Recovery phrase</div>
      </div>
    ),
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

function mockVaultReady(unlocked: boolean) {
  return {
    status: "ready" as const,
    userId: "user-1",
    vaultUnlocked: unlocked,
    recheckVault: vi.fn(),
  };
}

function mockClientStatus(
  clientStatus: "not_configured" | "setup_incomplete" | "locked" | "unlocked",
  serverOverrides: Record<string, unknown> = {}
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
      hasVault: clientStatus !== "not_configured",
      setupPhase,
      setupComplete: clientStatus === "locked" || clientStatus === "unlocked",
      vaultVersion: "vault-v2",
      ltgSetupComplete: clientStatus === "locked" || clientStatus === "unlocked",
      hasEncryptedSettings: clientStatus === "locked" || clientStatus === "unlocked",
      hasEncryptedIndex: clientStatus === "locked" || clientStatus === "unlocked",
      hasVaultPassword: clientStatus === "locked" || clientStatus === "unlocked",
      hasRecoveryPhrase: clientStatus === "locked" || clientStatus === "unlocked",
      ...serverOverrides,
    },
    recheck: vi.fn(),
  };
}

describe("vault status UI", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { useRequireVault } = await import("@/features/vault/use-require-vault");
    vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(false));
  });

  it("notes page shows SelahKeep welcome when vault is not configured", async () => {
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("not_configured"));

    render(<NotesPage />);
    expect(await screen.findByText("Welcome to SelahKeep")).toBeTruthy();
    expect(screen.getByRole("link", { name: /set up your vault/i }).getAttribute("href")).toBe(
      "/vault/setup"
    );
    expect(screen.queryByText(/unlock to read this letter/i)).toBeNull();
    expect(screen.queryByText(/vault locked/i)).toBeNull();
    expect(screen.queryByRole("link", { name: /new note/i })).toBeNull();
  });

  it("notes page shows continue setup when setup is incomplete", async () => {
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("setup_incomplete"));

    render(<NotesPage />);
    expect(await screen.findByText(/Opening SelahKeep/i)).toBeTruthy();
    expect(screen.queryByTestId("notes-vault-indicator")).toBeNull();
  });

  it("notes page renders notes shell when vault is locked (overlay handled by layout gate)", async () => {
    const replace = vi.fn();
    const { useRouter } = await import("next/navigation");
    vi.mocked(useRouter).mockReturnValue({ push: vi.fn(), replace, back: vi.fn() });
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("locked"));

    render(<NotesPage />);
    expect(await screen.findByRole("heading", { name: /^notes$/i })).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId("notes-vault-protected-message")).toBeNull();
  });

  it("notes page shows notes when vault is unlocked", async () => {
    const { useRequireVault } = await import("@/features/vault/use-require-vault");
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    const { useVaultIndex } = await import("@/features/notes/use-vault-index");

    vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(true));
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("unlocked"));
    vi.mocked(useVaultIndex).mockReturnValue({
      index: { version: 3, entries: [], categories: [], tags: [], savedViews: [] },
      loading: false,
      error: null,
      reload: vi.fn(),
      persistIndex: vi.fn(),
      mutateIndex: vi.fn(),
    });

    render(<NotesPage />);
    expect((await screen.findAllByTestId("new-note-action")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/set up your vault/i)).toBeNull();
  });

  it("vault settings shows setup prompt when vault is not configured", async () => {
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("not_configured"));

    render(<VaultSettingsPage />);
    expect(await screen.findByText("Set up your vault")).toBeTruthy();
    expect(screen.queryByText(/recovery protection/i)).toBeNull();
    expect(screen.queryByText(/unlock to read/i)).toBeNull();
  });

  it("vault settings locked prompt links to full unlock page with returnTo", async () => {
    render(<VaultLockedState variant="vault-settings" returnTo="/vault/settings" />);
    expect(
      screen.getByRole("link", { name: /open full unlock page/i }).getAttribute("href")
    ).toBe("/vault/unlock?next=%2Fvault%2Fsettings");
  });

  it("vault settings shows unlock prompt when vault is locked", async () => {
    render(<VaultLockedState variant="vault-settings" returnTo="/vault/settings" />);
    expect(
      screen.getByText(/unlock your vault to manage vault settings/i)
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /unlock here/i })).toBeTruthy();
  });

  it("vault settings shows unlock behavior when vault is unlocked", async () => {
    const { useRequireVault } = await import("@/features/vault/use-require-vault");
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    const { useVaultSettings } = await import("@/features/notes/use-vault-settings");

    vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(true));
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("unlocked"));
    vi.mocked(useVaultSettings).mockReturnValue({
      settings: { unlockBehavior: "metadata_only" },
      loading: false,
      error: null,
      updateUnlockBehavior: vi.fn(),
    });

    render(<VaultSettingsPage />);
    expect(await screen.findByText("Metadata only (recommended)")).toBeTruthy();
    expect(screen.getByTestId("passkey-vault-unlock-setup")).toBeTruthy();
    expect(screen.queryByText(/set up your vault/i)).toBeNull();
  });

  it("vault unlock already unlocked uses sanitized returnTo link", () => {
    const path = readSelahkeepVaultUnlockReturnPath(
      new URLSearchParams("returnTo=%2Fvault%2Fsettings")
    );
    expect(path).toBe("/vault/settings");
    expect(buildVaultUnlockHref("/vault/settings")).toContain("next=%2Fvault%2Fsettings");
  });

  it("vault unlock rejects unsafe returnTo and defaults to notes", () => {
    const path = readSelahkeepVaultUnlockReturnPath(
      new URLSearchParams("returnTo=https%3A%2F%2Fevil.test")
    );
    expect(path).toBe("/notes");
  });

  it("vault unlock shows setup-first state when vault is not configured", async () => {
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("not_configured"));

    render(<VaultUnlockPage />);
    expect(await screen.findByText("Set up your vault first")).toBeTruthy();
    expect(screen.getByRole("link", { name: /^set up vault$/i }).getAttribute("href")).toBe(
      "/vault/setup"
    );
    expect(screen.getByRole("link", { name: /go to notes/i }).getAttribute("href")).toBe("/notes");
    expect(screen.queryByLabelText(/vault password/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /^recovery phrase$/i })).toBeNull();
    expect(screen.queryByText(/unlock selahkeep/i)).toBeNull();
  });

  it("vault unlock shows continue setup when setup is incomplete", async () => {
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("setup_incomplete"));

    render(<VaultUnlockPage />);
    expect(await screen.findByText("Complete your vault setup")).toBeTruthy();
    expect(screen.queryByLabelText(/vault password/i)).toBeNull();
  });

  it("vault unlock hides passkey when no passkey envelope exists", async () => {
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue(
      mockClientStatus("locked", {
        availableUnlockMethods: { password: true, recoveryPhrase: true, passkey: false },
        hasPasskey: false,
      })
    );

    render(<VaultUnlockPage />);
    expect(await screen.findByText(/Unlock SelahKeep/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /unlock with passkey/i })).toBeNull();
  });

  it("vault unlock shows passkey when passkey envelope exists", async () => {
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue(
      mockClientStatus("locked", {
        availableUnlockMethods: { password: true, recoveryPhrase: true, passkey: true },
        hasPasskey: true,
      })
    );

    render(<VaultUnlockPage />);
    expect(await screen.findByTestId("vault-unlock-panel")).toBeTruthy();
    expect(screen.getByRole("button", { name: /unlock with passkey/i })).toBeTruthy();
  });

  it("vault unlock still shows recovery phrase when vault is locked", async () => {
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("locked"));

    render(<VaultUnlockPage />);
    expect(await screen.findByRole("tab", { name: /^recovery phrase$/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /^vault password$/i })).toBeTruthy();
  });

  it("vault unlock shows already unlocked state when vault is unlocked", async () => {
    render(<VaultStatusPrompt clientStatus="unlocked" context="unlock" />);
    expect(screen.getByText("Your vault is already unlocked")).toBeTruthy();
    expect(screen.getByRole("link", { name: /go to notes/i }).getAttribute("href")).toBe("/notes");
  });
});

describe("nav vault status dock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not show vault dock before vault is configured", async () => {
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("not_configured"));

    render(
      <SiteShell>
        <HomePage />
      </SiteShell>
    );

    const header = screen.getByRole("banner");
    expect(within(header).queryByRole("link", { name: /set up vault/i })).toBeNull();
    expect(screen.queryByTestId("vault-status-dock")).toBeNull();
    expect(screen.queryByTestId("vault-status-dock-handle")).toBeNull();
  });

  it("does not show vault dock when setup is incomplete", async () => {
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("setup_incomplete"));

    render(
      <SiteShell>
        <HomePage />
      </SiteShell>
    );

    expect(screen.queryByLabelText(/vault password/i)).toBeNull();
  });

  it("shows unlock vault in status bar when vault is locked", async () => {
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("locked"));

    render(
      <SiteShell>
        <HomePage />
      </SiteShell>
    );

    // The dock renders once in the desktop toolbar and once in the mobile
    // header row, so scope to the toolbar's copy for a single unique match.
    const toolbar = within(screen.getByRole("banner")).getByTestId("header-toolbar-row");
    const handle = within(toolbar).getByTestId("vault-status-dock-handle");
    expect(handle).toBeTruthy();
    fireEvent.click(within(toolbar).getByRole("button", { name: /expand vault status/i }));
    const dock = within(toolbar).getByTestId("vault-status-dock");
    expect(within(dock).getByLabelText(/vault password/i)).toBeTruthy();
    expect(within(dock).queryByRole("tab", { name: /recovery phrase/i })).toBeNull();
    expect(
      within(screen.getByRole("banner")).queryByRole("link", { name: /unlock vault/i })
    ).toBeNull();
  });

  it("shows lock now in status bar when vault is unlocked", async () => {
    const browser = await import("@tgoliveira/vault-core/browser");
    const { generateUserVaultKey } = await import("@/lib/crypto-client/vault");
    const extractableKey = await generateUserVaultKey();
    const raw = await crypto.subtle.exportKey("raw", extractableKey);
    const sessionKey = await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    await browser.unlockVaultSession(sessionKey);

    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("unlocked"));

    try {
      render(
        <SiteShell>
          <HomePage />
        </SiteShell>
      );

      const toolbar = within(screen.getByRole("banner")).getByTestId("header-toolbar-row");
      fireEvent.click(within(toolbar).getByRole("button", { name: /expand vault status/i }));
      const dock = within(toolbar).getByTestId("vault-status-dock");
      expect(within(dock).getByText(/Auto-locks in/i)).toBeTruthy();
      expect(within(dock).getByRole("button", { name: /lock now/i })).toBeTruthy();
      expect(within(screen.getByRole("banner")).queryByRole("button", { name: /^lock vault$/i })).toBeNull();
    } finally {
      browser.lockVaultSession();
    }
  });

  it("does not render private letters copy in vault status bar", async () => {
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("locked"));

    render(
      <SiteShell>
        <HomePage />
      </SiteShell>
    );

    expect(screen.queryByText(/private letters/i)).toBeNull();
    expect(screen.queryByText(/use recovery code/i)).toBeNull();
    expect(screen.queryByText(/unlock to read this letter/i)).toBeNull();
  });
});
