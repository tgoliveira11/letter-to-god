import { lockVaultSession } from "@/lib/crypto-client/vault-session";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { unlockVaultWithPasskey } from "@/features/passkey/unlock-with-passkey";
import { generateUserVaultKey } from "@/lib/crypto-client/vault";
import { USER_ID } from "@/test/helpers/fixtures";
import {
  PASSKEY_NOT_LINKED_TO_VAULT_UNLOCK_MESSAGE,
  PASSKEY_VAULT_UNLOCK_NOT_CONFIGURED_MESSAGE,
} from "@/lib/passkey/messages";

const mocks = vi.hoisted(() => ({
  runCeremony: vi.fn(),
  runCeremonyWithOptions: vi.fn(),
  verifyAuth: vi.fn(),
  persistBinding: vi.fn(),
  extractPrf: vi.fn(),
  unlockCandidates: vi.fn(),
  resolveCapability: vi.fn(),
}));

vi.mock("@/lib/passkey/vault-unlock-credential", () => ({
  resolveActiveVaultUnlockCredentialId: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/passkey/vault-unlock-authenticate", () => ({
  runVaultUnlockAuthenticationCeremony: mocks.runCeremony,
  runVaultUnlockAuthenticationCeremonyWithOptions: mocks.runCeremonyWithOptions,
  verifyVaultUnlockAuthentication: mocks.verifyAuth,
  persistVaultPasskeyBinding: mocks.persistBinding,
}));

vi.mock("@tgoliveira/vault-core/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tgoliveira/vault-core/browser")>()),
  resolvePasskeyPrfCapability: mocks.resolveCapability,
}));

vi.mock("@/lib/crypto-client/passkey-vault", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crypto-client/passkey-vault")>()),
  extractPasskeyPrfOutput: mocks.extractPrf,
  unlockVaultFromPasskeyEnvelopeCandidates: mocks.unlockCandidates,
}));

const candidate = {
  envelopeVariantId: "550e8400-e29b-41d4-a716-446655440001",
  credentialId: "vault-cred",
  envelope: {
    method: "passkey_prf" as const,
    encryptedVaultKey: { version: "enc-v1" },
    kdfMetadata: null,
  },
};

