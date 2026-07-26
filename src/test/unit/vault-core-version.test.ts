import { lockVaultSession, unlockVaultSession } from "@/lib/crypto-client/vault-session";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createUserVaultKey,
  unlockWithPasswordEnvelope,
  userVaultKeysEqual,
} from "@tgoliveira/vault-core";
import { unlockVaultSession } from "@tgoliveira/vault-core/browser";
import { SELAHKEEP_VAULT_PROFILE } from "@/modules/vault/selahkeep-profile";

const ROOT = join(import.meta.dirname, "../../..");

function readJson(relativePath: string): { dependencies?: Record<string, string> } {
  return JSON.parse(readFileSync(join(ROOT, relativePath), "utf8")) as {
    dependencies?: Record<string, string>;
  };
}

describe("@tgoliveira/vault-core dependency", () => {
  it("package.json pins ^1.3.0", () => {
    expect(readJson("package.json").dependencies?.["@tgoliveira/vault-core"]).toBe("^1.3.0");
  });

  it("lockfile resolves 1.3.0", () => {
    const lock = readFileSync(join(ROOT, "package-lock.json"), "utf8");
    expect(lock).toContain('"@tgoliveira/vault-core": "^1.3.0"');
    expect(lock).toMatch(/"node_modules\/@tgoliveira\/vault-core":\s*\{[^}]*"version":\s*"1\.3\.0"/);
  });

  it("unlockWithPasswordEnvelope accepts scope and profile", async () => {
    const userId = "00000000-0000-4000-8000-000000000099";
    const scope = { userId, resourceId: userId };
    const vaultKey = await createUserVaultKey();
    const { createPasswordEnvelope } = await import("@tgoliveira/vault-core");
    const { envelope, kdfMetadata } = await createPasswordEnvelope(
      vaultKey,
      "test-password",
      scope,
      SELAHKEEP_VAULT_PROFILE
    );
    const restored = await unlockWithPasswordEnvelope(
      "test-password",
      { encryptedVaultKey: envelope.encryptedVaultKey, kdfMetadata },
      scope,
      SELAHKEEP_VAULT_PROFILE
    );
    expect(await userVaultKeysEqual(vaultKey, restored)).toBe(true);
  });

  it("unlockVaultSession accepts non-extractable UVK from envelope unlock", async () => {
    const userId = "00000000-0000-4000-8000-000000000100";
    const scope = { userId, resourceId: userId };
    const vaultKey = await createUserVaultKey();
    const { createPasswordEnvelope } = await import("@tgoliveira/vault-core");
    const { envelope, kdfMetadata } = await createPasswordEnvelope(
      vaultKey,
      "session-password",
      scope,
      SELAHKEEP_VAULT_PROFILE
    );
    const restored = await unlockWithPasswordEnvelope(
      "session-password",
      { encryptedVaultKey: envelope.encryptedVaultKey, kdfMetadata },
      scope,
      SELAHKEEP_VAULT_PROFILE
    );
    await expect(unlockVaultSession(restored)).resolves.toBeUndefined();
  });
});
