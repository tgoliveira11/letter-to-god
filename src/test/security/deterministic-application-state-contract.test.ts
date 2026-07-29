import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../../..");

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

describe("deterministic application-state contract", () => {
  it("pins the cross-package baseline exactly", () => {
    const packageJson = JSON.parse(source("package.json")) as {
      dependencies: Record<string, string>;
    };
    expect(packageJson.dependencies).toMatchObject({
      "@tgoliveira/secure-auth": "0.10.0",
      "@tgoliveira/vault-core": "1.8.0",
      "@tgoliveira/outpost": "1.2.2",
      next: "16.2.11",
      "next-auth": "4.24.15",
    });
  });

  it("keeps the server bootstrap non-secret and seeds the root providers", () => {
    const bootstrap = source("src/lib/app-bootstrap.ts");
    const layout = source("src/app/layout.tsx");
    const providers = source("src/components/secure-auth-providers.tsx");

    expect(bootstrap).toContain('import "server-only"');
    expect(bootstrap).toContain("secureAuth.uiConfig");
    expect(bootstrap).toContain("Promise.allSettled");
    expect(bootstrap).not.toContain("@/lib/crypto-client/notes");
    expect(bootstrap).not.toContain("getSessionVaultKey");
    expect(layout).toContain("resolveAppBootstrap");
    expect(providers).toContain("session={bootstrap.session}");
    expect(providers).toContain("AppBootstrapBoundary");
  });

  it("does not reconstruct auth UI configuration in login or registration pages", () => {
    for (const path of [
      "src/app/(auth)/login/page.tsx",
      "src/app/(auth)/register/page.tsx",
    ]) {
      const page = source(path);
      expect(page).not.toContain("NEXT_PUBLIC_AUTH_");
      expect(page).not.toContain("secure-auth-ui-public-config");
    }
    expect(existsSync(join(ROOT, "src/lib/secure-auth-ui-public-config.ts"))).toBe(false);
  });

  it("uses segment loading boundaries without masking root not-found", () => {
    expect(existsSync(join(ROOT, "src/app/(public)/loading.tsx"))).toBe(true);
    expect(existsSync(join(ROOT, "src/app/(auth)/loading.tsx"))).toBe(true);
    expect(existsSync(join(ROOT, "src/app/(vault)/loading.tsx"))).toBe(true);
    expect(existsSync(join(ROOT, "src/app/loading.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "src/app/error.tsx"))).toBe(true);
    expect(existsSync(join(ROOT, "src/app/global-error.tsx"))).toBe(true);
  });

  it("delegates preferences and includes their schema readiness migration", () => {
    expect(source("src/app/api/account/preferences/route.ts")).toContain(
      "secureAuth.routes.accountPreferences"
    );
    expect(source("src/app/api/account/preferences/[key]/route.ts")).toContain(
      "secureAuth.routes.accountPreferencesByKey"
    );
    expect(source("src/app/api/account/preferences/export/route.ts")).toContain(
      "secureAuth.routes.accountPreferencesExport"
    );
    expect(source("drizzle/0022_secure_auth_user_preferences.sql")).toContain(
      'CREATE TABLE "user_preferences"'
    );
    expect(source("src/lib/secure-auth-schema.ts")).toContain('"user_preferences"');
    expect(source("drizzle/0023_secure_auth_passkey_counter_revision.sql")).toContain(
      'ADD COLUMN IF NOT EXISTS "counter_revision" integer DEFAULT 0 NOT NULL'
    );
    expect(source("src/lib/secure-auth-schema.ts")).toContain('"counter_revision"');
  });

  it("persists password KDF upgrades only through the lease-guarded ciphertext route", () => {
    const hook = source("src/features/vault/use-vault.ts");
    const route = source("src/app/api/vault/password-envelope/route.ts");
    expect(hook).toContain("assertVaultSessionLeaseCurrent(lease)");
    expect(hook).toContain("vaultApi.replacePasswordEnvelope");
    expect(route).toContain("assertNoVaultPlaintextFields(body)");
    expect(route).toContain("requireFullyAuthenticatedUser()");
    expect(route).not.toContain("vaultPassword");
  });

  it("keeps the normative TDR and contribution enforcement active", () => {
    expect(source("docs/TDR_DETERMINISTIC_APPLICATION_STATE.md")).toContain(
      "ownerId + leaseEpoch + resourceId + encryptedKeyFingerprint? + generation"
    );
    expect(source("AGENTS.md")).toContain("Deterministic private state");
    expect(existsSync(join(ROOT, ".cursor/rules/deterministic-application-state.mdc"))).toBe(true);
  });
});