describe("unlockVaultWithPasskey", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    lockVaultSession();
    const vaultKey = await generateUserVaultKey();
    const assertion = {
      id: "vault-cred",
      clientExtensionResults: {
        prf: { results: { first: new Uint8Array(32).fill(9).buffer } },
      },
    };
    mocks.runCeremony.mockResolvedValue(assertion);
    mocks.runCeremonyWithOptions.mockResolvedValue(assertion);
    mocks.verifyAuth.mockResolvedValue({
      verified: true,
      verifiedCredentialId: "vault-cred",
      bindingProof: "binding-proof",
      candidates: [candidate],
    });
    mocks.resolveCapability.mockReturnValue({ state: "confirmed_authentication" });
    mocks.extractPrf.mockReturnValue(new Uint8Array(32).fill(9));
    mocks.unlockCandidates.mockResolvedValue({
      status: "matched",
      envelopeVariantId: candidate.envelopeVariantId,
      candidateIndex: 0,
      vaultKey,
    });
    mocks.persistBinding.mockResolvedValue({ bindingId: "binding-1" });
  });

  it("uses the verified credential candidates and persists routing after a local match", async () => {
    const key = await unlockVaultWithPasskey(USER_ID);
    expect(key).toBeTruthy();
    expect(mocks.runCeremony).toHaveBeenCalledWith(undefined);
    expect(mocks.unlockCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ verifiedCredentialId: "vault-cred", candidates: [candidate] })
    );
    expect(mocks.persistBinding).toHaveBeenCalledWith(
      expect.objectContaining({ selectedEnvelopeVariantId: candidate.envelopeVariantId })
    );
  });

  it("passes an exact optional credential id to the ceremony", async () => {
    await unlockVaultWithPasskey(USER_ID, "vault-cred");
    expect(mocks.runCeremony).toHaveBeenCalledWith("vault-cred");
  });

  it("uses prefetched options without fetching again during the tap gesture", async () => {
    const prefetched = {
      challenge: "prefetched",
      allowCredentials: [{ id: "vault-cred", type: "public-key" as const }],
    };
    await unlockVaultWithPasskey(USER_ID, undefined, prefetched);
    expect(mocks.runCeremony).not.toHaveBeenCalled();
    expect(mocks.runCeremonyWithOptions).toHaveBeenCalledWith(prefetched, undefined);
  });

  it("fails before verify when no vault passkey is configured", async () => {
    mocks.runCeremony.mockRejectedValue(new Error(PASSKEY_VAULT_UNLOCK_NOT_CONFIGURED_MESSAGE));
    await expect(unlockVaultWithPasskey(USER_ID)).rejects.toThrow(
      PASSKEY_VAULT_UNLOCK_NOT_CONFIGURED_MESSAGE
    );
    expect(mocks.verifyAuth).not.toHaveBeenCalled();
  });

  it("rejects a server credential mismatch", async () => {
    mocks.verifyAuth.mockResolvedValue({
      verified: true,
      verifiedCredentialId: "other-credential",
      bindingProof: "proof",
      candidates: [],
    });
    await expect(unlockVaultWithPasskey(USER_ID)).rejects.toThrow(
      PASSKEY_NOT_LINKED_TO_VAULT_UNLOCK_MESSAGE
    );
    expect(mocks.unlockCandidates).not.toHaveBeenCalled();
  });

  it("maps verify not-configured errors", async () => {
    mocks.verifyAuth.mockRejectedValue(new Error(PASSKEY_VAULT_UNLOCK_NOT_CONFIGURED_MESSAGE));
    await expect(unlockVaultWithPasskey(USER_ID)).rejects.toThrow(
      PASSKEY_VAULT_UNLOCK_NOT_CONFIGURED_MESSAGE
    );
  });

  it("maps verify not-linked errors from server", async () => {
    mocks.verifyAuth.mockRejectedValue(new Error(PASSKEY_NOT_LINKED_TO_VAULT_UNLOCK_MESSAGE));
    await expect(unlockVaultWithPasskey(USER_ID)).rejects.toThrow(
      PASSKEY_NOT_LINKED_TO_VAULT_UNLOCK_MESSAGE
    );
  });

  it("rethrows unexpected ceremony errors", async () => {
    mocks.runCeremony.mockRejectedValue(new Error("WebAuthn cancelled"));
    await expect(unlockVaultWithPasskey(USER_ID)).rejects.toThrow("WebAuthn cancelled");
  });

  it("fails without PRF output and never attempts candidates", async () => {
    mocks.resolveCapability.mockReturnValue({ state: "unavailable" });
    mocks.extractPrf.mockReturnValue(null);
    await expect(unlockVaultWithPasskey(USER_ID)).rejects.toThrow("did not return PRF output");
    expect(mocks.unlockCandidates).not.toHaveBeenCalled();
    expect(mocks.persistBinding).not.toHaveBeenCalled();
  });

  it("does not mutate routing when no candidate matches", async () => {
    mocks.unlockCandidates.mockResolvedValue({ status: "no_match", attemptedCandidates: 1 });
    await expect(unlockVaultWithPasskey(USER_ID)).rejects.toThrow(
      "confirm compatibility for this same passkey"
    );
    expect(mocks.persistBinding).not.toHaveBeenCalled();
  });

  it("uses an iOS version message when no candidate matches on old iOS", async () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.7 Mobile/15E148 Safari/604.1",
    });
    mocks.unlockCandidates.mockResolvedValue({ status: "no_match", attemptedCandidates: 1 });
    await expect(unlockVaultWithPasskey(USER_ID)).rejects.toThrow("iOS or iPadOS 18 or later");
    vi.unstubAllGlobals();
  });
});
