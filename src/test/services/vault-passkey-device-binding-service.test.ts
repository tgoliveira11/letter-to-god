import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  findByIdForUser: vi.fn(),
  findByIdForUserCredential: vi.fn(),
  findActivePasskeyEnvelopeVariants: vi.fn(),
}));

vi.mock("@/server/repositories/vault-passkey-device-binding-repository", () => ({
  vaultPasskeyDeviceBindingRepository: {
    findByIdForUser: mocks.findByIdForUser,
  },
}));

vi.mock("@/server/repositories/passkey-repository", () => ({
  passkeyRepository: {
    findByIdForUser: mocks.findByIdForUserCredential,
  },
}));

vi.mock("@/server/repositories/vault-repository", () => ({
  vaultRepository: {
    findActivePasskeyEnvelopeVariants: mocks.findActivePasskeyEnvelopeVariants,
  },
}));

describe("resolvePasskeyUnlockAvailableOnThisDevice", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false without a device binding cookie", async () => {
    const { resolvePasskeyUnlockAvailableOnThisDevice } = await import(
      "@/server/services/vault-passkey-device-binding-service"
    );
    await expect(resolvePasskeyUnlockAvailableOnThisDevice("user-1")).resolves.toBe(false);
    expect(mocks.findByIdForUser).not.toHaveBeenCalled();
  });

  it("returns true when binding matches active credential and envelope", async () => {
    mocks.findByIdForUser.mockResolvedValue({
      id: "binding-1",
      passkeyCredentialId: "cred-db-1",
      selectedEnvelopeVariantId: "env-1",
    });
    mocks.findByIdForUserCredential.mockResolvedValue({
      id: "cred-db-1",
      credentialId: "webauthn-1",
      vaultUnlockEnabled: true,
    });
    mocks.findActivePasskeyEnvelopeVariants.mockResolvedValue([{ id: "env-1" }]);

    const { resolvePasskeyUnlockAvailableOnThisDevice } = await import(
      "@/server/services/vault-passkey-device-binding-service"
    );
    await expect(
      resolvePasskeyUnlockAvailableOnThisDevice("user-1", "binding-1")
    ).resolves.toBe(true);
  });

  it("returns false when binding credential is missing vault unlock", async () => {
    mocks.findByIdForUser.mockResolvedValue({
      id: "binding-1",
      passkeyCredentialId: "cred-db-1",
    });
    mocks.findByIdForUserCredential.mockResolvedValue({
      id: "cred-db-1",
      credentialId: "webauthn-1",
      vaultUnlockEnabled: false,
    });

    const { resolvePasskeyUnlockAvailableOnThisDevice } = await import(
      "@/server/services/vault-passkey-device-binding-service"
    );
    await expect(
      resolvePasskeyUnlockAvailableOnThisDevice("user-1", "binding-1")
    ).resolves.toBe(false);
  });
});
