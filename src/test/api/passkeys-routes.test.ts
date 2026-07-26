import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as registerPost } from "@/app/api/passkeys/register/route";
import { POST as authenticatePost } from "@/app/api/passkeys/authenticate/route";
import { USER_ID } from "@/test/helpers/fixtures";

const mocks = vi.hoisted(() => ({
  requireFullyAuthenticatedUser: vi.fn(),
  getRegistrationOptions: vi.fn(),
  verifyRegistration: vi.fn(),
  getAuthenticationOptions: vi.fn(),
  verifyAuthentication: vi.fn(),
  clearVaultDeviceBindingCookie: vi.fn(),
  StaleVaultDeviceBindingError: class StaleVaultDeviceBindingError extends Error {},
}));

vi.mock("@/lib/auth/session", () => ({
  requireFullyAuthenticatedUser: mocks.requireFullyAuthenticatedUser,
}));

vi.mock("@/lib/passkey/vault-device-binding-cookie", () => ({
  readVaultDeviceBindingIdFromCookies: vi.fn().mockResolvedValue(undefined),
  applyVaultDeviceBindingCookie: vi.fn(),
  clearVaultDeviceBindingCookie: mocks.clearVaultDeviceBindingCookie,
}));

vi.mock("@/server/services/passkey-service", () => ({
  passkeyService: {
    getRegistrationOptions: mocks.getRegistrationOptions,
    verifyRegistration: mocks.verifyRegistration,
    getAuthenticationOptions: mocks.getAuthenticationOptions,
    verifyAuthentication: mocks.verifyAuthentication,
    bindVerifiedCredentialToDevice: vi.fn(),
  },
  RateLimitError: class RateLimitError extends Error {
    name = "RateLimitError";
  },
  StaleVaultDeviceBindingError: mocks.StaleVaultDeviceBindingError,
}));

describe("passkey API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFullyAuthenticatedUser.mockResolvedValue({ id: USER_ID, email: "user@example.com" });
  });

  it("register options returns WebAuthn options", async () => {
    mocks.getRegistrationOptions.mockResolvedValue({ challenge: "abc" });
    const res = await registerPost(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "options" }),
      })
    );
    expect(res.status).toBe(200);
  });

  it("register options forwards vaultOnly for vault passkey setup", async () => {
    mocks.getRegistrationOptions.mockResolvedValue({ challenge: "abc" });
    const res = await registerPost(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "options", vaultOnly: true }),
      })
    );
    expect(res.status).toBe(200);
    expect(mocks.getRegistrationOptions).toHaveBeenCalledWith(
      USER_ID,
      "user@example.com",
      expect.anything(),
      { vaultOnly: true }
    );
  });

  it("register verify validates response", async () => {
    mocks.verifyRegistration.mockResolvedValue({ verified: true });
    const res = await registerPost(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          action: "verify",
          response: { id: "cred", clientExtensionResults: {} },
        }),
      })
    );
    expect(res.status).toBe(200);
  });

  it("authenticate options requires the vault unlock purpose", async () => {
    mocks.getAuthenticationOptions.mockResolvedValue({ challenge: "abc" });
    const res = await authenticatePost(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "options" }),
      })
    );
    expect(res.status).toBe(400);
    expect(mocks.getAuthenticationOptions).not.toHaveBeenCalled();
  });

  it("authenticate options forwards vault_unlock purpose", async () => {
    mocks.getAuthenticationOptions.mockResolvedValue({ challenge: "abc" });
    const res = await authenticatePost(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "options", purpose: "vault_unlock" }),
      })
    );
    expect(res.status).toBe(200);
    expect(mocks.getAuthenticationOptions).toHaveBeenCalledWith(
      USER_ID,
      expect.anything(),
      { purpose: "vault_unlock", deviceBindingId: undefined }
    );
  });

  it("clears a stale binding cookie and requires explicit rebind", async () => {
    mocks.getAuthenticationOptions.mockRejectedValue(
      new mocks.StaleVaultDeviceBindingError("stale")
    );
    const response = await authenticatePost(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "options", purpose: "vault_unlock" }),
      })
    );

    expect(response.status).toBe(409);
    expect(mocks.clearVaultDeviceBindingCookie).toHaveBeenCalledWith(response);
  });

  it("authenticate verify forwards vault_unlock purpose", async () => {
    mocks.verifyAuthentication.mockResolvedValue({
      verified: true,
      verifiedCredentialId: "vault-cred",
      bindingProof: "proof",
      candidates: [],
    });
    const res = await authenticatePost(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({
          action: "verify",
          purpose: "vault_unlock",
          response: { id: "vault-cred", clientExtensionResults: {} },
        }),
      })
    );
    expect(res.status).toBe(200);
    expect(mocks.verifyAuthentication).toHaveBeenCalledWith(
      USER_ID,
      { id: "vault-cred", clientExtensionResults: {} },
      { purpose: "vault_unlock", deviceBindingId: undefined }
    );
  });

  it("authenticate verify rejects a missing purpose", async () => {
    const res = await authenticatePost(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "verify", response: { id: "cred" } }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("authenticate rejects invalid body", async () => {
    const res = await authenticatePost(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "invalid" }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("authenticate verify requires response body", async () => {
    const res = await authenticatePost(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "verify" }),
      })
    );
    expect(res.status).toBe(400);
  });
});
