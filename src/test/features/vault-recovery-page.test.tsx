import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import RecoveryPage from "@/app/(vault)/vault/recovery/page";
import { useRequireVault } from "@/features/vault/use-require-vault";
import { useVaultClientStatus } from "@/features/vault/use-vault-client-status";

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

vi.mock("@/features/recovery/passkey-setup", () => ({
  PasskeySetup: () => <div data-testid="passkey-setup" />,
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
      hasPasskey: false,
      recoveryPhrase:
        clientStatus === "unlocked"
          ? {
              createdAt: "2026-01-15T10:00:00.000Z",
              phraseLength: 12,
            }
          : undefined,
      ...serverOverrides,
    },
    recheck: vi.fn(),
  };
}

describe("RecoveryPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows setup CTA when vault is not configured", () => {
    vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(false));
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("not_configured"));

    render(<RecoveryPage />);

    expect(screen.getByRole("heading", { name: /recovery options/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /set up vault/i }).getAttribute("href")).toBe(
      "/vault/setup"
    );
    expect(screen.queryByText(/generate recovery code/i)).toBeNull();
    expect(screen.queryByText(/do this later/i)).toBeNull();
  });

  it("shows continue setup CTA when setup is incomplete", () => {
    vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(false));
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("setup_incomplete"));

    render(<RecoveryPage />);

    expect(screen.getByRole("link", { name: /continue setup/i }).getAttribute("href")).toBe(
      "/vault/setup"
    );
  });

  it("shows unlock CTA when vault is locked", () => {
    vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(false));
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("locked"));

    render(<RecoveryPage />);

    expect(screen.getByRole("link", { name: /unlock vault/i }).getAttribute("href")).toBe(
      "/vault/unlock?next=%2Fvault%2Frecovery"
    );
  });

  it("shows recovery phrase status and replace action when unlocked", () => {
    vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(true));
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("unlocked"));

    render(<RecoveryPage />);

    expect(screen.getByText(/recovery phrase is configured/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /replace recovery phrase/i })).toBeTruthy();
    expect(screen.getByRole("link", { name: /passkey vault unlock/i }).getAttribute("href")).toBe(
      "/vault/settings"
    );
    expect(screen.queryByTestId("passkey-setup")).toBeNull();
    expect(screen.queryByText(/generate recovery code/i)).toBeNull();
    expect(screen.queryByText(/private letters/i)).toBeNull();
  });

  it("starts replace recovery phrase flow", () => {
    vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(true));
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus("unlocked"));

    render(<RecoveryPage />);

    fireEvent.click(screen.getByRole("button", { name: /replace recovery phrase/i }));

    expect(screen.getByRole("button", { name: /12 words/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /24 words/i })).toBeTruthy();
  });

  it("notes legacy recovery code when present on server status", () => {
    vi.mocked(useRequireVault).mockReturnValue(mockVaultReady(true));
    vi.mocked(useVaultClientStatus).mockReturnValue(
      mockClientStatus("unlocked", { hasRecoveryCode: true })
    );

    render(<RecoveryPage />);

    expect(screen.getByText(/legacy recovery code/i)).toBeTruthy();
  });
});
