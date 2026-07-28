import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptedPayload, USER_ID } from "@/test/helpers/fixtures";

const mocks = vi.hoisted(() => ({
  requireFullyAuthenticatedUser: vi.fn(),
  resolveCredentialDbId: vi.fn(),
  getVaultUnlockAuthOptions: vi.fn(),
  verifyVaultUnlockEnrollment: vi.fn(),
  persistVaultUnlockEnvelope: vi.fn(),
  getCandidatesAfterAccountPasskeyLogin: vi.fn(),
  findByCredentialId: vi.fn(),
  readBindingId: vi.fn(),
  findBinding: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireFullyAuthenticatedUser: mocks.requireFullyAuthenticatedUser,
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

vi.mock("@/server/services/passkey-vault-envelope-service", () => ({
  passkeyVaultEnvelopeService: {
    resolveCredentialDbId: mocks.resolveCredentialDbId,
    getVaultUnlockAuthOptions: mocks.getVaultUnlockAuthOptions,
    verifyVaultUnlockEnrollment: mocks.verifyVaultUnlockEnrollment,
    persistVaultUnlockEnvelope: mocks.persistVaultUnlockEnvelope,
    getCandidatesAfterAccountPasskeyLogin: mocks.getCandidatesAfterAccountPasskeyLogin,
  },
}));

vi.mock("@/server/repositories/passkey-repository", () => ({
  passkeyRepository: { findByCredentialId: mocks.findByCredentialId },
}));

vi.mock("@/lib/passkey/vault-device-binding-cookie", () => ({
  readVaultDeviceBindingIdFromCookies: mocks.readBindingId,
}));

vi.mock("@/server/repositories/vault-passkey-device-binding-repository", () => ({
  vaultPasskeyDeviceBindingRepository: {
    findByIdForUser: mocks.findBinding,
  },
}));

describe("account/vault passkey interop routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFullyAuthenticatedUser.mockResolvedValue({ id: USER_ID });
    mocks.resolveCredentialDbId.mockResolvedValue("credential-db-1");
    mocks.findByCredentialId.mockResolvedValue({
      id: "credential-db-1",
      userId: USER_ID,
      credentialId: "credential-1",
    });
    mocks.readBindingId.mockResolvedValue(undefined);
  });

  it("issues exact authentication options for the registration credential", async () => {
    mocks.getVaultUnlockAuthOptions.mockResolvedValue({ challenge: "auth-challenge" });
    const { POST } = await import("@/app/api/passkeys/account-registration-vault/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "options", verifiedCredentialId: "credential-1" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.resolveCredentialDbId).toHaveBeenCalledWith(USER_ID, "credential-1");
    expect(mocks.getVaultUnlockAuthOptions).toHaveBeenCalledWith(
      USER_ID,
      "credential-db-1",
      expect.anything()
    );
  });

  it("mints an enrollment proof only after exact authentication verification", async () => {
    mocks.verifyVaultUnlockEnrollment.mockResolvedValue({
      verified: true,
      verifiedCredentialId: "credential-1",
      enrollmentProof: "authentication-proof-with-sufficient-length",
    });
    const assertion = {
      id: "credential-1",
      response: { clientDataJSON: "client-data" },
      clientExtensionResults: {},
    };
    const { POST } = await import("@/app/api/passkeys/account-registration-vault/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          action: "verify",
          verifiedCredentialId: "credential-1",
          response: assertion,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.verifyVaultUnlockEnrollment).toHaveBeenCalledWith(
      USER_ID,
      "credential-db-1",
      assertion
    );
    expect(await response.json()).toMatchObject({
      enrollmentProof: "authentication-proof-with-sufficient-length",
    });
  });

  it("persists ciphertext only under an authentication-derived proof", async () => {
    const encryptedVaultKey = encryptedPayload("vault_key", USER_ID);
    mocks.persistVaultUnlockEnvelope.mockResolvedValue({
      verifiedCredentialId: "credential-1",
      envelopeVariantId: "variant-1",
      bindingProof: "binding-proof",
    });
    const { POST } = await import("@/app/api/passkeys/account-registration-vault/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          action: "persist",
          verifiedCredentialId: "credential-1",
          enrollmentProof: "authentication-proof-with-sufficient-length",
          encryptedVaultKey,
          prfSupported: true,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.persistVaultUnlockEnvelope).toHaveBeenCalledWith(
      USER_ID,
      "credential-db-1",
      "authentication-proof-with-sufficient-length",
      encryptedVaultKey,
      { prfSupported: true }
    );
  });

  it("rejects the legacy registration-proof request shape and PRF output", async () => {
    const { POST } = await import("@/app/api/passkeys/account-registration-vault/route");
    const legacy = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          verifiedCredentialId: "credential-1",
          enrollmentProof: "registration-proof-with-sufficient-length",
          encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
          prfSupported: true,
        }),
      })
    );
    const leaked = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          action: "verify",
          verifiedCredentialId: "credential-1",
          response: {
            id: "credential-1",
            clientExtensionResults: { prf: { results: { first: "secret" } } },
          },
        }),
      })
    );

    expect(legacy.status).toBe(400);
    expect(leaked.status).toBe(400);
    expect(mocks.persistVaultUnlockEnvelope).not.toHaveBeenCalled();
    expect(mocks.verifyVaultUnlockEnrollment).not.toHaveBeenCalled();
  });

  it("loads candidates only after a fully authenticated session and preserves the bound hint", async () => {
    mocks.readBindingId.mockResolvedValue("binding-1");
    mocks.findBinding.mockResolvedValue({
      passkeyCredentialId: "credential-db-1",
      selectedEnvelopeVariantId: "variant-2",
    });
    mocks.getCandidatesAfterAccountPasskeyLogin.mockResolvedValue({
      userId: USER_ID,
      verifiedCredentialId: "credential-1",
      bindingProof: "binding-proof",
      candidates: [],
    });
    const { POST } = await import("@/app/api/passkeys/account-login-vault-candidates/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ verifiedCredentialId: "credential-1" }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.requireFullyAuthenticatedUser).toHaveBeenCalled();
    expect(mocks.getCandidatesAfterAccountPasskeyLogin).toHaveBeenCalledWith(
      USER_ID,
      "credential-1",
      "variant-2"
    );
  });
});
