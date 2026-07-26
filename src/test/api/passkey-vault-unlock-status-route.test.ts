import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  requireFullyAuthenticatedUser: vi.fn(),
  getVaultUnlockStatus: vi.fn(),
  disableVaultUnlockWithProof: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireFullyAuthenticatedUser: mocks.requireFullyAuthenticatedUser,
}));

vi.mock("@/server/services/passkey-vault-envelope-service", () => ({
  passkeyVaultEnvelopeService: {
    getVaultUnlockStatus: mocks.getVaultUnlockStatus,
    disableVaultUnlockWithProof: mocks.disableVaultUnlockWithProof,
  },
}));

vi.mock("@/lib/passkey/vault-device-binding-cookie", () => ({
  readVaultDeviceBindingIdFromCookies: vi.fn(async () => "550e8400-e29b-41d4-a716-446655440010"),
  clearVaultDeviceBindingCookie: vi.fn((response: Response) => response),
}));

const proof = {
  bindingProof: "opaque-binding-proof-value",
  verifiedCredentialId: "cred-1",
  selectedEnvelopeVariantId: "550e8400-e29b-41d4-a716-446655440011",
};

describe("passkey vault unlock status route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFullyAuthenticatedUser.mockResolvedValue({ id: "user-1" });
    mocks.getVaultUnlockStatus.mockResolvedValue({
      signInEnabled: true,
      vaultUnlockEnabled: true,
      prfSupported: true,
      credentialId: "cred-1",
      activeEnvelopeVariantCount: 2,
    });
    mocks.disableVaultUnlockWithProof.mockResolvedValue({
      success: true,
      removedBindingIds: ["550e8400-e29b-41d4-a716-446655440010"],
    });
  });

  it("GET returns vault unlock status for passkey", async () => {
    const { GET } = await import("@/app/api/account/passkeys/[id]/vault-unlock/route");
    const res = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "db-id-1" }),
    });
    expect(res.status).toBe(200);
  });

  it("DELETE rejects a raw WebAuthn PRF extension result", async () => {
    const { DELETE } = await import("@/app/api/account/passkeys/[id]/vault-unlock/route");
    const res = await DELETE(
      new Request("http://localhost", {
        method: "DELETE",
        body: JSON.stringify({
          ...proof,
          response: { clientExtensionResults: { prf: { results: { first: "secret" } } } },
        }),
      }),
      { params: Promise.resolve({ id: "db-id-1" }) }
    );
    expect(res.status).toBe(400);
    expect(mocks.disableVaultUnlockWithProof).not.toHaveBeenCalled();
  });

  it("DELETE disables only after a verified local candidate-match proof", async () => {
    const { DELETE } = await import("@/app/api/account/passkeys/[id]/vault-unlock/route");
    const res = await DELETE(
      new Request("http://localhost", { method: "DELETE", body: JSON.stringify(proof) }),
      { params: Promise.resolve({ id: "db-id-1" }) }
    );
    expect(res.status).toBe(200);
    expect(mocks.disableVaultUnlockWithProof).toHaveBeenCalledWith("user-1", "db-id-1", proof);
  });
});
