import { beforeEach, describe, expect, it, vi } from "vitest";
import { getVaultPasskeyLoginAuthenticationExtensions } from "@/server/services/passkey-login-vault-extension-service";

const mocks = vi.hoisted(() => ({
  findByUserId: vi.fn(),
  buildExtensions: vi.fn(),
}));

vi.mock("@/server/repositories/passkey-repository", () => ({
  passkeyRepository: { findByUserId: mocks.findByUserId },
}));

vi.mock("@tgoliveira/vault-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tgoliveira/vault-core")>()),
  buildPasskeyPrfAuthenticationExtensionsJson: mocks.buildExtensions,
}));

describe("secure-auth vault PRF login extension callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildExtensions.mockResolvedValue({
      prf: { eval: { first: "public-salt" } },
    });
  });

  it("returns package-built JSON extensions for an allowed dual-capability credential", async () => {
    mocks.findByUserId.mockResolvedValue([
      { credentialId: "credential-1", vaultUnlockEnabled: true },
    ]);

    await expect(
      getVaultPasskeyLoginAuthenticationExtensions({
        userId: "user-1",
        credentialIds: ["credential-1"],
      })
    ).resolves.toEqual({ prf: { eval: { first: "public-salt" } } });

    expect(mocks.buildExtensions).toHaveBeenCalledWith(
      "letters-passkey-prf-v1:",
      "user-1"
    );
  });

  it("does not add PRF input for account-only or out-of-allow-list credentials", async () => {
    mocks.findByUserId.mockResolvedValue([
      { credentialId: "account-only", vaultUnlockEnabled: false },
      { credentialId: "other-vault", vaultUnlockEnabled: true },
    ]);

    await expect(
      getVaultPasskeyLoginAuthenticationExtensions({
        userId: "user-1",
        credentialIds: ["account-only"],
      })
    ).resolves.toBeUndefined();

    expect(mocks.buildExtensions).not.toHaveBeenCalled();
  });
});
