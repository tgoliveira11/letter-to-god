import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  delegate: vi.fn(),
}));

vi.mock("@/lib/secure-auth", () => ({
  secureAuth: {
    routes: {
      passkeyLoginOptions: { POST: mocks.delegate },
    },
  },
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
  });

  it("is a pure secure-auth delegate; server extension composition stays in package config", async () => {
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
  });
});
