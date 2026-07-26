import { describe, it, expect, vi, beforeEach } from "vitest";
import { passkeyService, NotFoundError } from "@/server/services/passkey-service";
import { USER_ID } from "@/test/helpers/fixtures";

const mocks = vi.hoisted(() => ({
  findByUserId: vi.fn(),
  updateCredentialFlags: vi.fn(),
  revoke: vi.fn(),
  lockForVaultMutation: vi.fn(),
  findActiveEnvelopesByUserId: vi.fn(),
  revokeEnvelope: vi.fn(),
  deleteAllByUserId: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/server/repositories/passkey-repository", () => ({
  passkeyRepository: {
    findByUserId: mocks.findByUserId,
    updateCredentialFlags: mocks.updateCredentialFlags,
    revoke: mocks.revoke,
    lockForVaultMutation: mocks.lockForVaultMutation,
  },
}));

vi.mock("@/server/repositories/vault-repository", () => ({
  vaultRepository: {
    findActiveEnvelopesByUserId: mocks.findActiveEnvelopesByUserId,
    revokeEnvelope: mocks.revokeEnvelope,
  },
}));

vi.mock("@/server/repositories/audit-repository", () => ({
  auditRepository: { record: mocks.record },
}));

vi.mock("@/server/repositories/vault-passkey-device-binding-repository", () => ({
  vaultPasskeyDeviceBindingRepository: {
    deleteAllByUserId: mocks.deleteAllByUserId,
  },
}));

describe("passkey removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByUserId.mockResolvedValue([
      {
        id: "cred-vault-only",
        signInEnabled: false,
        vaultUnlockEnabled: true,
      },
      {
        id: "cred-dual",
        signInEnabled: true,
        vaultUnlockEnabled: true,
      },
      {
        id: "cred-sign-in-only",
        signInEnabled: true,
        vaultUnlockEnabled: false,
      },
    ]);
    mocks.findActiveEnvelopesByUserId.mockResolvedValue([
      { id: "env-1", method: "passkey_authorized_device" },
      { id: "env-password", method: "password" },
    ]);
    mocks.deleteAllByUserId.mockResolvedValue(["binding-1", "binding-2"]);
  });

  it("removes every vault capability while preserving account sign-in passkeys", async () => {
    await expect(passkeyService.removeAllVaultUnlockCredentials(USER_ID)).resolves.toEqual({
      success: true,
      removedBindingIds: ["binding-1", "binding-2"],
      removedVaultPasskeyCount: 2,
      preservedSignInPasskeyCount: 1,
    });
    expect(mocks.lockForVaultMutation).toHaveBeenCalledTimes(3);
    expect(mocks.lockForVaultMutation.mock.calls.map(([credentialId]) => credentialId)).toEqual([
      "cred-dual",
      "cred-sign-in-only",
      "cred-vault-only",
    ]);
    expect(mocks.revoke).toHaveBeenCalledWith(
      "cred-vault-only",
      USER_ID,
      expect.anything()
    );
    expect(mocks.updateCredentialFlags).toHaveBeenCalledWith(
      "cred-dual",
      USER_ID,
      { vaultUnlockEnabled: false },
      expect.anything()
    );
    expect(mocks.revoke).not.toHaveBeenCalledWith(
      "cred-sign-in-only",
      USER_ID,
      expect.anything()
    );
    expect(mocks.revokeEnvelope).toHaveBeenCalledWith("env-1", USER_ID, expect.anything());
    expect(mocks.revokeEnvelope).not.toHaveBeenCalledWith(
      "env-password",
      USER_ID,
      expect.anything()
    );
    expect(mocks.deleteAllByUserId).toHaveBeenCalledWith(USER_ID, expect.anything());
    expect(mocks.record).toHaveBeenCalledWith(
      "passkey_removed",
      USER_ID,
      undefined,
      expect.anything()
    );
    expect(mocks.record).toHaveBeenCalledWith(
      "passkey_vault_unlock_disabled",
      USER_ID,
      undefined,
      expect.anything()
    );
  });

  it("throws when no vault unlock passkey or envelope is configured", async () => {
    mocks.findByUserId.mockResolvedValue([]);
    mocks.findActiveEnvelopesByUserId.mockResolvedValue([]);
    await expect(
      passkeyService.removeAllVaultUnlockCredentials(USER_ID)
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("cleans up orphaned passkey envelopes without touching account credentials", async () => {
    mocks.findByUserId.mockResolvedValue([
      {
        id: "cred-sign-in-only",
        signInEnabled: true,
        vaultUnlockEnabled: false,
      },
    ]);

    await expect(passkeyService.removeAllVaultUnlockCredentials(USER_ID)).resolves.toEqual({
      success: true,
      removedBindingIds: ["binding-1", "binding-2"],
      removedVaultPasskeyCount: 0,
      preservedSignInPasskeyCount: 0,
    });
    expect(mocks.lockForVaultMutation).toHaveBeenCalledWith(
      "cred-sign-in-only",
      USER_ID,
      expect.anything()
    );
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(mocks.updateCredentialFlags).not.toHaveBeenCalled();
    expect(mocks.revokeEnvelope).toHaveBeenCalledWith("env-1", USER_ID, expect.anything());
  });
});
