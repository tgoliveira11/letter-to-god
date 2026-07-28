import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  passkeyService,
  RateLimitError,
  vaultPasskeyUserHandle,
} from "@/server/services/passkey-service";
import { encryptedPayload, USER_ID } from "@/test/helpers/fixtures";

const mocks = vi.hoisted(() => ({
  findByUserId: vi.fn(),
  storeChallenge: vi.fn(),
  consumeValidChallenge: vi.fn(),
  createCredential: vi.fn(),
  findByCredentialId: vi.fn(),
  advanceCounter: vi.fn(),
  updateLastUsedAt: vi.fn(),
  updateCredentialFlags: vi.fn(),
  lockForVaultMutation: vi.fn(),
  createEnvelope: vi.fn(),
  revokeEnvelope: vi.fn(),
  findActiveEnvelopesByUserId: vi.fn(),
  findActiveEnvelopeByMethod: vi.fn(),
  findActivePasskeyEnvelopeByCredentialId: vi.fn(),
  findActivePasskeyEnvelopeVariants: vi.fn(),
  findActivePasskeyEnvelopeVariant: vi.fn(),
  record: vi.fn(),
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
  generateAuthenticationOptions: vi.fn(),
  verifyAuthenticationResponse: vi.fn(),
  findByIdForUser: vi.fn(),
  findDeviceBindingByIdForUser: vi.fn(),
  listDeviceBindingsByUserId: vi.fn(),
  bindPasskeyToDevice: vi.fn(),
  deleteDeviceBindingsByUserId: vi.fn(),
}));

vi.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: mocks.generateRegistrationOptions,
  verifyRegistrationResponse: mocks.verifyRegistrationResponse,
  generateAuthenticationOptions: mocks.generateAuthenticationOptions,
  verifyAuthenticationResponse: mocks.verifyAuthenticationResponse,
}));

vi.mock("@/server/repositories/passkey-repository", () => ({
  passkeyRepository: {
    findByUserId: mocks.findByUserId,
    storeChallenge: mocks.storeChallenge,
    consumeValidChallenge: mocks.consumeValidChallenge,
    createCredential: mocks.createCredential,
    findByCredentialId: mocks.findByCredentialId,
    advanceCounter: mocks.advanceCounter,
    updateLastUsedAt: mocks.updateLastUsedAt,
    updateCredentialFlags: mocks.updateCredentialFlags,
    lockForVaultMutation: mocks.lockForVaultMutation,
  },
}));

vi.mock("@/server/repositories/vault-repository", () => ({
  vaultRepository: {
    createEnvelope: mocks.createEnvelope,
    revokeEnvelope: mocks.revokeEnvelope,
    findActiveEnvelopesByUserId: mocks.findActiveEnvelopesByUserId,
    findActiveEnvelopeByMethod: mocks.findActiveEnvelopeByMethod,
    findActivePasskeyEnvelopeByCredentialId: mocks.findActivePasskeyEnvelopeByCredentialId,
    findActivePasskeyEnvelopeVariants: mocks.findActivePasskeyEnvelopeVariants,
    findActivePasskeyEnvelopeVariant: mocks.findActivePasskeyEnvelopeVariant,
  },
}));

vi.mock("@/server/repositories/vault-passkey-device-binding-repository", () => ({
  vaultPasskeyDeviceBindingRepository: {
    findByIdForUser: mocks.findDeviceBindingByIdForUser,
    listByUserId: mocks.listDeviceBindingsByUserId,
    bindPasskeyToDevice: mocks.bindPasskeyToDevice,
    deleteAllByUserId: mocks.deleteDeviceBindingsByUserId,
  },
}));

vi.mock("@/server/repositories/audit-repository", () => ({
  auditRepository: { record: mocks.record },
}));

function registrationResponse(challenge: string) {
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: "webauthn.create", challenge, origin: "http://localhost:3001" })
  ).toString("base64url");
  return {
    id: "cred-id",
    rawId: "cred-id",
    type: "public-key",
    response: {
      clientDataJSON,
      attestationObject: "oA",
    },
    clientExtensionResults: {},
  };
}

