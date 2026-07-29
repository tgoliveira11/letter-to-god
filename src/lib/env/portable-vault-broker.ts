import "server-only";

import { readBoolEnv, readEnv, readIntEnv } from "@/lib/env/parse";

export const DEFAULT_PORTABLE_VAULT_BROKER_URL =
  "https://vault-broker-green.vercel.app";

export type PortableVaultBrokerPublicConfig = {
  enabled: boolean;
  brokerUrl: string;
};

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = readEnv(env, key);
  if (!value) throw new Error(`${key} is required when portable vault broker is enabled`);
  return value;
}

function normalizedUrl(value: string, key: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${key} must be an absolute URL`);
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error(`${key} must use HTTPS`);
  }
  return parsed.origin;
}

export function resolvePortableVaultBrokerPublicConfig(
  env: NodeJS.ProcessEnv = process.env
): PortableVaultBrokerPublicConfig {
  return {
    enabled: readBoolEnv(env, "VAULT_PORTABLE_BROKER_ENABLED", false),
    brokerUrl: normalizedUrl(
      readEnv(env, "VAULT_PORTABLE_BROKER_URL") ?? DEFAULT_PORTABLE_VAULT_BROKER_URL,
      "VAULT_PORTABLE_BROKER_URL"
    ),
  };
}

export function resolvePortableVaultGrantConfig(
  env: NodeJS.ProcessEnv,
  appBaseUrl: string
) {
  const publicConfig = resolvePortableVaultBrokerPublicConfig(env);
  if (!publicConfig.enabled) return undefined;

  return {
    enabled: true as const,
    issuer: normalizedUrl(
      readEnv(env, "PORTABLE_VAULT_GRANT_ISSUER") ?? appBaseUrl,
      "PORTABLE_VAULT_GRANT_ISSUER"
    ),
    appId: readEnv(env, "PORTABLE_VAULT_BROKER_APP_ID") ?? "selahkeep",
    audience: normalizedUrl(
      readEnv(env, "PORTABLE_VAULT_GRANT_AUDIENCE") ?? publicConfig.brokerUrl,
      "PORTABLE_VAULT_GRANT_AUDIENCE"
    ),
    ttlSeconds: readIntEnv(env, "PORTABLE_VAULT_GRANT_TTL_SECONDS", 60, {
      min: 15,
      max: 120,
    }),
    opaqueSubjectKey: required(env, "PORTABLE_VAULT_SUBJECT_KEY"),
    grantPrivateJwkB64: required(env, "PORTABLE_VAULT_GRANT_PRIVATE_JWK_B64"),
    brokerReceiptIssuer: normalizedUrl(
      readEnv(env, "PORTABLE_VAULT_BROKER_RECEIPT_ISSUER") ?? publicConfig.brokerUrl,
      "PORTABLE_VAULT_BROKER_RECEIPT_ISSUER"
    ),
    brokerReceiptPublicJwksB64: required(
      env,
      "PORTABLE_VAULT_BROKER_RECEIPT_PUBLIC_JWKS_B64"
    ),
  };
}

export function isLegacyPasskeyPrfEnrollmentEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return readBoolEnv(
    env,
    "VAULT_LEGACY_PASSKEY_PRF_ENROLLMENT_ENABLED",
    !resolvePortableVaultBrokerPublicConfig(env).enabled
  );
}
