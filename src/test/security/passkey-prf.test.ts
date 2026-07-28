import { describe, expect, it } from "vitest";
import { passkeyPrfExtensions } from "@/lib/passkey/prf";
import { base64UrlToBytes } from "@/lib/crypto-client/encoding";

describe("passkey PRF salt", () => {
  const userId = "550e8400-e29b-41d4-a716-446655440000";

  async function saltForUser(): Promise<string> {
    const extensions = (await passkeyPrfExtensions(userId)) as {
      prf?: { eval?: { first?: string }; evalByCredential?: unknown };
    };
    return extensions.prf?.eval?.first ?? "";
  }

  it("derives a stable 32-byte salt per user", async () => {
    const a = base64UrlToBytes(await saltForUser());
    const b = base64UrlToBytes(await saltForUser());
    expect(a).toHaveLength(32);
    expect(a).toEqual(b);
  });

  it("encodes salt as base64url for WebAuthn extensions", async () => {
    expect(base64UrlToBytes(await saltForUser())).toHaveLength(32);
  });

  it("builds WebAuthn PRF extension payload", async () => {
    const extensions = await passkeyPrfExtensions(userId);
    expect(extensions).toHaveProperty("prf");
  });

  it("always uses prf.eval (single credential, never evalByCredential)", async () => {
    const extensions = (await passkeyPrfExtensions(userId)) as {
      prf?: { eval?: { first?: string }; evalByCredential?: unknown };
    };
    expect(extensions.prf?.eval?.first).toBe(await saltForUser());
    expect(extensions.prf?.evalByCredential).toBeUndefined();
  });
});