describe("passkey service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findByUserId.mockResolvedValue([]);
    mocks.findActiveEnvelopeByMethod.mockResolvedValue(null);
    mocks.findActiveEnvelopesByUserId.mockResolvedValue([]);
    mocks.listDeviceBindingsByUserId.mockResolvedValue([]);
    mocks.findDeviceBindingByIdForUser.mockResolvedValue(null);
    mocks.findActivePasskeyEnvelopeVariants.mockResolvedValue([]);
    mocks.bindPasskeyToDevice.mockResolvedValue({ bindingId: "binding-1" });
    mocks.createCredential.mockResolvedValue({ id: "cred-db-id" });
    mocks.advanceCounter.mockResolvedValue("advanced");
    mocks.createEnvelope.mockResolvedValue({ id: "env-new" });
    mocks.generateRegistrationOptions.mockResolvedValue({ challenge: "reg-challenge" });
    mocks.generateAuthenticationOptions.mockResolvedValue({ challenge: "auth-challenge" });
  });

  it("returns registration options and stores challenge", async () => {
    mocks.findByUserId.mockResolvedValue([{ credentialId: "existing-cred", transports: ["internal"] }]);
    const options = await passkeyService.getRegistrationOptions(USER_ID, "user@example.com");
    expect(options.challenge).toBe("reg-challenge");
    expect(mocks.storeChallenge).toHaveBeenCalled();
  });

  it("vault-only registration options prefer platform authenticator and exclude active vault credentials only", async () => {
    mocks.findByUserId.mockResolvedValue([
      {
        credentialId: "account-cred",
        transports: ["internal"],
        vaultUnlockEnabled: false,
        signInEnabled: true,
      },
      {
        credentialId: "vault-cred",
        transports: ["internal"],
        vaultUnlockEnabled: true,
        signInEnabled: false,
      },
      {
        credentialId: "disabled-vault",
        transports: ["internal"],
        vaultUnlockEnabled: false,
        signInEnabled: false,
      },
    ]);

    await passkeyService.getRegistrationOptions(USER_ID, "user@example.com", undefined, {
      vaultOnly: true,
    });

    expect(mocks.generateRegistrationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeCredentials: [{ id: "vault-cred", transports: ["internal"] }],
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "required",
        },
        userID: expect.any(Uint8Array),
        userName: "user@example.com · SelahKeep vault",
      })
    );
  });

  it("vaultPasskeyUserHandle returns a random 32-byte handle per call (multi-device)", () => {
    const a = vaultPasskeyUserHandle();
    const b = vaultPasskeyUserHandle();
    expect(a).toBeInstanceOf(Uint8Array);
    expect(a.byteLength).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("verifies registration without storing an envelope or browser binding", async () => {
    mocks.consumeValidChallenge.mockResolvedValue({ id: "ch-1", challenge: "reg-challenge" });
    mocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred-id",
          publicKey: new Uint8Array(32),
          counter: 0,
          transports: ["internal"],
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      },
    });
    mocks.findActiveEnvelopesByUserId.mockResolvedValue([
      { id: "old-env", method: "passkey_authorized_device" },
      { id: "keep-env", method: "recovery_code" },
    ]);

    const result = await passkeyService.verifyRegistration(
      USER_ID,
      registrationResponse("reg-challenge")
    );

    expect(result.verified).toBe(true);
    expect(mocks.createCredential).toHaveBeenCalled();
    expect(mocks.createEnvelope).not.toHaveBeenCalled();
    expect(mocks.bindPasskeyToDevice).not.toHaveBeenCalled();
    expect(mocks.revokeEnvelope).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledWith(
      "passkey_added",
      USER_ID,
      undefined,
      expect.anything()
    );
  });

  it("registers vault-only passkey with signInEnabled false when vaultOnly is set", async () => {
    mocks.consumeValidChallenge.mockResolvedValue({ id: "ch-1", challenge: "reg-challenge" });
    mocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred-id",
          publicKey: new Uint8Array(32),
          counter: 0,
          transports: ["internal"],
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      },
    });

    await passkeyService.verifyRegistration(
      USER_ID,
      registrationResponse("reg-challenge"),
      { vaultOnly: true }
    );

    expect(mocks.createCredential).toHaveBeenCalledWith(
      expect.objectContaining({
        signInEnabled: false,
        vaultUnlockEnabled: false,
        prfSupported: null,
        friendlyName: "Vault passkey",
      }),
      expect.anything()
    );
  });

  it("verifyRegistration rejects invalid challenge", async () => {
    mocks.consumeValidChallenge.mockRejectedValue(new Error("Invalid or expired challenge"));
    await expect(
      passkeyService.verifyRegistration(USER_ID, registrationResponse("wrong"), undefined)
    ).rejects.toThrow("Invalid or expired challenge");
  });

  it("does not expose registration-time envelope persistence", () => {
    expect(passkeyService.verifyRegistration).toHaveLength(3);
    expect(mocks.createEnvelope).not.toHaveBeenCalled();
    expect(mocks.bindPasskeyToDevice).not.toHaveBeenCalled();
  });

  it("registers passkey credential without vault envelope when none is provided", async () => {
    mocks.consumeValidChallenge.mockResolvedValue({ id: "ch-1", challenge: "reg-challenge" });
    mocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred-id",
          publicKey: new Uint8Array(32),
          counter: 0,
          transports: ["internal"],
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      },
    });
    mocks.findActiveEnvelopesByUserId.mockResolvedValue([
      { id: "keep-env", method: "passkey_authorized_device" },
    ]);

    await passkeyService.verifyRegistration(USER_ID, registrationResponse("reg-challenge"));

    expect(mocks.createCredential).toHaveBeenCalled();
    expect(mocks.createEnvelope).not.toHaveBeenCalled();
    expect(mocks.revokeEnvelope).not.toHaveBeenCalled();
  });

  it("returns authentication options for a known user", async () => {
    mocks.findByUserId.mockResolvedValue([{ credentialId: "cred-id", transports: ["internal"] }]);
    const options = await passkeyService.getAuthenticationOptions(USER_ID);
    expect(options.challenge).toBe("auth-challenge");
    expect(mocks.generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowCredentials: [{ id: "cred-id", transports: ["internal"] }],
      })
    );
  });

  it("vault unlock options preserve every stored transport for the envelope credential", async () => {
    mocks.findActiveEnvelopesByUserId.mockResolvedValue([
      {
        id: "env-1",
        method: "passkey_authorized_device",
        publicMetadata: { credentialId: "vault-cred", prfRequired: true },
      },
    ]);
    mocks.findByUserId.mockResolvedValue([
      {
        credentialId: "account-cred",
        transports: ["internal"],
        vaultUnlockEnabled: false,
        signInEnabled: true,
      },
      {
        credentialId: "vault-cred",
        transports: ["internal", "hybrid"],
        vaultUnlockEnabled: true,
        signInEnabled: false,
      },
    ]);

    await passkeyService.getAuthenticationOptions(USER_ID, undefined, {
      purpose: "vault_unlock",
    });

    // Only the credential with an active envelope; transports are preserved exactly.
    expect(mocks.generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowCredentials: [{ id: "vault-cred", transports: ["internal", "hybrid"] }],
        userVerification: "required",
        extensions: expect.objectContaining({
          prf: expect.objectContaining({ eval: expect.any(Object) }),
        }),
      })
    );
  });

  it("vault unlock options reject when no vault credentials exist", async () => {
    mocks.findByUserId.mockResolvedValue([
      {
        credentialId: "account-cred",
        transports: ["internal"],
        vaultUnlockEnabled: false,
        signInEnabled: true,
      },
    ]);

    await expect(
      passkeyService.getAuthenticationOptions(USER_ID, undefined, { purpose: "vault_unlock" })
    ).rejects.toThrow("Passkey vault unlock is not configured yet.");
    expect(mocks.generateAuthenticationOptions).not.toHaveBeenCalled();
  });

  it("vault unlock options scope to device binding cookie when present", async () => {
    mocks.findActiveEnvelopesByUserId.mockResolvedValue([
      {
        id: "env-a",
        method: "passkey_authorized_device",
        publicMetadata: { credentialId: "vault-a", prfRequired: true },
      },
      {
        id: "env-b",
        method: "passkey_authorized_device",
        publicMetadata: { credentialId: "vault-b", prfRequired: true },
      },
    ]);
    mocks.findByUserId.mockResolvedValue([
      {
        id: "db-a",
        credentialId: "vault-a",
        transports: ["internal"],
        vaultUnlockEnabled: true,
      },
      {
        id: "db-b",
        credentialId: "vault-b",
        transports: ["internal"],
        vaultUnlockEnabled: true,
      },
    ]);
    mocks.findDeviceBindingByIdForUser.mockResolvedValue({
      id: "binding-1",
      passkeyCredentialId: "db-b",
    });

    await passkeyService.getAuthenticationOptions(USER_ID, undefined, {
      purpose: "vault_unlock",
      deviceBindingId: "binding-1",
    });

    expect(mocks.generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowCredentials: [{ id: "vault-b", transports: ["internal"] }],
      })
    );
  });

  it("fails closed when the browser binding cookie is stale", async () => {
    mocks.findActiveEnvelopesByUserId.mockResolvedValue([
      {
        id: "env-a",
        method: "passkey_authorized_device",
        publicMetadata: { credentialId: "vault-a" },
      },
    ]);
    mocks.findByUserId.mockResolvedValue([
      { id: "db-a", credentialId: "vault-a", vaultUnlockEnabled: true },
    ]);
    mocks.findDeviceBindingByIdForUser.mockResolvedValue(null);

    await expect(
      passkeyService.getAuthenticationOptions(USER_ID, undefined, {
        purpose: "vault_unlock",
        deviceBindingId: "stale-binding",
      })
    ).rejects.toThrow("binding is stale");
    expect(mocks.generateAuthenticationOptions).not.toHaveBeenCalled();
  });

  it("fails closed when a binding points to a credential without an active variant", async () => {
    mocks.findActiveEnvelopesByUserId.mockResolvedValue([
      {
        id: "env-a",
        method: "passkey_authorized_device",
        publicMetadata: { credentialId: "vault-a" },
      },
    ]);
    mocks.findByUserId.mockResolvedValue([
      { id: "db-a", credentialId: "vault-a", vaultUnlockEnabled: true },
      { id: "db-inactive", credentialId: "vault-inactive", vaultUnlockEnabled: true },
    ]);
    mocks.findDeviceBindingByIdForUser.mockResolvedValue({
      id: "binding-1",
      passkeyCredentialId: "db-inactive",
    });

    await expect(
      passkeyService.getAuthenticationOptions(USER_ID, undefined, {
        purpose: "vault_unlock",
        deviceBindingId: "binding-1",
      })
    ).rejects.toThrow("binding is stale");
    expect(mocks.generateAuthenticationOptions).not.toHaveBeenCalled();
  });

  it("vault unlock offers every per-device passkey when no device binding", async () => {
    // Multi-device: one envelope per device. Unlock offers ALL of them so the user can
    // authenticate with the passkey local to the current device. A single `eval` salt is
    // used (the authenticator evaluates it for whichever credential the user picks).
    mocks.findActiveEnvelopesByUserId.mockResolvedValue([
      {
        id: "env-a",
        method: "passkey_authorized_device",
        publicMetadata: { credentialId: "vault-a", prfRequired: true },
      },
      { id: "env-pw", method: "password", publicMetadata: null },
      {
        id: "env-b",
        method: "passkey_authorized_device",
        publicMetadata: { credentialId: "vault-b", prfRequired: true },
      },
    ]);
    mocks.findByUserId.mockResolvedValue([
      { id: "db-a", credentialId: "vault-a", transports: ["internal"], vaultUnlockEnabled: true },
      { id: "db-b", credentialId: "vault-b", transports: ["internal", "hybrid"], vaultUnlockEnabled: true },
    ]);

    await passkeyService.getAuthenticationOptions(USER_ID, undefined, {
      purpose: "vault_unlock",
    });

    const call = mocks.generateAuthenticationOptions.mock.calls[0][0];
    expect(call.allowCredentials).toEqual([
      { id: "vault-a", transports: ["internal"] },
      { id: "vault-b", transports: ["internal", "hybrid"] },
    ]);
    expect(call.extensions.prf.eval).toBeDefined();
    expect(call.extensions.prf.evalByCredential).toBeUndefined();
  });

  it("purpose-less verification never returns a vault envelope", async () => {
    mocks.consumeValidChallenge.mockResolvedValue({ id: "ch-1", challenge: "auth-challenge" });
    mocks.findByCredentialId.mockResolvedValue({
      userId: USER_ID,
      credentialId: "cred-id",
      publicKey: Buffer.from(new Uint8Array(32)).toString("base64url"),
      counter: "0",
      transports: ["internal"],
      vaultUnlockEnabled: true,
    });
    mocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });

    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: "auth-challenge", origin: "http://localhost:3001" })
    ).toString("base64url");

    const result = await passkeyService.verifyAuthentication(USER_ID, {
      id: "cred-id",
      rawId: "cred-id",
      type: "public-key",
      response: { clientDataJSON, authenticatorData: "aa", signature: "sig" },
      clientExtensionResults: {},
    });

    expect(result.verified).toBe(true);
    expect(result).toEqual({ verified: true });
    expect(mocks.findActivePasskeyEnvelopeByCredentialId).not.toHaveBeenCalled();
  });

  it("vault unlock verify rejects account-only credential", async () => {
    mocks.consumeValidChallenge.mockResolvedValue({ id: "ch-1", challenge: "auth-challenge" });
    mocks.findByCredentialId.mockResolvedValue({
      userId: USER_ID,
      credentialId: "account-cred",
      publicKey: Buffer.from(new Uint8Array(32)).toString("base64url"),
      counter: "0",
      transports: ["internal"],
      vaultUnlockEnabled: false,
      signInEnabled: true,
    });
    mocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });

    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: "auth-challenge", origin: "http://localhost:3001" })
    ).toString("base64url");

    await expect(
      passkeyService.verifyAuthentication(
        USER_ID,
        {
          id: "account-cred",
          rawId: "account-cred",
          type: "public-key",
          response: { clientDataJSON, authenticatorData: "aa", signature: "sig" },
          clientExtensionResults: {},
        },
        { purpose: "vault_unlock" }
      )
    ).rejects.toThrow("This passkey is for account sign-in, not vault unlock.");
  });

  it("vault unlock verify rejects vault credential without envelope", async () => {
    mocks.consumeValidChallenge.mockResolvedValue({ id: "ch-1", challenge: "auth-challenge" });
    mocks.findByCredentialId.mockResolvedValue({
      userId: USER_ID,
      credentialId: "vault-cred",
      publicKey: Buffer.from(new Uint8Array(32)).toString("base64url"),
      counter: "0",
      transports: ["internal"],
      vaultUnlockEnabled: true,
    });
    mocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });
    mocks.findActivePasskeyEnvelopeByCredentialId.mockResolvedValue(null);

    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: "auth-challenge", origin: "http://localhost:3001" })
    ).toString("base64url");

    await expect(
      passkeyService.verifyAuthentication(
        USER_ID,
        {
          id: "vault-cred",
          rawId: "vault-cred",
          type: "public-key",
          response: { clientDataJSON, authenticatorData: "aa", signature: "sig" },
          clientExtensionResults: {},
        },
        { purpose: "vault_unlock" }
      )
    ).rejects.toThrow("This passkey is not linked to vault unlock.");
  });

  it("vault unlock verify returns bounded candidates for the verified credential", async () => {
    mocks.consumeValidChallenge.mockResolvedValue({ id: "ch-1", challenge: "auth-challenge" });
    mocks.findByCredentialId.mockResolvedValue({
      id: "db-vault",
      userId: USER_ID,
      credentialId: "vault-cred",
      publicKey: Buffer.from(new Uint8Array(32)).toString("base64url"),
      counter: "0",
      transports: ["internal"],
      vaultUnlockEnabled: true,
    });
    mocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });
    mocks.findActivePasskeyEnvelopeVariants.mockResolvedValue([{
      id: "env-1",
      encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
      publicMetadata: { prfRequired: true },
    }]);

    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: "auth-challenge", origin: "http://localhost:3001" })
    ).toString("base64url");

    const result = await passkeyService.verifyAuthentication(
      USER_ID,
      {
        id: "vault-cred",
        rawId: "vault-cred",
        type: "public-key",
        response: { clientDataJSON, authenticatorData: "aa", signature: "sig" },
        clientExtensionResults: {},
      },
      { purpose: "vault_unlock" }
    );

    expect(result.verified).toBe(true);
    expect(result.verifiedCredentialId).toBe("vault-cred");
    expect(result.candidates).toEqual([
      expect.objectContaining({ envelopeVariantId: "env-1", credentialId: "vault-cred" }),
    ]);
  });

  it("general account verification returns no vault fields", async () => {
    mocks.consumeValidChallenge.mockResolvedValue({ id: "ch-1", challenge: "auth-challenge" });
    mocks.findByCredentialId.mockResolvedValue({
      userId: USER_ID,
      credentialId: "account-cred",
      publicKey: Buffer.from(new Uint8Array(32)).toString("base64url"),
      counter: "0",
      transports: ["internal"],
      vaultUnlockEnabled: false,
      signInEnabled: true,
    });
    mocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 1 },
    });

    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: "auth-challenge", origin: "http://localhost:3001" })
    ).toString("base64url");

    const result = await passkeyService.verifyAuthentication(USER_ID, {
      id: "account-cred",
      rawId: "account-cred",
      type: "public-key",
      response: { clientDataJSON, authenticatorData: "aa", signature: "sig" },
      clientExtensionResults: {},
    });

    expect(result.verified).toBe(true);
    expect(result).toEqual({ verified: true });
  });

  it("verifyAuthentication rejects unknown credential", async () => {
    mocks.consumeValidChallenge.mockResolvedValue({ id: "ch-1", challenge: "auth-challenge" });
    mocks.findByCredentialId.mockResolvedValue(null);
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: "auth-challenge", origin: "http://localhost:3001" })
    ).toString("base64url");
    await expect(
      passkeyService.verifyAuthentication(USER_ID, {
        id: "missing",
        rawId: "missing",
        type: "public-key",
        response: { clientDataJSON, authenticatorData: "aa", signature: "sig" },
        clientExtensionResults: {},
      })
    ).rejects.toThrow("This passkey is not registered");
    expect(mocks.record).toHaveBeenCalledWith("failed_unlock_attempt", USER_ID, {
      method: "passkey",
    });
  });

  it("returns authentication options without user credentials", async () => {
    const options = await passkeyService.getAuthenticationOptions();
    expect(options.challenge).toBe("auth-challenge");
    expect(mocks.generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({ allowCredentials: undefined })
    );
  });

  it("verifyAuthentication rejects invalid challenge and failed verification", async () => {
    mocks.consumeValidChallenge.mockRejectedValue(new Error("expired"));
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge: "bad", origin: "http://localhost:3001" })
    ).toString("base64url");
    const response = {
      id: "cred-id",
      rawId: "cred-id",
      type: "public-key" as const,
      response: { clientDataJSON, authenticatorData: "aa", signature: "sig" },
      clientExtensionResults: {},
    };
    await expect(passkeyService.verifyAuthentication(USER_ID, response)).rejects.toThrow(
      "Invalid or expired challenge"
    );

    mocks.consumeValidChallenge.mockResolvedValue({ id: "ch-1", challenge: "auth-challenge" });
    mocks.findByCredentialId.mockResolvedValue({
      userId: USER_ID,
      credentialId: "cred-id",
      publicKey: Buffer.from(new Uint8Array(32)).toString("base64url"),
      counter: "0",
      transports: ["internal"],
    });
    mocks.verifyAuthenticationResponse.mockResolvedValue({
      verified: false,
      authenticationInfo: { newCounter: 1 },
    });
    await expect(passkeyService.verifyAuthentication(USER_ID, response)).rejects.toThrow(
      "Passkey authentication failed"
    );
  });

  it("persists registration transports without inventing defaults", async () => {
    mocks.consumeValidChallenge.mockResolvedValue({ id: "ch-1", challenge: "reg-challenge" });
    mocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred-id",
          publicKey: new Uint8Array(32),
          counter: 0,
          transports: ["internal"],
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      },
    });

    await passkeyService.verifyRegistration(
      USER_ID,
      registrationResponse("reg-challenge"),
      { vaultOnly: true }
    );

    expect(mocks.createCredential).toHaveBeenCalledWith(
      expect.objectContaining({ transports: ["internal"] }),
      expect.anything()
    );
  });

  it("stores null transports when browser does not report them", async () => {
    mocks.consumeValidChallenge.mockResolvedValue({ id: "ch-1", challenge: "reg-challenge" });
    mocks.verifyRegistrationResponse.mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: "cred-id",
          publicKey: new Uint8Array(32),
          counter: 0,
          transports: undefined,
        },
        credentialDeviceType: "singleDevice",
        credentialBackedUp: false,
      },
    });

    await passkeyService.verifyRegistration(USER_ID, registrationResponse("reg-challenge"));

    expect(mocks.createCredential).toHaveBeenCalledWith(
      expect.objectContaining({ transports: null }),
      expect.anything()
    );
  });

  it("rate limits registration", async () => {
    for (let i = 0; i < 10; i++) {
      await passkeyService.getRegistrationOptions(USER_ID, "user@example.com");
    }
    await expect(
      passkeyService.getRegistrationOptions(USER_ID, "user@example.com")
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});
