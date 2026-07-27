import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import { SiteShell } from "@/components/layout/site-shell";
import HomePage from "@/app/(public)/page";
import { VaultStatusDock } from "@/features/vault/vault-status-dock";
import {
  getDefaultVaultStatusDockExpanded,
  getVaultStatusDockExpandedCopy,
  getVaultStatusDockHandleLabel,
  vaultStatusDockAutoCollapseWhenExpanded,
} from "@/features/vault/vault-status-dock-copy";
import {
  readVaultStatusDockCollapsedPreference,
  VAULT_STATUS_DOCK_COLLAPSED_KEY,
  writeVaultStatusDockCollapsedPreference,
} from "@/features/vault/vault-status-dock-preference";
import { lockVaultSessionManually, touchVaultSession } from "@/lib/crypto-client/vault-session";

const unlockFromVaultPassword = vi.fn();
const unlockFromPasskey = vi.fn();
const coreVaultStatusDock = vi.fn();

vi.mock("@tgoliveira/vault-core/react", () => ({
  VaultStatusDock: (props: Record<string, unknown>) => coreVaultStatusDock(props),
  VaultDockQuickUnlock: () => <div data-testid="vault-dock-quick-unlock" />,
  createVaultFullUnlockPageMatcher: () => () => false,
  VaultLockOverlayExclude: ({ children }: { children: React.ReactNode }) => children,
  VaultProtectedGate: ({ children }: { children: React.ReactNode }) => children,
  requestVaultDockExpand: vi.fn(),
}));

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

vi.mock("@/features/vault/use-vault", () => ({
  useVault: vi.fn(() => ({
    loading: false,
    error: null,
    unlockFromVaultPassword,
    unlockFromPasskey,
  })),
}));

vi.mock("@/features/vault/vault-dock-passkey-availability", () => ({
  useVaultDockPasskeyAvailable: vi.fn(() => ({
    hasEnvelope: false,
    showPasskey: false,
    prfExplicitlyUnsupported: false,
  })),
}));

vi.mock("@/features/passkey/use-vault-passkey-unlock-prefetch", () => ({
  useVaultPasskeyUnlockPrefetch: vi.fn(() => ({
    options: null,
    refresh: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock("@/features/vault/use-vault-client-status", () => ({
  useVaultClientStatus: vi.fn(() => ({
    status: "ready",
    clientStatus: "locked",
    setupPhase: "complete",
    serverStatus: {
      initialized: true,
      setupPhase: "complete",
      setupComplete: true,
      vaultVersion: "vault-v2",
      ltgSetupComplete: true,
      hasVaultPassword: true,
      availableUnlockMethods: { password: true, recoveryPhrase: true, passkey: false },
    },
    recheck: vi.fn(),
  })),
}));

vi.mock("@/lib/crypto-client/vault-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crypto-client/vault-session")>();
  return {
    ...actual,
    lockVaultSessionManually: vi.fn(),
    touchVaultSession: vi.fn(),
  };
});

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
      setupComplete: clientStatus === "locked" || clientStatus === "unlocked",
      vaultVersion: "vault-v2" as const,
      ltgSetupComplete: true,
      hasVaultPassword: true,
      availableUnlockMethods: {
        password: true,
        recoveryPhrase: true,
        passkey: false,
      },
    },
    recheck: vi.fn(),
  };
}

const preferenceStore = new Map<string, string>();

function installLocalStorageStub() {
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => preferenceStore.get(key) ?? null,
    setItem: (key: string, value: string) => {
      preferenceStore.set(key, value);
    },
    removeItem: (key: string) => {
      preferenceStore.delete(key);
    },
    clear: () => {
      preferenceStore.clear();
    },
  });
}

