import { describe, it, expect, vi, beforeEach } from "vitest";
import { encryptedPayload, USER_ID } from "@/test/helpers/fixtures";

const mocks = vi.hoisted(() => ({
  requireFullyAuthenticatedUser: vi.fn(),
  getVaultUnlockAuthOptions: vi.fn(),
  verifyVaultUnlockEnrollment: vi.fn(),
  persistVaultUnlockEnvelope: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireFullyAuthenticatedUser: mocks.requireFullyAuthenticatedUser,
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

vi.mock("@/server/services/passkey-vault-envelope-service", () => ({
  passkeyVaultEnvelopeService: {
    getVaultUnlockAuthOptions: mocks.getVaultUnlockAuthOptions,
    verifyVaultUnlockEnrollment: mocks.verifyVaultUnlockEnrollment,
    persistVaultUnlockEnvelope: mocks.persistVaultUnlockEnvelope,
  },
}));

const context = { params: Promise.resolve({ id: "cred-db-1" }) };

async function post(body: unknown) {
  const { POST } = await import("@/app/api/account/passkeys/[id]/enable-vault-unlock/route");
  return POST(
    new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }),
    context
  );
}

describe("enable vault unlock route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFullyAuthenticatedUser.mockResolvedValue({ id: USER_ID, email: "user@test.local" });
  });

  it("returns credential-scoped authentication options", async () => {
    mocks.getVaultUnlockAuthOptions.mockResolvedValue({ challenge: "abc" });
    const response = await post({ action: "options" });

    expect(response.status).toBe(200);
    expect(mocks.getVaultUnlockAuthOptions).toHaveBeenCalledWith(
      USER_ID,
      "cred-db-1",
      expect.any(String)
    );
  });

  it("verifies only a sanitized WebAuthn response", async () => {
    mocks.verifyVaultUnlockEnrollment.mockResolvedValue({
      verified: true,
      verifiedCredentialId: "credential-1",
      enrollmentProof: "proof-with-sufficient-length",
    });
    const assertion = {
      id: "credential-1",
      rawId: "credential-1",
      type: "public-key",
      response: { clientDataJSON: "client-data", authenticatorData: "auth-data", signature: "sig" },
      clientExtensionResults: {},
    };

    const response = await post({ action: "verify", response: assertion });

    expect(response.status).toBe(200);
    expect(mocks.verifyVaultUnlockEnrollment).toHaveBeenCalledWith(
      USER_ID,
      "cred-db-1",
      assertion
    );
  });

  it("persists a canonical encrypted variant after proof verification", async () => {
    const envelope = encryptedPayload("vault_key", USER_ID);
    mocks.persistVaultUnlockEnvelope.mockResolvedValue({
      success: true,
      verifiedCredentialId: "credential-1",
      envelopeVariantId: "variant-2",
      bindingProof: "binding-proof",
    });

    const response = await post({
      action: "persist",
      enrollmentProof: "proof-with-sufficient-length",
      encryptedVaultKey: envelope,
      prfSupported: true,
    });

    expect(response.status).toBe(200);
    expect(mocks.persistVaultUnlockEnvelope).toHaveBeenCalledWith(
      USER_ID,
      "cred-db-1",
      "proof-with-sufficient-length",
      envelope,
      { prfSupported: true }
    );
  });

  it("rejects nested PRF output before calling the service", async () => {
    const response = await post({
      action: "verify",
      response: {
        id: "credential-1",
        clientExtensionResults: { prf: { results: { first: "secret" } } },
      },
    });

    expect(response.status).toBe(400);
    expect(mocks.verifyVaultUnlockEnrollment).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid payload", async () => {
    const response = await post({ action: "unknown" });
    expect(response.status).toBe(400);
  });
});
