import { describe, it, expect, vi, beforeEach } from "vitest";
import { passkeyService } from "@/server/services/passkey-service";
import { USER_ID } from "@/test/helpers/fixtures";

const mocks = vi.hoisted(() => ({
  findByUserId: vi.fn(),
  storeChallenge: vi.fn(),
  consumeValidChallenge: vi.fn(),
  findByCredentialId: vi.fn(),
  advanceCounter: vi.fn(),
  findActiveEnvelopeByMethod: vi.fn(),
  record: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: vi.fn(async () => ({ challenge: "reg" })),
  verifyRegistrationResponse: mocks.verifyRegistrationResponse,
  generateAuthenticationOptions: mocks.generateAuthenticationOptions,
  verifyAuthenticationResponse: mocks.verifyAuthenticationResponse,
}));

vi.mock("@/server/repositories/passkey-repository", () => ({
  passkeyRepository: {
    findByUserId: mocks.findByUserId,
    storeChallenge: mocks.storeChallenge,
    consumeValidChallenge: mocks.consumeValidChallenge,
    findByCredentialId: mocks.findByCredentialId,
    advanceCounter: mocks.advanceCounter,
    createCredential: vi.fn(),
  },
}));

vi.mock("@/server/repositories/vault-repository", () => ({
  vaultRepository: {
    findActiveEnvelopeByMethod: mocks.findActiveEnvelopeByMethod,
    findActiveEnvelopesByUserId: vi.fn(async () => []),
    createEnvelope: vi.fn(),
    revokeEnvelope: vi.fn(),
  },
}));

vi.mock("@/server/repositories/audit-repository", () => ({
  auditRepository: { record: mocks.record },
}));

function authResponse(challenge: string) {
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: "webauthn.get", challenge, origin: "http://localhost:3001" })
  ).toString("base64url");
  return {
    id: "cred-id",
    rawId: "cred-id",
    type: "public-key" as const,
    response: { clientDataJSON, authenticatorData: "aa", signature: "sig" },
    clientExtensionResults: {},
  };
}

describe("passkey service extended", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateAuthenticationOptions.mockResolvedValue({ challenge: "auth-challenge" });
    mocks.findByUserId.mockResolvedValue([{ credentialId: "cred-id", transports: ["internal"] }]);
    mocks.advanceCounter.mockResolvedValue("advanced");
  });

  it("rate limits authentication options", async () => {
    for (let i = 0; i < 20; i++) {
      await passkeyService.getAuthenticationOptions(USER_ID);
    }
    await expect(passkeyService.getAuthenticationOptions(USER_ID)).rejects.toMatchObject({
      name: "RateLimitError",
    });
  });

  it("supports anonymous authentication options", async () => {
    const options = await passkeyService.getAuthenticationOptions();
    expect(options.challenge).toBe("auth-challenge");
    expect(mocks.storeChallenge).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: undefined,
        type: "selahkeep:passkey:authentication",
      })
    );
  });

  it("rejects invalid authentication challenge", async () => {
    mocks.consumeValidChallenge.mockRejectedValue(new Error("Invalid or expired challenge"));
    await expect(
      passkeyService.verifyAuthentication(USER_ID, authResponse("missing"))
    ).rejects.toThrow("Invalid or expired challenge");
  });

  it("rejects failed WebAuthn verification", async () => {
    mocks.consumeValidChallenge.mockResolvedValue({ id: "ch-1", challenge: "auth-challenge" });
    mocks.findByCredentialId.mockResolvedValue({
      userId: USER_ID,
      credentialId: "cred-id",
      publicKey: Buffer.from(new Uint8Array(32)).toString("base64url"),
      counter: "0",
      transports: ["internal"],
    });
    mocks.verifyAuthenticationResponse.mockResolvedValue({ verified: false });
    await expect(
      passkeyService.verifyAuthentication(USER_ID, authResponse("auth-challenge"))
    ).rejects.toMatchObject({ name: "ChallengeError" });
  });

  it("maps WebAuthn verification exceptions to ChallengeError", async () => {
    mocks.consumeValidChallenge.mockResolvedValue({ id: "ch-1", challenge: "auth-challenge" });
    mocks.findByCredentialId.mockResolvedValue({
      userId: USER_ID,
      credentialId: "cred-id",
      publicKey: Buffer.from(new Uint8Array(32)).toString("base64url"),
      counter: "0",
      transports: ["internal"],
    });
    mocks.verifyAuthenticationResponse.mockRejectedValue(
      new Error('Unexpected authentication response origin "http://127.0.0.1:3001"')
    );
    await expect(
      passkeyService.verifyAuthentication(USER_ID, authResponse("auth-challenge"))
    ).rejects.toMatchObject({ name: "ChallengeError" });
  });

  it("rejects credentials owned by another user", async () => {
    mocks.consumeValidChallenge.mockResolvedValue({ id: "ch-1", challenge: "auth-challenge" });
    mocks.findByCredentialId.mockResolvedValue({
      userId: "other-user",
      credentialId: "cred-id",
      publicKey: Buffer.from(new Uint8Array(32)).toString("base64url"),
      counter: "0",
    });
    await expect(
      passkeyService.verifyAuthentication(USER_ID, authResponse("auth-challenge"))
    ).rejects.toThrow("This passkey is not registered");
  });

  it("rejects failed registration verification", async () => {
    mocks.consumeValidChallenge.mockResolvedValue({ id: "ch-1", challenge: "reg-challenge" });
    mocks.verifyRegistrationResponse.mockResolvedValue({ verified: false });
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.create", challenge: "reg-challenge", origin: "http://localhost:3001" })
    ).toString("base64url");
    await expect(
      passkeyService.verifyRegistration(USER_ID, {
        id: "cred-id",
        rawId: "cred-id",
        type: "public-key",
        response: { clientDataJSON, attestationObject: "oA" },
        clientExtensionResults: {},
      })
    ).rejects.toThrow("Passkey registration failed");
  });
});
