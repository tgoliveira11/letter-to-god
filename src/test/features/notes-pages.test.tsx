import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: { user: { id: "user-1" } },
    status: "authenticated",
  })),
}));
import NotesPage from "@/app/(vault)/notes/page";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() })),
  usePathname: vi.fn(() => "/notes"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

vi.mock("@/features/vault/use-require-vault", () => ({
  useRequireVault: vi.fn(),
}));

vi.mock("@/features/vault/use-vault-client-status", () => ({
  useVaultClientStatus: vi.fn(),
}));

vi.mock("@/lib/api-client/vault", () => ({
  vaultApi: {
    getIndex: vi.fn().mockResolvedValue({ encryptedVaultIndex: null }),
  },
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

describe("notes pages", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { useRequireVault } = await import("@/features/vault/use-require-vault");
    const { useVaultClientStatus } = await import("@/features/vault/use-vault-client-status");
    vi.mocked(useRequireVault).mockReturnValue({
      status: "ready",
      userId: "user-1",
      vaultUnlocked: false,
      recheckVault: vi.fn(),
    });
    vi.mocked(useVaultClientStatus).mockReturnValue({
      status: "ready",
      clientStatus: "locked",
      setupPhase: "complete",
      serverStatus: { initialized: true, setupPhase: "complete" },
      recheck: vi.fn(),
    });
  });

  it("renders notes shell when vault is locked (overlay handled by layout gate)", async () => {
    const replace = vi.fn();
    const { useRouter } = await import("next/navigation");
    vi.mocked(useRouter).mockReturnValue({ push: vi.fn(), replace, back: vi.fn() });

    render(<NotesPage />);
    expect(await screen.findByRole("heading", { name: /^notes$/i })).toBeTruthy();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByTestId("notes-vault-locked-state")).toBeNull();
  });
});
