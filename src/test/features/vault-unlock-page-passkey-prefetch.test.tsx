import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VaultUnlockPage from "@/app/(vault)/vault/unlock/page";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  unlockFromPasskey: vi.fn(),
  prefetchedOptions: {
    challenge: "prefetched-challenge",
    rpId: "example.com",
    allowCredentials: [{ id: "credential-1", type: "public-key" as const }],
    userVerification: "required" as const,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/application-state-provider", () => ({
  useApplicationState: () => ({ ownerId: "user-1" }),
}));

vi.mock("@/components/browser-capabilities-provider", () => ({
  useBrowserCapabilities: () => ({ passkeyPrf: { status: "supported" } }),
}));

vi.mock("@/features/vault/use-vault-client-status", () => ({
  useVaultClientStatus: () => ({
    status: "ready",
    clientStatus: "locked",
    serverStatus: {
      initialized: true,
      hasVault: true,
      setupPhase: "complete",
      setupComplete: true,
      vaultVersion: "vault-v2",
      hasVaultPassword: true,
      availableUnlockMethods: { password: true, recoveryPhrase: true, passkey: true },
      hasPasskey: true,
      passkeyUnlockAvailableOnThisDevice: false,
    },
  }),
}));

vi.mock("@/features/vault/use-vault", () => ({
  useVault: () => ({
    loading: false,
    error: null,
    unlockFromPasskey: mocks.unlockFromPasskey,
    unlockFromRecoveryCode: vi.fn(),
    unlockFromVaultPassword: vi.fn(),
    unlockFromRecoveryPhrase: vi.fn(),
  }),
}));

vi.mock("@/features/passkey/use-vault-passkey-unlock-prefetch", () => ({
  useVaultPasskeyUnlockPrefetch: () => ({
    prefetch: {
      options: mocks.prefetchedOptions,
      credentialId: "credential-1",
    },
    refresh: mocks.refresh,
  }),
}));

vi.mock("@tgoliveira/vault-core/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tgoliveira/vault-core/react")>();
  return {
    ...actual,
    useVaultUnlockPageNavigation: vi.fn(),
    VaultUnlockPanel: ({
      onUnlockPasskey,
    }: {
      onUnlockPasskey?: () => void | Promise<void>;
    }) => (
      <button type="button" onClick={() => void onUnlockPasskey?.()}>
        Unlock with passkey
      </button>
    ),
  };
});

describe("full-page explicit passkey prefetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.unlockFromPasskey.mockResolvedValue({});
  });

  it("uses prefetched options in the click path without a network refresh or binding", async () => {
    render(<VaultUnlockPage />);
    fireEvent.click(screen.getByRole("button", { name: /unlock with passkey/i }));

    await waitFor(() =>
      expect(mocks.unlockFromPasskey).toHaveBeenCalledWith(
        mocks.prefetchedOptions,
        "credential-1"
      )
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith("/notes");
  });
});
