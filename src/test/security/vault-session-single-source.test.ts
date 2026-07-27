import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { userVaultKeysEqual } from "@tgoliveira/vault-core";
import { generateUserVaultKey } from "@/lib/crypto-client/vault";
import {
  wrapVaultKeyForPassword,
  unwrapVaultKeyFromPassword,
} from "@/lib/crypto-client/vault-envelope";
import {
  getVaultSessionSnapshot,
  beginVaultOwnerOperation,
  hasUnlockedVaultSession,
  lockVaultSessionManually,
  resetVaultSessionStoreForTests,
  subscribeVaultSession,
  lockVaultSession,
} from "@/lib/crypto-client/vault-session";

const APPROVED_VAULT_CORE_BROWSER_IMPORTS = new Set([
  "src/lib/crypto-client/vault-session.ts",
  "src/lib/crypto-client/vault-passkey-browser.ts",
  "src/lib/vault/register-selahkeep-vault-lock-cleanup.ts",
  "src/components/vault-providers.tsx",
  "src/components/browser-capabilities-provider.tsx",
  "src/features/vault/vault-status-dock.tsx",
  "src/features/vault/use-ltg-vault-setup.ts",
  "src/features/vault/use-vault.ts",
  "src/features/passkey/unlock-with-passkey.ts",
  "src/features/passkey/passkey-vault-unlock-setup.tsx",
  "src/features/recovery/passkey-setup.tsx",
  "src/features/recovery/use-replace-recovery-phrase.ts",
  "src/features/notes/eager-decrypt-notes.ts",
  "src/app/(vault)/vault/unlock/page.tsx",
  "src/app/(vault)/notes/new/page.tsx",
  "src/lib/application-state/vault-async-ownership.ts",
  "src/lib/crypto-client/vault.ts",
  "src/lib/passkey/vault-unlock-authenticate.ts",
  "src/lib/passkey/prepare-webauthn-options.ts",
  "src/lib/passkey/prf-support.ts",
  "src/modules/vault/core/envelopes/password-envelope.ts",
  "src/modules/vault/core/envelopes/recovery-envelope.ts",
  "src/modules/vault/core/envelopes/passkey-prf-envelope.ts",
]);

const DISALLOWED_VAULT_CORE_BROWSER_SCAN_ROOTS = [
  "src/features",
  "src/components",
  "src/app",
  "src/modules",
  "src/server",
];

function listSourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) {
      files.push(fullPath);
    }
  }
  return files;
}

const USER_ID = "00000000-0000-4000-8000-000000000001";

describe("vault session single source of truth", () => {
  it("password unlock after manual lock updates the same session controller", async () => {
    resetVaultSessionStoreForTests();
    lockVaultSession();
    lockVaultSessionManually();
    expect(hasUnlockedVaultSession()).toBe(false);

    const vaultKey = await generateUserVaultKey();
    const password = "correct-horse-battery-staple-vault";
    const { encryptedVaultKey, kdfMetadata } = await wrapVaultKeyForPassword(vaultKey, password, {
      userId: USER_ID,
      resourceId: USER_ID,
    });

    const unwrapped = await unwrapVaultKeyFromPassword(password, encryptedVaultKey, kdfMetadata, {
      applySession: true,
      unlockMethod: "password",
      operation: beginVaultOwnerOperation(USER_ID),
    });

    expect(await userVaultKeysEqual(vaultKey, unwrapped)).toBe(true);
    expect(hasUnlockedVaultSession()).toBe(true);
    expect(getVaultSessionSnapshot().status).toBe("unlocked");
    expect(getVaultSessionSnapshot().unlockMethod).toBe("password");
  });

  it("notifies subscribers when password unlock clears manual lock", async () => {
    resetVaultSessionStoreForTests();
    lockVaultSession();
    lockVaultSessionManually();

    const vaultKey = await generateUserVaultKey();
    const password = "another-strong-vault-password";
    const { encryptedVaultKey, kdfMetadata } = await wrapVaultKeyForPassword(vaultKey, password, {
      userId: USER_ID,
      resourceId: USER_ID,
    });

    const snapshots: string[] = [];
    const unsubscribe = subscribeVaultSession((state) => {
      snapshots.push(state.status);
    });

    await unwrapVaultKeyFromPassword(password, encryptedVaultKey, kdfMetadata, {
      applySession: true,
      unlockMethod: "password",
      operation: beginVaultOwnerOperation(USER_ID),
    });

    unsubscribe();
    expect(snapshots).toContain("unlocked");
    expect(hasUnlockedVaultSession()).toBe(true);
  });

  it("applySession false does not clear manual lock or set unlocked session", async () => {
    resetVaultSessionStoreForTests();
    lockVaultSession();
    lockVaultSessionManually();

    const vaultKey = await generateUserVaultKey();
    const password = "session-not-applied-password";
    const { encryptedVaultKey, kdfMetadata } = await wrapVaultKeyForPassword(vaultKey, password, {
      userId: USER_ID,
      resourceId: USER_ID,
    });

    await unwrapVaultKeyFromPassword(password, encryptedVaultKey, kdfMetadata, {
      applySession: false,
      operation: beginVaultOwnerOperation(USER_ID),
    });

    expect(hasUnlockedVaultSession()).toBe(false);
    expect(getVaultSessionSnapshot().status).toBe("locked");
  });

  it("blocks @tgoliveira/vault-core/browser imports outside approved adapters", () => {
    const repoRoot = process.cwd();
    const violations: string[] = [];

    for (const root of DISALLOWED_VAULT_CORE_BROWSER_SCAN_ROOTS) {
      const absoluteRoot = path.join(repoRoot, root);
      for (const file of listSourceFiles(absoluteRoot)) {
        const relative = path.relative(repoRoot, file).split(path.sep).join("/");
        if (APPROVED_VAULT_CORE_BROWSER_IMPORTS.has(relative)) continue;
        const content = readFileSync(file, "utf8");
        if (content.includes("@tgoliveira/vault-core/browser")) {
          violations.push(relative);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("allows @tgoliveira/vault-core/browser only in approved adapter files", () => {
    const repoRoot = process.cwd();
    const allSrcFiles = listSourceFiles(path.join(repoRoot, "src")).filter(
      (file) => !file.includes(`${path.sep}test${path.sep}`)
    );
    const importers = allSrcFiles
      .map((file) => path.relative(repoRoot, file).split(path.sep).join("/"))
      .filter((relative) => {
        const content = readFileSync(path.join(repoRoot, relative), "utf8");
        return content.includes("@tgoliveira/vault-core/browser");
      });

    for (const relative of importers) {
      expect(APPROVED_VAULT_CORE_BROWSER_IMPORTS.has(relative)).toBe(true);
    }
    expect(importers).toContain("src/lib/crypto-client/vault-session.ts");
  });

  it("delegates in-memory UVK to vault-core browser session via adapter", () => {
    const sessionModule = readFileSync(
      path.join(process.cwd(), "src/lib/crypto-client/vault-session.ts"),
      "utf8"
    );
    expect(sessionModule).toContain("@tgoliveira/vault-core/browser");
    expect(sessionModule).toContain("setUnlockedVaultSession");
    expect(sessionModule).toContain("coreUnlockVaultSession");
  });
});
