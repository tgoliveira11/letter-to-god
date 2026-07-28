import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ delegate: vi.fn() }));

vi.mock("@/lib/secure-auth", () => ({
  secureAuth: {
    routes: { passkeyRegister: { POST: mocks.delegate } },
  },
}));

describe("account passkey registration interop route", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates options to secure-auth without minting a vault proof", async () => {
    mocks.delegate.mockResolvedValue(Response.json({ challenge: "abc" }));
    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ action: "options" }),
    });
    const { POST } = await import("@/app/api/account/passkeys/register/route");

    const response = await POST(request);

    expect(mocks.delegate).toHaveBeenCalledWith(request);
    expect(await response.json()).toEqual({ challenge: "abc" });
  });

  it("delegates registration verification unchanged and never adds a durable vault receipt", async () => {
    mocks.delegate.mockResolvedValue(
      Response.json({ verified: true, credentialId: "credential-1" })
    );
    const request = new Request("http://localhost", {
      method: "POST",
      body: JSON.stringify({ action: "verify", response: { id: "credential-1" } }),
    });
    const { POST } = await import("@/app/api/account/passkeys/register/route");

    const response = await POST(request);

    expect(mocks.delegate).toHaveBeenCalledWith(request);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ verified: true, credentialId: "credential-1" });
  });
});
