import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AccountPasskeySecuritySettings } from "@/features/passkey/account-passkey-security-settings";
import { USER_ID } from "@/test/helpers/fixtures";

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  startAuthentication: vi.fn(),
  getSessionVaultKey: vi.fn(),
  wrapVaultKeyForPasskey: vi.fn(),
  unlockCandidates: vi.fn(),
  extractPasskeyPrfOutput: vi.fn(),
  resolveCapability: vi.fn(),
  persistBinding: vi.fn(),
}));

vi.mock("@tgoliveira/secure-auth/react", async () => {
  const React = await import("react");
  return {
    SecuritySettingsPage: (props: {
      passkeyRegistrationHooks?: {
        onVerified?: (input: {
          registrationCredentialId: string;
          verifiedCredentialId: string;
          clientExtensionResults: Record<string, unknown>;
        }) => Promise<void>;
      };
    }) =>
      React.createElement(
        "button",
        {
          onClick: () =>
            void props.passkeyRegistrationHooks?.onVerified?.({
              registrationCredentialId: "account-credential",
              verifiedCredentialId: "account-credential",
              clientExtensionResults: {
                prf: { enabled: true, results: { first: new Uint8Array(32).fill(1).buffer } },
              },
            }),
        },
        "Complete account passkey registration"
      ),
  };
});

vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: mocks.startAuthentication,
}));

vi.mock("@/features/vault/use-vault-session-unlocked", () => ({
  useVaultSessionUnlocked: () => true,
}));

vi.mock("@/lib/crypto-client/vault", () => ({
  getSessionVaultKey: mocks.getSessionVaultKey,
}));

vi.mock("@/lib/api-client/client", () => ({
  apiClient: { post: mocks.apiPost },
}));

vi.mock("@/lib/crypto-client/passkey-vault", () => ({
  extractPasskeyPrfOutput: mocks.extractPasskeyPrfOutput,
  wrapVaultKeyForPasskey: mocks.wrapVaultKeyForPasskey,
  unlockVaultFromPasskeyEnvelopeCandidates: mocks.unlockCandidates,
}));

vi.mock("@/lib/crypto-client/vault-passkey-browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/crypto-client/vault-passkey-browser")>()),
  resolvePasskeyPrfCapability: mocks.resolveCapability,
}));

vi.mock("@/lib/passkey/prepare-webauthn-options", () => ({
  prepareVaultRegistrationOptions: (options: unknown) => options,
  prepareVaultAuthenticationOptions: (options: unknown) => options,
}));

vi.mock("@/lib/passkey/vault-unlock-authenticate", () => ({
  persistVaultPasskeyBinding: mocks.persistBinding,
}));

vi.mock("@/lib/crypto-client/vault-session", () => ({
  beginVaultOwnerOperation: () => ({ ownerId: "550e8400-e29b-41d4-a716-446655440000", operationId: 1 }),
}));

vi.mock("@tgoliveira/vault-core/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tgoliveira/vault-core/browser")>()),
  assertVaultSessionOperationCurrent: vi.fn(),
}));

describe("AccountPasskeySecuritySettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionVaultKey.mockReturnValue({} as CryptoKey);
    const authenticationPrf = new Uint8Array(32).fill(2);
    mocks.startAuthentication.mockResolvedValue({
      id: "account-credential",
      clientExtensionResults: {
        prf: { results: { first: authenticationPrf.buffer } },
      },
    });
    mocks.extractPasskeyPrfOutput.mockReturnValue(authenticationPrf);
    mocks.resolveCapability.mockReturnValue({ state: "confirmed_authentication" });
    mocks.wrapVaultKeyForPasskey.mockImplementation(
      async (_key: CryptoKey, prfOutput: Uint8Array) => {
        expect(prfOutput[0]).toBe(2);
        return { version: "enc-v1" };
      }
    );
    mocks.unlockCandidates.mockResolvedValue({
      status: "matched",
      envelopeVariantId: "variant-1",
      candidateIndex: 0,
      vaultKey: {} as CryptoKey,
    });
    mocks.persistBinding.mockResolvedValue({ bindingId: "binding-1" });
    mocks.apiPost.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      if (body.action === "options") {
        return {
          challenge: "auth-challenge",
          allowCredentials: [{ id: "account-credential", type: "public-key" }],
        };
      }
      if (body.action === "verify") {
        return {
          verified: true,
          verifiedCredentialId: "account-credential",
          enrollmentProof: "authentication-proof",
        };
      }
      if (body.action === "persist") {
        return {
          verifiedCredentialId: "account-credential",
          envelopeVariantId: "variant-1",
          bindingProof: "binding-proof",
        };
      }
      throw new Error(`Unexpected POST ${path}`);
    });
  });

  it("confirms an account-created passkey with exact authentication before vault persistence", async () => {
    render(<AccountPasskeySecuritySettings userId={USER_ID} />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /complete account passkey registration/i }));

    await waitFor(() => {
      expect(mocks.startAuthentication).toHaveBeenCalledTimes(1);
      expect(mocks.apiPost).toHaveBeenCalledWith(
        "/api/passkeys/account-registration-vault",
        expect.objectContaining({
          action: "verify",
          verifiedCredentialId: "account-credential",
          response: expect.not.objectContaining({
            clientExtensionResults: expect.objectContaining({ prf: expect.anything() }),
          }),
        })
      );
      expect(mocks.apiPost).toHaveBeenCalledWith(
        "/api/passkeys/account-registration-vault",
        expect.objectContaining({
          action: "persist",
          enrollmentProof: "authentication-proof",
          verifiedCredentialId: "account-credential",
        })
      );
      expect(mocks.persistBinding).toHaveBeenCalledWith(
        expect.objectContaining({
          verifiedCredentialId: "account-credential",
          selectedEnvelopeVariantId: "variant-1",
        })
      );
    });
  });
});
