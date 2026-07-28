import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  delegate: vi.fn(),
  requireFullyAuthenticatedUser: vi.fn(),
  issueRegistrationEnrollmentProof: vi.fn(),
  applyProofCookie: vi.fn((response: Response) => response),
}));

vi.mock("@/lib/secure-auth", () => ({
  secureAuth: {
    routes: { passkeyRegister: { POST: mocks.delegate } },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireFullyAuthenticatedUser: mocks.requireFullyAuthenticatedUser,
}));

vi.mock("@/server/services/passkey-vault-envelope-service", () => ({
  passkeyVaultEnvelopeService: {
    issueRegistrationEnrollmentProof: mocks.issueRegistrationEnrollmentProof,
  },
}));

vi.mock("@/lib/passkey/vault-registration-proof-cookie", () => ({
  applyVaultRegistrationProofCookie: mocks.applyProofCookie,
}));

describe("account passkey registration interop route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFullyAuthenticatedUser.mockResolvedValue({ id: "user-1" });
    mocks.issueRegistrationEnrollmentProof.mockResolvedValue({
      enrollmentProof: "registration-proof-with-sufficient-length",
    });
  });

  it("keeps options as an unchanged secure-auth delegate", async () => {
    mocks.delegate.mockResolvedValue(Response.json({ challenge: "abc" }));
    const { POST } = await import("@/app/api/account/passkeys/register/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "options" }),
      })
    );

    expect(await response.json()).toEqual({ challenge: "abc" });
    expect(mocks.issueRegistrationEnrollmentProof).not.toHaveBeenCalled();
  });

  it("issues an app receipt only after secure-auth verifies the exact credential", async () => {
    mocks.delegate.mockResolvedValue(
      Response.json({ verified: true, credentialId: "credential-1" })
    );
    const { POST } = await import("@/app/api/account/passkeys/register/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "verify", response: { id: "credential-1" } }),
      })
    );

    expect(mocks.issueRegistrationEnrollmentProof).toHaveBeenCalledWith(
      "user-1",
      "credential-1"
    );
    expect(mocks.applyProofCookie).toHaveBeenCalledWith(
      response,
      "registration-proof-with-sufficient-length"
    );
    expect(await response.json()).toMatchObject({ verified: true, credentialId: "credential-1" });
  });

  it("does not make account registration depend on optional vault receipt issuance", async () => {
    mocks.delegate.mockResolvedValue(
      Response.json({ verified: true, credentialId: "credential-1" })
    );
    mocks.issueRegistrationEnrollmentProof.mockRejectedValue(new Error("vault unavailable"));
    const { POST } = await import("@/app/api/account/passkeys/register/route");
    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ action: "verify", response: { id: "credential-1" } }),
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ verified: true, credentialId: "credential-1" });
    expect(mocks.applyProofCookie).not.toHaveBeenCalled();
  });
});
