import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  delegate: vi.fn(),
  findByCredentialId: vi.fn(),
  passkeyPrfExtensions: vi.fn(),
}));

vi.mock("@/lib/secure-auth", () => ({
  secureAuth: {
    routes: {
      passkeyLoginOptions: { POST: mocks.delegate },
    },
  },
}));

vi.mock("@/server/repositories/passkey-repository", () => ({
  passkeyRepository: { findByCredentialId: mocks.findByCredentialId },
}));

vi.mock("@/lib/passkey/prf", () => ({
  passkeyPrfExtensions: mocks.passkeyPrfExtensions,
}));

describe("passkey login options route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.delegate.mockResolvedValue(
      Response.json({
        options: {
          challenge: "abc",
          allowCredentials: [{ id: "cred-1", type: "public-key" }],
        },
      })
    );
    mocks.passkeyPrfExtensions.mockReturnValue({ prf: { eval: { first: "public-salt" } } });
  });

  it("keeps secure-auth as the options/challenge owner", async () => {
    mocks.findByCredentialId.mockResolvedValue({
      userId: "user-1",
      vaultUnlockEnabled: false,
    });
    const { POST } = await import("@/app/api/auth/passkey/login/options/route");
    const request = new Request("http://localhost", { method: "POST" });
    const response = await POST(request);

    expect(mocks.delegate).toHaveBeenCalledWith(request);
    expect(await response.json()).toEqual({
      options: {
        challenge: "abc",
        allowCredentials: [{ id: "cred-1", type: "public-key" }],
      },
    });
    expect(mocks.passkeyPrfExtensions).not.toHaveBeenCalled();
  });

  it("adds only public PRF input when an allowed credential already has vault capability", async () => {
    mocks.findByCredentialId.mockResolvedValue({
      userId: "user-1",
      vaultUnlockEnabled: true,
    });
    const { POST } = await import("@/app/api/auth/passkey/login/options/route");
    const response = await POST(new Request("http://localhost", { method: "POST" }));
    const body = await response.json();

    expect(mocks.passkeyPrfExtensions).toHaveBeenCalledWith("user-1");
    expect(body.options.extensions).toEqual({
      prf: { eval: { first: "public-salt" } },
    });
  });
});
