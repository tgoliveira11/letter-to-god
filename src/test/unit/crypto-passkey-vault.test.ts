import { userVaultKeysEqual } from "@tgoliveira/vault-core";
import {
  beginVaultSessionOperation,
  clearVaultInnerKeyMaterialCache,
  type VaultSessionOperation,
} from "@tgoliveira/vault-core/browser";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractPasskeyPrfOutput,
  isPasskeySupported,
  wrapVaultKeyForPasskey,
  unwrapVaultKeyFromPasskey,
  unlockVaultFromPasskeyEnvelope,
  unlockVaultFromPasskeyEnvelopeCandidates,
} from "@/lib/crypto-client/passkey-vault";
import { generateUserVaultKey } from "@/lib/crypto-client/vault";
import { USER_ID } from "@/test/helpers/fixtures";

describe("passkey vault crypto", () => {
  let operation: VaultSessionOperation;

  beforeEach(() => {
    vi.clearAllMocks();
    operation = beginVaultSessionOperation(USER_ID);
    clearVaultInnerKeyMaterialCache({ operation });
  });

  it("detects passkey support when WebAuthn is available", () => {
    vi.stubGlobal("window", { PublicKeyCredential: class {} });
    expect(isPasskeySupported()).toBe(true);
    vi.unstubAllGlobals();
  });

  it("reports passkeys unsupported when WebAuthn is unavailable", () => {
    vi.stubGlobal("window", undefined);
    expect(isPasskeySupported()).toBe(false);
    vi.unstubAllGlobals();
  });

  it("extractPasskeyPrfOutput reads PRF extension output", () => {
    const bytes = new Uint8Array(32).fill(7);
    expect(
      extractPasskeyPrfOutput({
        prf: { results: { first: bytes.buffer } },
      } as never)
    ).toEqual(bytes);
    expect(extractPasskeyPrfOutput({} as never)).toBeNull();
    expect(
      extractPasskeyPrfOutput({
        prf: { results: { first: new Uint8Array(8).buffer } },
      } as never)
    ).toBeNull();
  });

  it("wraps and unwraps vault key with PRF output", async () => {
    const vaultKey = await generateUserVaultKey();
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const envelope = await wrapVaultKeyForPasskey(
      vaultKey,
      prfOutput,
      USER_ID,
      USER_ID,
      operation
    );
    const restored = await unwrapVaultKeyFromPasskey(envelope, prfOutput, {
      operation,
    });
    expect(await userVaultKeysEqual(restored, vaultKey)).toBe(true);
  });

  it("unlockVaultFromPasskeyEnvelope unlocks with PRF output only", async () => {
    const vaultKey = await generateUserVaultKey();
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const envelope = await wrapVaultKeyForPasskey(
      vaultKey,
      prfOutput,
      USER_ID,
      USER_ID,
      operation
    );
    const restored = await unlockVaultFromPasskeyEnvelope(USER_ID, envelope, prfOutput, {
      operation,
    });
    expect(restored).toBeTruthy();
  });

  it("selects a matching synced-passkey envelope candidate locally", async () => {
    const vaultKey = await generateUserVaultKey();
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const encryptedVaultKey = await wrapVaultKeyForPasskey(
      vaultKey,
      prfOutput,
      USER_ID,
      USER_ID,
      operation
    );

    const result = await unlockVaultFromPasskeyEnvelopeCandidates({
      userId: USER_ID,
      verifiedCredentialId: "credential-1",
      candidates: [
        {
          envelopeVariantId: "variant-1",
          credentialId: "credential-1",
          envelope: {
            method: "passkey_prf",
            encryptedVaultKey,
            kdfMetadata: null,
          },
        },
      ],
      prfOutput,
      operation,
    });

    expect(result.status).toBe("matched");
    if (result.status === "matched") {
      expect(result.envelopeVariantId).toBe("variant-1");
      expect(await userVaultKeysEqual(result.vaultKey, vaultKey)).toBe(true);
    }
  });

  it("rejects passkey unlock when PRF is required but unavailable", async () => {
    const vaultKey = await generateUserVaultKey();
    const prfOutput = crypto.getRandomValues(new Uint8Array(32));
    const envelope = await wrapVaultKeyForPasskey(
      vaultKey,
      prfOutput,
      USER_ID,
      USER_ID,
      operation
    );
    await expect(
      unlockVaultFromPasskeyEnvelope(USER_ID, envelope, null, {
        prfRequired: true,
        operation,
      })
    ).rejects.toMatchObject({ name: "PasskeyPrfRequiredError" });
  });
});
