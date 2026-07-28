import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");

function readSource(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

const forbiddenPaths = [
  "src/modules/auth",
  "src/modules/account",
  "src/modules/sessions",
  "src/modules/two-factor",
  "src/features/passkey/sign-in-with-passkey.ts",
  "src/lib/secure-auth/react-client.ts",
  "src/lib/secure-auth/react-client-reexports.ts",
  "src/lib/password-policy.ts",
  "src/modules/security/password-policy",
  "src/modules/security/password-policy.ts",
  "src/modules/security/policies/password-hashing.ts",
  "src/server/policies/password-hashing.ts",
  "src/server/services/account-service.ts",
  "src/server/services/passkey-account-service.ts",
  "src/server/services/passkey-login-service.ts",
  "src/components/auth",
  "src/components/settings",
];

const delegatedAuthRoutes = [
  "src/app/api/auth/register/route.ts",
  "src/app/api/auth/forgot-password/route.ts",
  "src/app/api/auth/reset-password/route.ts",
  "src/app/api/auth/password-policy/route.ts",
  "src/app/api/auth/verify-email/confirm/route.ts",
  "src/app/api/auth/verify-email/resend/route.ts",
  "src/app/api/auth/login/start/route.ts",
  "src/app/api/auth/login/verify-2fa/route.ts",
  "src/app/api/auth/login/verify-2fa-oauth/route.ts",
  "src/app/api/auth/login/oauth-2fa-complete/route.ts",
  "src/app/api/auth/magic-link/request/route.ts",
  "src/app/api/auth/magic-link/verify/route.ts",
  "src/app/api/auth/passkey/login/verify/route.ts",
  "src/app/api/auth/package-health/route.ts",
  "src/app/api/auth/[...nextauth]/route.ts",
  "src/app/api/auth/admin/users/route.ts",
  "src/app/api/auth/admin/users/[id]/route.ts",
  "src/app/api/auth/admin/waitlist/route.ts",
  "src/app/api/auth/admin/locks/route.ts",
  "src/app/api/auth/admin/invites/route.ts",
  "src/app/api/auth/admin/api-keys/route.ts",
  "src/app/api/auth/admin/config/route.ts",
  "src/app/api/account/route.ts",
  "src/app/api/account/change-password/route.ts",
  "src/app/api/account/sessions/route.ts",
  "src/app/api/account/2fa/status/route.ts",
  "src/app/api/account/passkeys/route.ts",
];

const productVaultRoutes = [
  "src/app/api/notes/route.ts",
  "src/app/api/vault/status/route.ts",
  "src/app/api/vault/settings/route.ts",
  "src/app/api/passkeys/route.ts",
  "src/app/api/account/passkeys/[id]/enable-vault-unlock/route.ts",
];

describe("no local auth implementation guard", () => {
  it("does not keep competing local auth module trees or shims", () => {
    for (const relativePath of forbiddenPaths) {
      expect(existsSync(path.join(root, relativePath))).toBe(false);
    }
  });

  it("pins @tgoliveira/secure-auth to 0.9.0", () => {
    const packageJson = JSON.parse(readSource("package.json")) as {
      dependencies: Record<string, string>;
    };
    expect(packageJson.dependencies["@tgoliveira/secure-auth"]).toBe("0.9.0");

    const lockfile = readSource("package-lock.json");
    expect(lockfile).toContain('"@tgoliveira/secure-auth": "0.9.0"');
    expect(lockfile).toContain("secure-auth-0.9.0.tgz");
  });

  it("delegates account auth API routes to @tgoliveira/secure-auth", () => {
    for (const relativePath of delegatedAuthRoutes) {
      const source = readSource(relativePath);
      expect(source).toContain("secureAuth.routes");
      expect(source).not.toMatch(/bcrypt\.(hash|compare)/);
      expect(source).not.toContain("userRepository.create");
    }
  });

  it("keeps account passkey login options as a thin package delegate", () => {
    const source = readSource("src/app/api/auth/passkey/login/options/route.ts");
    expect(source).toContain("secureAuth.routes.passkeyLoginOptions");
    expect(source).not.toContain("passkeyLoginVaultService");
    expect(source).not.toMatch(/bcrypt\.(hash|compare)/);
  });

  it("does not override the package passkey login client", () => {
    expect(() => readSource("src/lib/secure-auth/vault-passkey-react-client.ts")).toThrow();
    expect(readSource("next.config.ts")).not.toContain("secure-auth/react/client");
    expect(readSource("vitest.config.ts")).not.toContain("secure-auth/react/client");
  });

  it("keeps a single createSecureAuth composition root", () => {
    const source = readSource("src/lib/secure-auth.ts");
    expect(source).toContain("createSecureAuth");
    expect(source).not.toContain("createAuthServices");
    expect(source).not.toContain("@tgoliveira/secure-auth/server");
  });

  it("does not import removed local auth modules from product code", () => {
    for (const relativePath of productVaultRoutes) {
      const source = readSource(relativePath);
      expect(source).not.toMatch(/@\/modules\/(auth|account|sessions|two-factor)/);
    }
  });
});
