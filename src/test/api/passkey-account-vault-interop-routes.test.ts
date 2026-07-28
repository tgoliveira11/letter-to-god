import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptedPayload, USER_ID } from "@/test/helpers/fixtures";

const mocks = vi.hoisted(() => ({
  requireFullyAuthenticatedUser: vi.fn(),
  readRegistrationProof: vi.fn(),
  clearRegistrationProof: vi.fn((response: Response) => response),
  findByCredentialId: vi.fn(),
  persistVaultUnlockEnvelope: vi.fn(),
  getCandidatesAfterAccountPasskeyLogin: vi.fn(),
  readBindingId: vi.fn(),
  findBinding: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireFullyAuthenticatedUser: mocks.requireFullyAuthenticatedUser,
  UnauthorizedError: class UnauthorizedError extends Error {},
}));

vi.mock("@/lib/passkey/vault-registration-proof-cookie", () => ({
  readVaultRegistrationProofCookie: mocks.readRegistrationProof,
  clearVaultRegistrationProofCookie: mocks.clearRegistrationProof,
}));

vi.mock("@/server/repositories/passkey-repository", () => ({
  passkeyRepository: { findByCredentialId: mocks.findByCredentialId },
}));

vi.mock("@/server/services/passkey-vault-envelope-service", () => ({
  passkeyVaultEnvelopeService: {
    persistVaultUnlockEnvelope: mocks.persistVaultUnlockEnvelope,
    getCandidatesAfterAccountPasskeyLogin: mocks.getCandidatesAfterAccountPasskeyLogin,
  },
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
    mocks.readRegistrationProof.mockResolvedValue("registration-proof-with-sufficient-length");
    mocks.findByCredentialId.mockResolvedValue({
      id: "credential-db-1",
      userId: USER_ID,
      credentialId: "credential-1",
    });
    mocks.readBindingId.mockResolvedValue(undefined);
  });

  it("persists only ciphertext under the short-lived registration proof", async () => {
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
          verifiedCredentialId: "credential-1",
          encryptedVaultKey,
          prfSupported: true,
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.persistVaultUnlockEnvelope).toHaveBeenCalledWith(
      USER_ID,
      "credential-db-1",
      "registration-proof-with-sufficient-length",
      encryptedVaultKey,
      { prfSupported: true }
    );
    expect(mocks.clearRegistrationProof).toHaveBeenCalledWith(response);
  });

  it("rejects PRF extension output before persistence", async () => {
    const { POST } = await import("@/app/api/passkeys/account-registration-vault/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          verifiedCredentialId: "credential-1",
          encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
          prfSupported: true,
          clientExtensionResults: { prf: { results: { first: "secret" } } },
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.persistVaultUnlockEnvelope).not.toHaveBeenCalled();
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
