import { describe, it, expect, vi, beforeEach } from "vitest";
import { passkeyVaultEnvelopeService } from "@/server/services/passkey-vault-envelope-service";
import { encryptedPayload, USER_ID } from "@/test/helpers/fixtures";

const mocks = vi.hoisted(() => ({
  findByIdForUser: vi.fn(),
  consumeValidChallenge: vi.fn(),
  lockForVaultMutation: vi.fn(),
  updateCredentialFlags: vi.fn(),
  revoke: vi.fn(),
  findActivePasskeyEnvelopeVariant: vi.fn(),
  revokePasskeyEnvelopeVariants: vi.fn(),
  deleteAllByPasskeyCredentialId: vi.fn(),
  record: vi.fn(),
  storeChallenge: vi.fn(),
  findActivePasskeyEnvelopeVariants: vi.fn(),
  createEnvelope: vi.fn(),
}));

vi.mock("@/server/repositories/passkey-repository", () => ({
  passkeyRepository: {
    findByIdForUser: mocks.findByIdForUser,
    consumeValidChallenge: mocks.consumeValidChallenge,
    lockForVaultMutation: mocks.lockForVaultMutation,
    updateCredentialFlags: mocks.updateCredentialFlags,
    revoke: mocks.revoke,
    storeChallenge: mocks.storeChallenge,
  },
}));

vi.mock("@/server/repositories/vault-repository", () => ({
  vaultRepository: {
    findActivePasskeyEnvelopeVariant: mocks.findActivePasskeyEnvelopeVariant,
    revokePasskeyEnvelopeVariants: mocks.revokePasskeyEnvelopeVariants,
    findActivePasskeyEnvelopeVariants: mocks.findActivePasskeyEnvelopeVariants,
    createEnvelope: mocks.createEnvelope,
  },
}));

vi.mock("@/server/repositories/audit-repository", () => ({
  auditRepository: { record: mocks.record },
}));

vi.mock("@/server/repositories/vault-passkey-device-binding-repository", () => ({
  vaultPasskeyDeviceBindingRepository: {
    deleteAllByPasskeyCredentialId: mocks.deleteAllByPasskeyCredentialId,
  },
}));

const proof = {
  bindingProof: "opaque-binding-proof-value",
  verifiedCredentialId: "vault-cred",
  selectedEnvelopeVariantId: "env-1",
};

describe("passkey vault lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeValidChallenge.mockResolvedValue({ challenge: proof.bindingProof });
    mocks.findActivePasskeyEnvelopeVariant.mockResolvedValue({ id: "env-1" });
    mocks.revokePasskeyEnvelopeVariants.mockResolvedValue(["env-1", "env-2"]);
    mocks.deleteAllByPasskeyCredentialId.mockResolvedValue(["binding-1", "binding-2"]);
    mocks.findActivePasskeyEnvelopeVariants.mockResolvedValue([]);
    mocks.createEnvelope.mockResolvedValue({ id: "550e8400-e29b-41d4-a716-446655440001" });
  });

  it("atomically disables a vault-only credential, all variants, and all bindings", async () => {
    mocks.findByIdForUser.mockResolvedValue({
      id: "db-vault",
      userId: "user-1",
      credentialId: "vault-cred",
      signInEnabled: false,
      vaultUnlockEnabled: true,
    });

    const result = await passkeyVaultEnvelopeService.disableVaultUnlockWithProof(
      "user-1",
      "db-vault",
      proof
    );

    expect(mocks.lockForVaultMutation).toHaveBeenCalledWith(
      "db-vault",
      "user-1",
      expect.anything()
    );
    expect(mocks.revokePasskeyEnvelopeVariants).toHaveBeenCalledWith(
      "user-1",
      "db-vault",
      "vault-cred",
      expect.anything()
    );
    expect(mocks.deleteAllByPasskeyCredentialId).toHaveBeenCalledWith(
      "db-vault",
      "user-1",
      expect.anything()
    );
    expect(mocks.revoke).toHaveBeenCalledWith("db-vault", "user-1", expect.anything());
    expect(mocks.updateCredentialFlags).not.toHaveBeenCalled();
    expect(result.removedBindingIds).toEqual(["binding-1", "binding-2"]);
  });

  it("keeps a dual-purpose sign-in credential while clearing vault capability", async () => {
    mocks.findByIdForUser.mockResolvedValue({
      id: "db-dual",
      userId: "user-1",
      credentialId: "vault-cred",
      signInEnabled: true,
      vaultUnlockEnabled: true,
    });

    await passkeyVaultEnvelopeService.disableVaultUnlockWithProof(
      "user-1",
      "db-dual",
      proof
    );

    expect(mocks.updateCredentialFlags).toHaveBeenCalledWith(
      "db-dual",
      "user-1",
      { vaultUnlockEnabled: false },
      expect.anything()
    );
    expect(mocks.revoke).not.toHaveBeenCalled();
  });

  it("does not update credential state or audit when variant revocation fails", async () => {
    mocks.findByIdForUser.mockResolvedValue({
      id: "db-dual",
      userId: "user-1",
      credentialId: "vault-cred",
      signInEnabled: true,
      vaultUnlockEnabled: true,
    });
    mocks.revokePasskeyEnvelopeVariants.mockRejectedValue(new Error("database failure"));

    await expect(
      passkeyVaultEnvelopeService.disableVaultUnlockWithProof("user-1", "db-dual", proof)
    ).rejects.toThrow("database failure");
    expect(mocks.deleteAllByPasskeyCredentialId).not.toHaveBeenCalled();
    expect(mocks.updateCredentialFlags).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("fails closed at the active variant cap while holding the credential lock", async () => {
    mocks.findByIdForUser.mockResolvedValue({
      id: "db-synced",
      userId: USER_ID,
      credentialId: "synced-credential",
    });
    mocks.findActivePasskeyEnvelopeVariants.mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({ id: `variant-${index}` }))
    );

    await expect(
      passkeyVaultEnvelopeService.persistVaultUnlockEnvelope(
        USER_ID,
        "db-synced",
        "enrollment-proof",
        encryptedPayload("vault_key", USER_ID),
        { prfSupported: true }
      )
    ).rejects.toThrow("active envelope variant limit");

    expect(mocks.lockForVaultMutation.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.findActivePasskeyEnvelopeVariants.mock.invocationCallOrder[0]
    );
    expect(mocks.createEnvelope).not.toHaveBeenCalled();
    expect(mocks.updateCredentialFlags).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("appends a new variant without revoking a known-good variant", async () => {
    mocks.findByIdForUser.mockResolvedValue({
      id: "db-synced",
      userId: USER_ID,
      credentialId: "synced-credential",
    });
    mocks.findActivePasskeyEnvelopeVariants.mockResolvedValue(
      Array.from({ length: 4 }, (_, index) => ({ id: `variant-${index}` }))
    );

    const result = await passkeyVaultEnvelopeService.persistVaultUnlockEnvelope(
      USER_ID,
      "db-synced",
      "enrollment-proof",
      encryptedPayload("vault_key", USER_ID),
      { prfSupported: true }
    );

    expect(mocks.createEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        passkeyCredentialId: "db-synced",
        method: "passkey_authorized_device",
      }),
      expect.anything()
    );
    expect(mocks.revokePasskeyEnvelopeVariants).not.toHaveBeenCalled();
    expect(result.envelopeVariantId).toBe("550e8400-e29b-41d4-a716-446655440001");
  });
});
