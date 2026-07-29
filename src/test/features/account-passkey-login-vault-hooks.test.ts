import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { accountPasskeyLoginVaultHooks } from "@/features/passkey/account-passkey-login-vault-hooks";
import { ApiError } from "@/lib/api-client/api-error";

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

  it("hydrates the public PRF salt supplied for the first email-scoped login ceremony", async () => {
    const options: PublicKeyCredentialRequestOptionsJSON = {
      challenge: "challenge",
      rpId: "example.com",
      allowCredentials: [{ id: "credential-1", type: "public-key" }],
      userVerification: "required",
      extensions: {
        prf: { eval: { first: "AQIDBA" } },
      } as PublicKeyCredentialRequestOptionsJSON["extensions"],
    };

    const prepared = await accountPasskeyLoginVaultHooks.prepareOptions?.(options);
    const first = (
      prepared?.extensions as {
        prf?: { eval?: { first?: unknown } };
      }
    )?.prf?.eval?.first;

    expect(first).toBeInstanceOf(ArrayBuffer);
  });

  it("requires explicit vault action without failing account login when PRF is unavailable", async () => {
    mocks.resolveCapability.mockReturnValue({ state: "unsupported" });
    mocks.extractPrf.mockReturnValue(null);
    mocks.unlockCandidates.mockResolvedValue({ status: "prf_unavailable" });

    await expect(accountPasskeyLoginVaultHooks.onFullyAuthenticated?.({
      verifiedCredentialId: "credential-1",
      clientExtensionResults: {},
    })).resolves.toEqual({
      status: "action_required",
      code: "vault_prf_unavailable",
      redirectTo: "/vault/unlock",
      message: "Your account is signed in. Unlock your vault to continue.",
    });

    expect(mocks.persistBinding).not.toHaveBeenCalled();
  });

  it("unwraps exact candidates after final authentication and binds only a local match", async () => {
    const prfOutput = new Uint8Array(32).fill(7);
    mocks.extractPrf.mockReturnValue(prfOutput);
    mocks.unlockCandidates.mockResolvedValue({
      status: "matched",
      envelopeVariantId: "variant-1",
      vaultKey: {} as CryptoKey,
    });

    await expect(accountPasskeyLoginVaultHooks.onFullyAuthenticated?.({
      verifiedCredentialId: "credential-1",
      clientExtensionResults: { prf: { results: {} } },
    })).resolves.toEqual({ status: "completed" });

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

  it("requests explicit vault action without mutating routing when no candidate matches", async () => {
    const prfOutput = new Uint8Array(32).fill(9);
    mocks.extractPrf.mockReturnValue(prfOutput);
    mocks.unlockCandidates.mockResolvedValue({ status: "no_match", attemptedCandidates: 1 });

    await expect(accountPasskeyLoginVaultHooks.onFullyAuthenticated?.({
      verifiedCredentialId: "credential-1",
      clientExtensionResults: {},
    })).resolves.toMatchObject({
      status: "action_required",
      code: "vault_envelope_no_match",
      redirectTo: "/vault/unlock",
    });

    expect(mocks.persistBinding).not.toHaveBeenCalled();
    expect([...prfOutput]).toEqual(Array(32).fill(0));
  });

  it("keeps account login successful when candidate unwrap reports PRF unavailable", async () => {
    const prfOutput = new Uint8Array(32).fill(5);
    mocks.extractPrf.mockReturnValue(prfOutput);
    mocks.unlockCandidates.mockResolvedValue({ status: "prf_unavailable" });

    await expect(
      accountPasskeyLoginVaultHooks.onFullyAuthenticated?.({
        verifiedCredentialId: "credential-1",
        clientExtensionResults: { prf: { results: {} } },
      })
    ).resolves.toMatchObject({
      status: "action_required",
      code: "vault_prf_unavailable",
      redirectTo: "/vault/unlock",
    });

    expect(mocks.persistBinding).not.toHaveBeenCalled();
    expect([...prfOutput]).toEqual(Array(32).fill(0));
  });

  it("completes normally when the verified passkey is account-only", async () => {
    mocks.extractPrf.mockReturnValue(null);
    mocks.apiPost.mockRejectedValue(new ApiError(404, "No vault capability"));

    await expect(
      accountPasskeyLoginVaultHooks.onFullyAuthenticated?.({
        verifiedCredentialId: "credential-1",
        clientExtensionResults: {},
      })
    ).resolves.toEqual({ status: "completed" });

    expect(mocks.unlockCandidates).not.toHaveBeenCalled();
    expect(mocks.persistBinding).not.toHaveBeenCalled();
  });
});
