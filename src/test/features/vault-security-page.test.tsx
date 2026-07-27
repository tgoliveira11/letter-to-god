import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import VaultSecurityPage from "@/app/(vault)/vault/security/page";
import VaultSettingsPage from "@/app/(vault)/vault/settings/page";
import { useRequireVault } from "@/features/vault/use-require-vault";
import { useVaultClientStatus } from "@/features/vault/use-vault-client-status";
import { requestVaultDockExpand } from "@tgoliveira/vault-core/react";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })),
}));

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: { user: { id: "user-1" } },
    status: "authenticated",
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

vi.mock("@/features/vault/vault-security-review", () => ({
  VaultSecurityReview: () => <div data-testid="vault-security-review" />,
}));

vi.mock("@tgoliveira/vault-core/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tgoliveira/vault-core/react")>();
  return { ...actual, requestVaultDockExpand: vi.fn() };
});

vi.mock("@/features/passkey/passkey-vault-unlock-setup", () => ({
  PasskeyVaultUnlockSetup: () => <div data-testid="passkey-vault-unlock-setup" />,
}));

vi.mock("@/features/notes/use-vault-settings", () => ({
  useVaultSettings: vi.fn(() => ({
    settings: { unlockBehavior: "metadata_only" },
    loading: false,
    error: null,
    updateUnlockBehavior: vi.fn(),
  })),
}));

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
      availableUnlockMethods:
        clientStatus === "locked" || clientStatus === "unlocked"
          ? { password: true, recoveryPhrase: true, passkey: false }
          : undefined,
      ...serverOverrides,
    },
    recheck: vi.fn(),
  };
}

describe("VaultSecurityPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows setup CTA when vault is not configured", () => {
    vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(false));
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("not_configured"));

    render(<VaultSecurityPage />);

    expect(screen.getByRole("heading", { name: /vault security/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /set up vault/i }).getAttribute("href")).toBe(
      "/vault/setup"
    );
    expect(screen.queryByTestId("vault-security-review")).toBeNull();
  });

  it("shows continue setup CTA when setup is incomplete", () => {
    vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(false));
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("setup_incomplete"));

    render(<VaultSecurityPage />);

    expect(screen.getByRole("link", { name: /continue setup/i }).getAttribute("href")).toBe(
      "/vault/setup"
    );
  });

  it("shows locked state with unlock CTA and partial overview", () => {
    vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(false));
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("locked"));

    render(<VaultSecurityPage />);

    expect(screen.getByText(/unlock your vault to run security checks/i)).toBeTruthy();
    expect(screen.getByText(/protection overview \(vault closed\)/i)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /open full unlock page/i }).getAttribute("href")
    ).toBe("/vault/unlock?next=%2Fvault%2Fsecurity");
    fireEvent.click(screen.getByRole("button", { name: /unlock here/i }));
    expect(requestVaultDockExpand).toHaveBeenCalled();
    expect(screen.queryByTestId("vault-security-review")).toBeNull();
  });

  it("shows full security review when vault is unlocked", () => {
    vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(true));
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("unlocked"));

    render(<VaultSecurityPage />);

    expect(screen.getByTestId("vault-security-review")).toBeTruthy();
  });
});

describe("Vault settings security review link", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(true));
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("unlocked"));
  });

  it("links to /vault/security from unlocked settings", () => {
    render(<VaultSettingsPage />);

    expect(screen.getByText(/vault security review/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /open security review/i }).getAttribute("href")).toBe(
      "/vault/security"
    );
  });
});
