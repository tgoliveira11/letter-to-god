import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PasskeyAuthenticationPrfUnavailableError,
  runAuthenticationConfirmedPasskeyEnrollment,
} from "@/lib/passkey/authentication-confirmed-enrollment";

const mocks = vi.hoisted(() => ({
  resolveEnrollment: vi.fn(),
  startAuthentication: vi.fn(),
  prepareAuthenticationOptions: vi.fn(),
  extractPrf: vi.fn(),
  resolveCapability: vi.fn(),
}));

vi.mock("@tgoliveira/vault-core/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tgoliveira/vault-core/browser")>()),
  resolvePasskeyPrfEnrollmentAfterRegistration: mocks.resolveEnrollment,
}));

vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: mocks.startAuthentication,
}));

vi.mock("@/lib/passkey/prepare-webauthn-options", () => ({
  prepareVaultAuthenticationOptions: mocks.prepareAuthenticationOptions,
}));

vi.mock("@/lib/crypto-client/passkey-vault", () => ({
  extractPasskeyPrfOutput: mocks.extractPrf,
}));

vi.mock("@/lib/crypto-client/vault-passkey-browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crypto-client/vault-passkey-browser")>()),
  resolvePasskeyPrfCapability: mocks.resolveCapability,
}));

describe("authentication-confirmed passkey enrollment", () => {
  const registrationPrf = new Uint8Array(32).fill(1);
  const authenticationPrf = new Uint8Array(32).fill(2);

  beforeEach(() => {
    vi.clearAllMocks();
    registrationPrf.fill(1);
    authenticationPrf.fill(2);
    mocks.resolveEnrollment.mockReturnValue({
      status: "authentication_required",
      credentialId: "credential-1",
      credentialSelection: { mode: "exact", credentialId: "credential-1" },
      reason: "authentication_prf_confirmation_required",
    });
    mocks.prepareAuthenticationOptions.mockResolvedValue({
      challenge: "auth-challenge",
      allowCredentials: [{ id: "credential-1", type: "public-key" }],
    });
    mocks.startAuthentication.mockResolvedValue({
      id: "credential-1",
      clientExtensionResults: {
        prf: { results: { first: authenticationPrf.buffer } },
      },
    });
    mocks.resolveCapability.mockReturnValue({ state: "confirmed_authentication" });
    mocks.extractPrf.mockReturnValue(authenticationPrf);
  });

  it("uses A, not registration result R, and sends a sanitized exact assertion", async () => {
    const verifyAuthentication = vi.fn().mockResolvedValue({
      verifiedCredentialId: "credential-1",
      enrollmentProof: "authentication-proof",
    });

    const result = await runAuthenticationConfirmedPasskeyEnrollment({
      userId: "user-1",
      registrationCredentialId: "credential-1",
      verifiedRegistrationCredentialId: "credential-1",
      registrationClientExtensionResults: {
        prf: { results: { first: registrationPrf.buffer } },
      },
      requestAuthenticationOptions: vi.fn().mockResolvedValue({ challenge: "server" }),
      verifyAuthentication,
    });

    expect(result.prfOutput[0]).toBe(2);
    expect(mocks.prepareAuthenticationOptions).toHaveBeenCalledWith(
      { challenge: "server" },
      "user-1",
      { mode: "exact", credentialId: "credential-1" }
    );
    expect(verifyAuthentication).toHaveBeenCalledWith(
      "credential-1",
      expect.not.objectContaining({
        clientExtensionResults: expect.objectContaining({ prf: expect.anything() }),
      })
    );
  });

  it("fails closed if a future core regression marks registration output ready", async () => {
    const unsafeRegistrationPrf = new Uint8Array(32).fill(7);
    mocks.resolveEnrollment.mockReturnValue({
      status: "ready",
      credentialId: "credential-1",
      prfOutput: unsafeRegistrationPrf,
    });

    await expect(
      runAuthenticationConfirmedPasskeyEnrollment({
        userId: "user-1",
        registrationCredentialId: "credential-1",
        verifiedRegistrationCredentialId: "credential-1",
        requestAuthenticationOptions: vi.fn(),
        verifyAuthentication: vi.fn(),
      })
    ).rejects.toThrow("authentication confirmation is required");
    expect(unsafeRegistrationPrf).toEqual(new Uint8Array(32));
    expect(mocks.startAuthentication).not.toHaveBeenCalled();
  });

  it("rejects credential mismatch and missing authentication PRF", async () => {
    const shared = {
      userId: "user-1",
      registrationCredentialId: "credential-1",
      verifiedRegistrationCredentialId: "credential-1",
      requestAuthenticationOptions: vi.fn().mockResolvedValue({ challenge: "server" }),
    };
    mocks.startAuthentication.mockResolvedValueOnce({
      id: "credential-2",
      clientExtensionResults: {},
    });
    await expect(
      runAuthenticationConfirmedPasskeyEnrollment({
        ...shared,
        verifyAuthentication: vi.fn().mockResolvedValue({
          verifiedCredentialId: "credential-2",
          enrollmentProof: "proof",
        }),
      })
    ).rejects.toThrow("credential mismatch");

    mocks.startAuthentication.mockResolvedValueOnce({
      id: "credential-1",
      clientExtensionResults: {},
    });
    mocks.resolveCapability.mockReturnValueOnce({ state: "unsupported" });
    mocks.extractPrf.mockReturnValueOnce(null);
    await expect(
      runAuthenticationConfirmedPasskeyEnrollment({
        ...shared,
        verifyAuthentication: vi.fn().mockResolvedValue({
          verifiedCredentialId: "credential-1",
          enrollmentProof: "proof",
        }),
      })
    ).rejects.toBeInstanceOf(PasskeyAuthenticationPrfUnavailableError);
  });
});
