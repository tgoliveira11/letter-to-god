import { describe, expect, it } from "vitest";
import {
  isLegacyPasskeyPrfEnrollmentEnabled,
  resolvePortableVaultBrokerPublicConfig,
  resolvePortableVaultGrantConfig,
} from "@/lib/env/portable-vault-broker";

describe("portable vault broker environment", () => {
  it("is disabled by default and keeps legacy enrollment available for rollback", () => {
    expect(resolvePortableVaultBrokerPublicConfig({})).toEqual({
      enabled: false,
      brokerUrl: "https://vault-broker-green.vercel.app",
    });
    expect(resolvePortableVaultGrantConfig({}, "https://www.selahkeep.com")).toBeUndefined();
    expect(isLegacyPasskeyPrfEnrollmentEnabled({})).toBe(true);
  });

  it("builds the exact secure-auth grant configuration while closing legacy enrollment", () => {
    const env = {
      VAULT_PORTABLE_BROKER_ENABLED: "true",
      VAULT_PORTABLE_BROKER_URL: "https://vault-broker-green.vercel.app/path",
      PORTABLE_VAULT_SUBJECT_KEY: "opaque-subject-key",
      PORTABLE_VAULT_GRANT_PRIVATE_JWK_B64: "private-jwk",
      PORTABLE_VAULT_BROKER_RECEIPT_PUBLIC_JWKS_B64: "public-jwks",
    } as NodeJS.ProcessEnv;

    expect(resolvePortableVaultGrantConfig(env, "https://www.selahkeep.com")).toEqual({
      enabled: true,
      issuer: "https://www.selahkeep.com",
      appId: "selahkeep",
      audience: "https://vault-broker-green.vercel.app",
      ttlSeconds: 60,
      opaqueSubjectKey: "opaque-subject-key",
      grantPrivateJwkB64: "private-jwk",
      brokerReceiptIssuer: "https://vault-broker-green.vercel.app",
      brokerReceiptPublicJwksB64: "public-jwks",
    });
    expect(isLegacyPasskeyPrfEnrollmentEnabled(env)).toBe(false);
  });

  it("requires secrets and HTTPS when enabled", () => {
    expect(() =>
      resolvePortableVaultGrantConfig(
        { VAULT_PORTABLE_BROKER_ENABLED: "true" },
        "https://www.selahkeep.com"
      )
    ).toThrow("PORTABLE_VAULT_SUBJECT_KEY");
    expect(() =>
      resolvePortableVaultBrokerPublicConfig({
        VAULT_PORTABLE_BROKER_URL: "http://remote.example.com",
      })
    ).toThrow("must use HTTPS");
  });
});