describe("vault status dock copy", () => {
  it("defaults collapsed for all visible dock states", () => {
    expect(getDefaultVaultStatusDockExpanded("not_configured")).toBe(false);
    expect(getDefaultVaultStatusDockExpanded("locked")).toBe(false);
    expect(vaultStatusDockAutoCollapseWhenExpanded("locked")).toBe(true);
    expect(vaultStatusDockAutoCollapseWhenExpanded("not_configured")).toBe(false);
  });

  it("formats compact handle labels and expanded copy", () => {
    expect(getVaultStatusDockHandleLabel("locked", null)).toBe("Vault");
    expect(getVaultStatusDockHandleLabel("unlocked", "14:32")).toBe("14:32");
    expect(getVaultStatusDockExpandedCopy("locked", null).title).toBe("Vault closed");
    expect(getVaultStatusDockExpandedCopy("unlocked", "14:32").countdownInline).toBe(
      "Auto-locks in 14:32"
    );
  });
});

describe("VaultStatusDock", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    preferenceStore.clear();
    installLocalStorageStub();
    unlockFromVaultPassword.mockResolvedValue(undefined);
    unlockFromPasskey.mockResolvedValue(undefined);
    coreVaultStatusDock.mockImplementation(({ onLock, onStayUnlocked, visible }) =>
      visible ? (
        <div data-testid="core-vault-status-dock">
          <button type="button" onClick={onLock as () => void}>
            Lock now
          </button>
          <button type="button" onClick={onStayUnlocked as () => void}>
            Stay unlocked
          </button>
        </div>
      ) : null
    );

    const { useSession } = await import("next-auth/react");
    const { usePathname } = await import("next/navigation");
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(usePathname).mockReturnValue("/notes");
    vi.mocked(useSession).mockReturnValue({
      data: { user: { id: "user-1", email: "user@example.com" } },
      status: "authenticated",
      update: vi.fn(),
    });
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("locked"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("delegates to vault-core VaultStatusDock when authenticated and ready", () => {
    render(<VaultStatusDock />);
    expect(screen.getByTestId("core-vault-status-dock")).toBeTruthy();
    expect(coreVaultStatusDock).toHaveBeenCalledWith(
      expect.objectContaining({
        visible: true,
        unlockPath: "/vault/unlock",
        quickUnlockEnabled: true,
      })
    );
  });

  it("returns null before vault client status is ready", async () => {
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue({
      status: "loading",
      clientStatus: "locked",
      setupPhase: "complete",
      serverStatus: null,
      recheck: vi.fn(),
    });

    render(<VaultStatusDock />);
    expect(screen.queryByTestId("core-vault-status-dock")).toBeNull();
  });

  it("returns null when unauthenticated", async () => {
    const { useSession } = await import("next-auth/react");
    vi.mocked(useSession).mockReturnValue({
      data: null,
      status: "unauthenticated",
      update: vi.fn(),
    });

    render(<VaultStatusDock />);
    expect(screen.queryByTestId("core-vault-status-dock")).toBeNull();
  });

  it("wires lock and stay-unlocked callbacks to session helpers", () => {
    render(<VaultStatusDock />);
    fireEvent.click(screen.getByRole("button", { name: /lock now/i }));
    fireEvent.click(screen.getByRole("button", { name: /stay unlocked/i }));
    expect(lockVaultSessionManually).toHaveBeenCalledTimes(1);
    expect(touchVaultSession).toHaveBeenCalledTimes(1);
  });

  it("disables quick unlock when vault is not configured", async () => {
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("not_configured"));

    render(<VaultStatusDock />);
    expect(coreVaultStatusDock).toHaveBeenCalledWith(
      expect.objectContaining({ quickUnlockEnabled: false })
    );
  });

  it("renders dock inside authenticated header when vault is configured", async () => {
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("locked"));

    render(
      <SiteShell>
        <HomePage />
      </SiteShell>
    );
    const header = screen.getByRole("banner");
    // The dock renders once in the desktop toolbar and once in the mobile
    // header row.
    expect(within(header).getAllByTestId("core-vault-status-dock").length).toBeGreaterThan(0);
  });

  it("stores only UI collapse preference", () => {
    writeVaultStatusDockCollapsedPreference(true);
    expect(localStorage.getItem(VAULT_STATUS_DOCK_COLLAPSED_KEY)).toBe("true");
    expect(readVaultStatusDockCollapsedPreference()).toBe(true);
  });
});
