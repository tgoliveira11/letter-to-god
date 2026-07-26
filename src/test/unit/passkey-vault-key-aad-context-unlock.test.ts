import { describe, it, expect } from "vitest";
import { isVaultKeyAadContextAllowed } from "@tgoliveira/vault-core";
import { SELAHKEEP_VAULT_PROFILE } from "@/modules/vault/selahkeep-profile";

describe("passkey vault-key AAD context routing", () => {
  it("keeps legacy missing and null contexts readable during migration", () => {
    expect(isVaultKeyAadContextAllowed(undefined, SELAHKEEP_VAULT_PROFILE)).toBe(true);
    expect(isVaultKeyAadContextAllowed(null, SELAHKEEP_VAULT_PROFILE)).toBe(true);
  });

  it("accepts the exact canonical context for current envelopes", () => {
    expect(
      isVaultKeyAadContextAllowed(
        SELAHKEEP_VAULT_PROFILE.aadContextEnvelope,
        SELAHKEEP_VAULT_PROFILE
      )
    ).toBe(true);
  });

  it("rejects arbitrary explicit legacy context strings", () => {
    expect(isVaultKeyAadContextAllowed("selahkeep:unknown:v0", SELAHKEEP_VAULT_PROFILE)).toBe(
      false
    );
    expect(SELAHKEEP_VAULT_PROFILE.legacyVaultKeyAadContexts).toBeUndefined();
  });
});
