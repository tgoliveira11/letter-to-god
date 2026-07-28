import { describe, expect, it } from "vitest";
import {
  AUTHENTICATION_CONFIRMED_PRF_CEREMONY,
  isAuthenticationConfirmedPasskeyVariant,
} from "@/lib/passkey/passkey-envelope-variant-metadata";

describe("passkey envelope variant metadata", () => {
  it("recognizes only authentication-confirmed variants", () => {
    expect(AUTHENTICATION_CONFIRMED_PRF_CEREMONY).toBe("authentication");
    expect(
      isAuthenticationConfirmedPasskeyVariant({
        publicMetadata: { prfCeremony: "authentication" },
      })
    ).toBe(true);
    expect(
      isAuthenticationConfirmedPasskeyVariant({
        publicMetadata: { prfCeremony: "registration" },
      })
    ).toBe(false);
    expect(isAuthenticationConfirmedPasskeyVariant({ publicMetadata: null })).toBe(false);
  });
});
