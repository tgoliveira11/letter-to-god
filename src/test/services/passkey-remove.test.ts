import { describe, it, expect, vi, beforeEach } from "vitest";
import { passkeyService, NotFoundError } from "@/server/services/passkey-service";
import { USER_ID } from "@/test/helpers/fixtures";

const mocks = vi.hoisted(() => ({
  findByUserId: vi.fn(),
  revokeAllByUserId: vi.fn(),
  lockForVaultMutation: vi.fn(),
  findActiveEnvelopeByMethod: vi.fn(),
  findActiveEnvelopesByUserId: vi.fn(),
  revokeEnvelope: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/server/repositories/passkey-repository", () => ({
  passkeyRepository: {
    findByUserId: mocks.findByUserId,
    revokeAllByUserId: mocks.revokeAllByUserId,
    lockForVaultMutation: mocks.lockForVaultMutation,
  },
}));

vi.mock("@/server/repositories/vault-repository", () => ({
  vaultRepository: {
    findActiveEnvelopeByMethod: mocks.findActiveEnvelopeByMethod,
    findActiveEnvelopesByUserId: mocks.findActiveEnvelopesByUserId,
    revokeEnvelope: mocks.revokeEnvelope,
  },
}));

vi.mock("@/server/repositories/audit-repository", () => ({
  auditRepository: { record: mocks.record },
}));

vi.mock("@/server/repositories/vault-passkey-device-binding-repository", () => ({
  vaultPasskeyDeviceBindingRepository: {
    deleteAllByUserId: vi.fn(),
  },
}));

vi.mock("@/server/repositories/vault-passkey-device-binding-repository", () => ({
  vaultPasskeyDeviceBindingRepository: {
    deleteAllByUserId: vi.fn(async () => undefined),
  },
}));

describe("passkey removal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByUserId.mockResolvedValue([{ id: "cred-1" }]);
    mocks.findActiveEnvelopeByMethod.mockResolvedValue({ id: "env-1" });
    mocks.findActiveEnvelopesByUserId.mockResolvedValue([
      { id: "env-1", method: "passkey_authorized_device" },
    ]);
    mocks.revokeAllByUserId.mockResolvedValue([{ id: "cred-1" }]);
  });

  it("revokes credentials, envelopes, and records audit event", async () => {
    await expect(passkeyService.removeAll(USER_ID)).resolves.toEqual({ success: true });
    expect(mocks.revokeAllByUserId).toHaveBeenCalledWith(USER_ID, expect.anything());
    expect(mocks.revokeEnvelope).toHaveBeenCalledWith("env-1", USER_ID, expect.anything());
    expect(mocks.record).toHaveBeenCalledWith(
      "passkey_removed",
      USER_ID,
      undefined,
      expect.anything()
    );
  });

  it("throws when no passkey is configured", async () => {
    mocks.findByUserId.mockResolvedValue([]);
    mocks.findActiveEnvelopeByMethod.mockResolvedValue(null);
    await expect(passkeyService.removeAll(USER_ID)).rejects.toBeInstanceOf(NotFoundError);
  });
});
