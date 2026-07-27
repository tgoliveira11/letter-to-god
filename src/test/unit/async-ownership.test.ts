import { describe, expect, it } from "vitest";
import {
  AsyncOwnershipCancelledError,
  AsyncOwnershipController,
} from "@/lib/application-state/async-ownership";

const OWNER_A = "00000000-0000-4000-8000-0000000000aa";
const OWNER_B = "00000000-0000-4000-8000-0000000000bb";

describe("AsyncOwnershipController", () => {
  it("allows only the latest request generation to commit", () => {
    const ownership = new AsyncOwnershipController();
    const first = ownership.capture({ ownerId: OWNER_A, leaseEpoch: 4, resourceId: "note:1" });
    const second = ownership.capture({ ownerId: OWNER_A, leaseEpoch: 4, resourceId: "note:1" });

    expect(() => ownership.assertCurrent(first)).toThrow(AsyncOwnershipCancelledError);
    expect(() => ownership.assertCurrent(second)).not.toThrow();
  });

  it.each([
    ["owner", { ownerId: OWNER_B, leaseEpoch: 4, resourceId: "note:1" }],
    ["lease", { ownerId: OWNER_A, leaseEpoch: 5, resourceId: "note:1" }],
    ["resource", { ownerId: OWNER_A, leaseEpoch: 4, resourceId: "note:2" }],
    [
      "encrypted key fingerprint",
      {
        ownerId: OWNER_A,
        leaseEpoch: 4,
        resourceId: "note:1",
        encryptedKeyFingerprint: "key:b",
      },
    ],
  ])("rejects a stale result after the %s scope changes", (_label, nextScope) => {
    const ownership = new AsyncOwnershipController();
    const stale = ownership.capture({
      ownerId: OWNER_A,
      leaseEpoch: 4,
      resourceId: "note:1",
      encryptedKeyFingerprint: "key:a",
    });
    ownership.capture(nextScope);

    expect(() => ownership.assertCurrent(stale)).toThrow(AsyncOwnershipCancelledError);
  });

  it("invalidates every outstanding result synchronously", () => {
    const ownership = new AsyncOwnershipController();
    const stale = ownership.capture({ ownerId: OWNER_A, leaseEpoch: 4, resourceId: "notes:list" });

    ownership.invalidate();

    expect(ownership.isCurrent(stale)).toBe(false);
    expect(() => ownership.assertCurrent(stale)).toThrow(AsyncOwnershipCancelledError);
  });
});
