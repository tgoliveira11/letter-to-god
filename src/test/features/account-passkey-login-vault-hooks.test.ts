import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { accountPasskeyLoginVaultHooks } from "@/features/passkey/account-passkey-login-vault-hooks";

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  extractPrf: vi.fn(),
  unlockCandidates: vi.fn(),
  resolveCapability: vi.fn(),
  persistBinding: vi.fn(),
  beginOperation: vi.fn(),
  assertOperation: vi.fn(),
}));

vi.mock("@/lib/api-client/client", () => ({
  apiClient: { post: mocks.apiPost },
}));

vi.mock("@/lib/crypto-client/passkey-vault", () => ({
  extractPasskeyPrfOutput: mocks.extractPrf,
  unlockVaultFromPasskeyEnvelopeCandidates: mocks.unlockCandidates,
}));

vi.mock("@/lib/crypto-client/vault-passkey-browser", () => ({
  resolvePasskeyPrfCapability: mocks.resolveCapability,
}));

vi.mock("@/lib/passkey/vault-unlock-authenticate", () => ({
  persistVaultPasskeyBinding: mocks.persistBinding,
}));

vi.mock("@/lib/crypto-client/vault-session", () => ({
  beginVaultOwnerOperation: mocks.beginOperation,
}));

vi.mock("@tgoliveira/vault-core/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tgoliveira/vault-core/browser")>()),
  assertVaultSessionOperationCurrent: mocks.assertOperation,
}));

describe("account passkey login vault hook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.beginOperation.mockReturnValue({ ownerId: "user-1", epoch: 1 });
    mocks.resolveCapability.mockReturnValue({ state: "confirmed_authentication" });
    mocks.apiPost.mockResolvedValue({
      userId: "user-1",
      verifiedCredentialId: "credential-1",
      bindingProof: "binding-proof",
      candidates: [{ envelopeVariantId: "variant-1" }],
    });
  });

  it("prepares the server options before starting the account ceremony", async () => {
    const options: PublicKeyCredentialRequestOptionsJSON = {
      challenge: "challenge",
      rpId: "example.com",
      allowCredentials: [],
      userVerification: "required",
    };

    expect(accountPasskeyLoginVaultHooks.prepareOptions?.(options)).toBe(options);
  });

  it("does nothing when the browser does not confirm PRF output", async () => {
    mocks.resolveCapability.mockReturnValue({ state: "unsupported" });
    mocks.extractPrf.mockReturnValue(null);

    await accountPasskeyLoginVaultHooks.onFullyAuthenticated?.({
      verifiedCredentialId: "credential-1",
      clientExtensionResults: {},
    });

    expect(mocks.apiPost).not.toHaveBeenCalled();
  });

  it("unwraps exact candidates after final authentication and binds only a local match", async () => {
    const prfOutput = new Uint8Array(32).fill(7);
    mocks.extractPrf.mockReturnValue(prfOutput);
    mocks.unlockCandidates.mockResolvedValue({
      status: "matched",
      envelopeVariantId: "variant-1",
      vaultKey: {} as CryptoKey,
    });

    await accountPasskeyLoginVaultHooks.onFullyAuthenticated?.({
      verifiedCredentialId: "credential-1",
      clientExtensionResults: { prf: { results: {} } },
    });

    expect(mocks.apiPost).toHaveBeenCalledWith(
      "/api/passkeys/account-login-vault-candidates",
      { verifiedCredentialId: "credential-1" }
    );
    expect(mocks.unlockCandidates).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        verifiedCredentialId: "credential-1",
        prfOutput,
      })
    );
    expect(mocks.persistBinding).toHaveBeenCalledWith({
      bindingProof: "binding-proof",
      verifiedCredentialId: "credential-1",
      selectedEnvelopeVariantId: "variant-1",
      deviceLabel: expect.any(String),
    });
    expect([...prfOutput]).toEqual(Array(32).fill(0));
  });

  it("does not mutate routing when no candidate matches", async () => {
    const prfOutput = new Uint8Array(32).fill(9);
    mocks.extractPrf.mockReturnValue(prfOutput);
    mocks.unlockCandidates.mockResolvedValue({ status: "no_match", attemptedCandidates: 1 });

    await accountPasskeyLoginVaultHooks.onFullyAuthenticated?.({
      verifiedCredentialId: "credential-1",
      clientExtensionResults: {},
    });

    expect(mocks.persistBinding).not.toHaveBeenCalled();
    expect([...prfOutput]).toEqual(Array(32).fill(0));
  });
});
