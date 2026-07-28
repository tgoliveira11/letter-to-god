export const MAX_WEBAUTHN_SIGNATURE_COUNTER = 0xffff_ffff;

export type PasskeyCounterAdvancePlan =
  | {
      status: "advance" | "counterless";
      expectedCounter: string;
      nextCounter: string;
    }
  | {
      status: "invalid";
      reason: "invalid_stored_counter" | "invalid_new_counter" | "counter_not_advanced";
    };

function parseCounter(value: string | number): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > MAX_WEBAUTHN_SIGNATURE_COUNTER ||
    (typeof value === "string" && String(parsed) !== value)
  ) {
    return null;
  }
  return parsed;
}

/**
 * Mirrors the secure-auth public persistence contract for the shared credential row.
 * Counterless authenticators still advance counter_revision through compare-and-set.
 */
export function resolvePasskeyCounterAdvance(
  storedCounter: string,
  newCounter: number
): PasskeyCounterAdvancePlan {
  const stored = parseCounter(storedCounter);
  if (stored === null) return { status: "invalid", reason: "invalid_stored_counter" };

  const next = parseCounter(newCounter);
  if (next === null) return { status: "invalid", reason: "invalid_new_counter" };

  if (stored === 0 && next === 0) {
    return { status: "counterless", expectedCounter: "0", nextCounter: "0" };
  }
  if (next <= stored) return { status: "invalid", reason: "counter_not_advanced" };

  return {
    status: "advance",
    expectedCounter: String(stored),
    nextCounter: String(next),
  };
}
