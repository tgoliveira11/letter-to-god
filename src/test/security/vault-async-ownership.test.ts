import { afterEach, describe, expect, it } from "vitest";
import { createUserVaultKey } from "@tgoliveira/vault-core";
import {
  beginVaultOwnerOperation,
  clearVaultSessionOwnerState,
  resetVaultSessionStoreForTests,
  unlockVaultSession,
} from "@/lib/crypto-client/vault-session";
import { AsyncOwnershipController } from "@/lib/application-state/async-ownership";
import {
  assertVaultAsyncOwnershipCurrent,
  captureVaultAsyncOwnership,
} from "@/lib/application-state/vault-async-ownership";

const OWNER_A = "00000000-0000-4000-8000-0000000000aa";

describe("vault async ownership", () => {
  afterEach(() => resetVaultSessionStoreForTests());

  it("rejects a private result after logout invalidates the vault lease", async () => {
    resetVaultSessionStoreForTests();
    const operation = beginVaultOwnerOperation(OWNER_A);
    await unlockVaultSession(await createUserVaultKey(), "password", operation);
    const controller = new AsyncOwnershipController();
    const ownership = captureVaultAsyncOwnership(controller, {
      ownerId: OWNER_A,
      resourceId: "note:1",
      encryptedKeyFingerprint: "wrapped-key:a",
    });

    clearVaultSessionOwnerState();

    expect(() => assertVaultAsyncOwnershipCurrent(controller, ownership)).toThrow();
  });
});
