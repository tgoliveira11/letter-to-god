import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import { VaultStatusDock } from "@/features/vault/vault-status-dock";

const unlockFromVaultPassword = vi.fn();
const unlockFromPasskey = vi.fn();
const fetchSpy = vi.fn();

const refreshPasskeyOptions = vi.fn();

vi.mock("@/features/passkey/use-vault-passkey-unlock-prefetch", () => ({
  useVaultPasskeyUnlockPrefetch: vi.fn(() => ({
    options: null,
    refresh: refreshPasskeyOptions,
  })),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })),
  usePathname: vi.fn(() => "/settings/account"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: { user: { id: "user-1", email: "user@example.com" } },
    status: "authenticated",
    update: vi.fn(),
  })),
}));

vi.mock("@/features/vault/use-vault-client-status", () => ({
  useVaultClientStatus: vi.fn(),
}));

vi.mock("@/features/vault/use-vault", () => ({
  useVault: vi.fn(),
}));

vi.mock("@/features/vault/vault-dock-passkey-availability", () => ({
  useVaultDockPasskeyAvailable: vi.fn(() => ({
    hasEnvelope: false,
    showPasskey: false,
    prfExplicitlyUnsupported: false,
  })),
}));

vi.mock("@/lib/crypto-client/vault", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crypto-client/vault")>();
  return {
    ...actual,
    hasUnlockedVaultSession: vi.fn(() => false),
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

function mockClientStatus(passkey = false) {
  return {
    status: "ready" as const,
    clientStatus: "locked" as const,
    setupPhase: "complete" as const,
    serverStatus: {
      initialized: true,
      setupPhase: "complete",
      setupComplete: true,
      vaultVersion: "vault-v2" as const,
      ltgSetupComplete: true,
      hasVaultPassword: true,
      availableUnlockMethods: {
        password: true,
        recoveryPhrase: true,
        passkey,
      },
    },
    recheck: vi.fn(),
  };
}

async function renderExpandedDock(
  vaultOverrides: {
    loading?: boolean;
    error?: string | null;
    passkey?: boolean;
    pathname?: string;
    passkeyAvailability?: {
      hasEnvelope: boolean;
      showPasskey: boolean;
      prfExplicitlyUnsupported: boolean;
    };
  } = {}
) {
  const { usePathname } = await import("next/navigation");
  const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
  const { useVault } = await import("@/features/vault/use-vault");
  const { useVaultDockPasskeyAvailable } = await import(
    "@/features/vault/vault-dock-passkey-availability"
  );

  vi.mocked(usePathname).mockReturnValue(vaultOverrides.pathname ?? "/settings/account");
  vi.mocked(useVaultClientStatus).mockReturnValue(
    mockClientStatus(vaultOverrides.passkey ?? false)
  );
  vi.mocked(useVault).mockReturnValue({
    loading: vaultOverrides.loading ?? false,
    error: vaultOverrides.error ?? null,
    unlockFromVaultPassword,
    unlockFromRecoveryPhrase: vi.fn(),
    unlockFromPasskey,
    unlockFromRecoveryCode: vi.fn(),
    lockVault: vi.fn(),
  });
  vi.mocked(useVaultDockPasskeyAvailable).mockReturnValue(
    vaultOverrides.passkeyAvailability ?? {
      hasEnvelope: vaultOverrides.passkey ?? false,
      showPasskey: vaultOverrides.passkey ?? false,
      prfExplicitlyUnsupported: false,
    }
  );

  render(<VaultStatusDock />);
  fireEvent.click(screen.getByRole("button", { name: /expand vault status/i }));
}

describe("vault status dock inline unlock security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchSpy);
    unlockFromVaultPassword.mockResolvedValue(undefined);
    unlockFromPasskey.mockResolvedValue(undefined);
    refreshPasskeyOptions.mockResolvedValue({
      options: {
        challenge: "abc",
        allowCredentials: [{ id: "cred-1", type: "public-key" }],
      },
      credentialId: "cred-1",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not POST vault password to the server during inline unlock", async () => {
    await renderExpandedDock();
    fireEvent.change(screen.getByLabelText(/vault password/i), {
      target: { value: "SENTINEL-PRIVATE-LETTER-DO-NOT-STORE-PLAINTEXT-12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^unlock vault$/i }));

    expect(unlockFromVaultPassword).toHaveBeenCalledWith(
      "SENTINEL-PRIVATE-LETTER-DO-NOT-STORE-PLAINTEXT-12345"
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    const { useRouter } = await import("next/navigation");
    expect(vi.mocked(useRouter)().push).not.toHaveBeenCalled();
  });

  it("does not render recovery phrase tab or input in the dock", async () => {
    await renderExpandedDock();
    expect(screen.queryByRole("tab", { name: /recovery phrase/i })).toBeNull();
    expect(screen.queryByLabelText(/recovery phrase/i)).toBeNull();
  });

  it("shows passkey unlock only when configured and PRF is available", async () => {
    const { isPrfExtensionSupported } = await import("@tgoliveira/vault-core/browser");
    if (!isPrfExtensionSupported()) {
      return;
    }

    await renderExpandedDock({
      passkey: true,
      passkeyAvailability: {
        hasEnvelope: true,
        showPasskey: true,
        prfExplicitlyUnsupported: false,
      },
    });
    expect(screen.getByRole("button", { name: /unlock with passkey/i })).toBeTruthy();
    expect(screen.queryByLabelText(/vault password/i)).toBeNull();
    expect(screen.queryByRole("tab", { name: /^passkey$/i })).toBeNull();
  });

  it("shows passkey unavailable state without password fallback when envelope exists", async () => {
    await renderExpandedDock({
      passkey: true,
      passkeyAvailability: {
        hasEnvelope: true,
        showPasskey: false,
        prfExplicitlyUnsupported: true,
      },
    });
    expect(screen.queryByRole("tab", { name: /^passkey$/i })).toBeNull();
    expect(screen.queryByLabelText(/vault password/i)).toBeNull();
    expect(screen.getByText(/passkey unlock is unavailable in this browser/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /open full unlock page/i })).toBeTruthy();
  });

  it("keeps dock expanded when unlock error is shown", async () => {
    await renderExpandedDock({ error: "That password didn't unlock your vault." });
    expect(screen.getByText(/that password didn't unlock your vault/i)).toBeTruthy();
    expect(screen.getByTestId("vault-status-dock")).toBeTruthy();
  });

  it("never renders note title, body, category, or tag in the dock", async () => {
    await renderExpandedDock();
    const dock = screen.getByTestId("vault-status-dock");
    expect(dock.textContent).not.toMatch(/category|#tag|note body|private letter/i);
  });

  it("does not mention trusted devices or letters domain", async () => {
    await renderExpandedDock();
    const dock = screen.getByTestId("vault-status-dock");
    expect(dock.textContent?.toLowerCase()).not.toContain("trusted device");
    expect(dock.textContent?.toLowerCase()).not.toContain("letter");
  });

  it("does not redirect when dock passkey unlock is cancelled", async () => {
    const { hasUnlockedVaultSession } = await import("@/lib/crypto-client/vault");
    vi.mocked(hasUnlockedVaultSession).mockReturnValue(false);
    unlockFromPasskey.mockRejectedValue(new Error("Passkey unlock was cancelled."));
    const { useRouter } = await import("next/navigation");
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push, replace: vi.fn(), back: vi.fn() });

    const { isPrfExtensionSupported } = await import("@tgoliveira/vault-core/browser");
    if (!isPrfExtensionSupported()) {
      return;
    }

    await renderExpandedDock({
      passkey: true,
      pathname: "/vault/settings",
      passkeyAvailability: {
        hasEnvelope: true,
        showPasskey: true,
        prfExplicitlyUnsupported: false,
      },
    });

    await waitFor(() => expect(refreshPasskeyOptions).toHaveBeenCalled());
    await waitFor(() => expect(unlockFromPasskey).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it("redirects to /vault/unlock when dock passkey unlock fails with a fatal error", async () => {
    const { hasUnlockedVaultSession } = await import("@/lib/crypto-client/vault");
    vi.mocked(hasUnlockedVaultSession).mockReturnValue(false);
    unlockFromPasskey.mockRejectedValue(new Error("Passkey PRF is not supported in this browser."));
    const { useRouter } = await import("next/navigation");
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push, replace: vi.fn(), back: vi.fn() });

    const { isPrfExtensionSupported } = await import("@tgoliveira/vault-core/browser");
    if (!isPrfExtensionSupported()) {
      return;
    }

    await renderExpandedDock({
      passkey: true,
      pathname: "/vault/settings",
      passkeyAvailability: {
        hasEnvelope: true,
        showPasskey: true,
        prfExplicitlyUnsupported: false,
      },
    });

    await waitFor(() => expect(unlockFromPasskey).toHaveBeenCalled());
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/vault/unlock?next=%2Fvault%2Fsettings")
    );
  });

  it("does not redirect when passkey fails but the vault session is already unlocked", async () => {
    const { hasUnlockedVaultSession } = await import("@/lib/crypto-client/vault");
    vi.mocked(hasUnlockedVaultSession).mockReturnValue(true);
    unlockFromPasskey.mockRejectedValue(new Error("Duplicate passkey attempt"));
    const { useRouter } = await import("next/navigation");
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push, replace: vi.fn(), back: vi.fn() });

    const { isPrfExtensionSupported } = await import("@tgoliveira/vault-core/browser");
    if (!isPrfExtensionSupported()) {
      return;
    }

    await renderExpandedDock({
      passkey: true,
      pathname: "/vault/settings",
      passkeyAvailability: {
        hasEnvelope: true,
        showPasskey: true,
        prfExplicitlyUnsupported: false,
      },
    });

    await waitFor(() => expect(unlockFromPasskey).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it("does not redirect to /vault/unlock when dock password unlock fails", async () => {
    unlockFromVaultPassword.mockRejectedValue(new Error("That password didn't unlock your vault."));
    const { useRouter } = await import("next/navigation");
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push, replace: vi.fn(), back: vi.fn() });

    await renderExpandedDock({ pathname: "/vault/settings" });
    fireEvent.change(screen.getByLabelText(/vault password/i), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^unlock vault$/i }));
    await waitFor(() => expect(unlockFromVaultPassword).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByTestId("vault-status-dock")).toBeTruthy();
  });

  it("does not render dock on /vault/unlock", async () => {
    const { usePathname } = await import("next/navigation");
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    const { useVault } = await import("@/features/vault/use-vault");
    vi.mocked(usePathname).mockReturnValue("/vault/unlock");
    vi.mocked(useVaultClientStatus).mockReturnValue(mockClientStatus(false));
    vi.mocked(useVault).mockReturnValue({
      loading: false,
      error: null,
      unlockFromVaultPassword,
      unlockFromRecoveryPhrase: vi.fn(),
      unlockFromPasskey,
      unlockFromRecoveryCode: vi.fn(),
      lockVault: vi.fn(),
    });

    render(<VaultStatusDock />);
    expect(screen.queryByTestId("vault-status-dock-handle")).toBeNull();
    expect(screen.queryByTestId("vault-status-dock")).toBeNull();
    expect(screen.queryByLabelText(/vault password/i)).toBeNull();
  });
});
