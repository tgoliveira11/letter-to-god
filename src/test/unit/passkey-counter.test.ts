import { describe, expect, it } from "vitest";
import {
  MAX_WEBAUTHN_SIGNATURE_COUNTER,
  resolvePasskeyCounterAdvance,
} from "@/lib/passkey/passkey-counter";

describe("resolvePasskeyCounterAdvance", () => {
  it("advances a monotonic signature counter", () => {
    expect(resolvePasskeyCounterAdvance("7", 8)).toEqual({
      status: "advance",
      expectedCounter: "7",
      nextCounter: "8",
    });
  });

  it("keeps counterless authenticators CAS-protected through the revision", () => {
    expect(resolvePasskeyCounterAdvance("0", 0)).toEqual({
      status: "counterless",
      expectedCounter: "0",
      nextCounter: "0",
    });
  });

  it("rejects rollback and repeated non-zero counters", () => {
    expect(resolvePasskeyCounterAdvance("8", 7)).toEqual({
      status: "invalid",
      reason: "counter_not_advanced",
    });
    expect(resolvePasskeyCounterAdvance("8", 8)).toEqual({
      status: "invalid",
      reason: "counter_not_advanced",
    });
  });

  it("rejects malformed and out-of-range counters", () => {
    expect(resolvePasskeyCounterAdvance("01", 2)).toEqual({
      status: "invalid",
      reason: "invalid_stored_counter",
    });
    expect(resolvePasskeyCounterAdvance("0", MAX_WEBAUTHN_SIGNATURE_COUNTER + 1)).toEqual({
      status: "invalid",
      reason: "invalid_new_counter",
    });
  });
});
