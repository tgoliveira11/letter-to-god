import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  filterAuthenticationOptionsForCredential,
  prepareVaultUnlockAuthenticationOptions,
  requestVaultUnlockAuthenticationOptions,
  runVaultUnlockAuthenticationCeremony,
  runVaultUnlockAuthenticationCeremonyWithOptions,
  verifyVaultUnlockAuthentication,
  VAULT_UNLOCK_AUTHENTICATE_PURPOSE,
} from "@/lib/passkey/vault-unlock-authenticate";
import { passkeyPrfExtensions } from "@/lib/passkey/prf";
import { PASSKEY_NOT_AVAILABLE_FOR_VAULT_UNLOCK_MESSAGE } from "@/lib/passkey/messages";

const mocks = vi.hoisted(() => ({
  apiPost: vi.fn(),
  startAuthentication: vi.fn(),
}));

vi.mock("@/lib/api-client/client", () => ({
  apiClient: {
    post: mocks.apiPost,
  },
}));

vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: mocks.startAuthentication,
}));

describe("vault unlock authenticate client", () => {
  async function passkeyPrfSaltBase64Url(userId: string): Promise<string> {
    const extensions = (await passkeyPrfExtensions(userId)) as {
      prf?: { eval?: { first?: string } };
    };
    return extensions.prf?.eval?.first ?? "";
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.apiPost.mockResolvedValue({
      challenge: "abc",
      allowCredentials: [
        { id: "vault-cred", type: "public-key", transports: ["internal"] },
      ],
    });
    mocks.startAuthentication.mockResolvedValue({
      id: "vault-cred",
      clientExtensionResults: { prf: { results: { first: new Uint8Array(32) } } },
    });
  });

  it("requests vault unlock purpose when fetching options", async () => {
    await requestVaultUnlockAuthenticationOptions();
    expect(mocks.apiPost).toHaveBeenCalledWith("/api/passkeys/authenticate", {
      action: "options",
      purpose: VAULT_UNLOCK_AUTHENTICATE_PURPOSE,
      intent: "explicit",
    });
  });

  it("preserves transports when filtering to a specific vault credential", () => {
    const filtered = filterAuthenticationOptionsForCredential(
      {
        challenge: "abc",
        allowCredentials: [
          { id: "vault-a", type: "public-key", transports: ["hybrid"] },
          { id: "vault-b", type: "public-key", transports: ["internal"] },
        ],
      },
      "vault-b"
    );
    expect(filtered.allowCredentials).toEqual([
      { id: "vault-b", type: "public-key", transports: ["internal"] },
    ]);
  });

  it("aligns PRF evalByCredential to eval when scoped to one vault credential", async () => {
    const userId = "550e8400-e29b-41d4-a716-446655440000";
    const salt = await passkeyPrfSaltBase64Url(userId);
    const filtered = filterAuthenticationOptionsForCredential(
      {
        challenge: "abc",
        allowCredentials: [
          { id: "vault-a", type: "public-key", transports: ["internal"] },
          { id: "vault-b", type: "public-key", transports: ["internal"] },
        ],
        extensions: {
          prf: {
            evalByCredential: {
              "vault-a": { first: salt },
              "vault-b": { first: salt },
            },
          },
        },
      },
      "vault-b"
    );
    expect(filtered.extensions?.prf?.eval?.first).toBeInstanceOf(ArrayBuffer);
    expect(filtered.extensions?.prf?.evalByCredential).toBeUndefined();
  });

  it("prepareVaultUnlockAuthenticationOptions converts aligned PRF salts to ArrayBuffer", async () => {
    const userId = "550e8400-e29b-41d4-a716-446655440000";
    const salt = await passkeyPrfSaltBase64Url(userId);
    const prepared = prepareVaultUnlockAuthenticationOptions(
      {
        challenge: "abc",
        allowCredentials: [{ id: "vault-cred", type: "public-key", transports: ["internal"] }],
        extensions: {
          prf: {
            evalByCredential: {
              "vault-cred": { first: salt },
              "other-cred": { first: salt },
            },
          },
        },
      },
      "vault-cred"
    );
    expect(prepared.extensions?.prf?.eval?.first).toBeInstanceOf(ArrayBuffer);
    expect(prepared.extensions?.prf?.evalByCredential).toBeUndefined();
  });

  it("fails closed when filtered credential is not in allowCredentials", () => {
    expect(() =>
      filterAuthenticationOptionsForCredential(
        {
          challenge: "abc",
          allowCredentials: [{ id: "vault-a", type: "public-key", transports: ["internal"] }],
        },
        "missing-cred"
      )
    ).toThrow(PASSKEY_NOT_AVAILABLE_FOR_VAULT_UNLOCK_MESSAGE);
  });

  it("settings test and real unlock share the same filtered credential entry", () => {
    const serverOptions = {
      challenge: "abc",
      allowCredentials: [{ id: "vault-cred", type: "public-key", transports: ["internal"] }],
    } as const;

    const realUnlock = filterAuthenticationOptionsForCredential(serverOptions);
    const settingsTest = filterAuthenticationOptionsForCredential(serverOptions, "vault-cred");

    expect(realUnlock.allowCredentials).toEqual(serverOptions.allowCredentials);
    expect(settingsTest.allowCredentials).toEqual(serverOptions.allowCredentials);
  });

  it("runs ceremony with prefetched options without fetching again", async () => {
    const prefetched = {
      challenge: "prefetched",
      allowCredentials: [{ id: "vault-cred", type: "public-key", transports: ["internal"] }],
    };
    await import("@/lib/passkey/vault-unlock-authenticate").then((m) =>
      m.runVaultUnlockAuthenticationCeremonyWithOptions(prefetched, "vault-cred")
    );
    expect(mocks.apiPost).not.toHaveBeenCalled();
    expect(mocks.startAuthentication).toHaveBeenCalled();
  });

  it("runs ceremony with vault unlock options only", async () => {
    await runVaultUnlockAuthenticationCeremony("vault-cred");
    expect(mocks.apiPost).toHaveBeenCalledWith("/api/passkeys/authenticate", {
      action: "options",
      purpose: VAULT_UNLOCK_AUTHENTICATE_PURPOSE,
      credentialId: "vault-cred",
      intent: "explicit",
    });
    expect(mocks.startAuthentication).toHaveBeenCalled();
  });

  it("verifies with vault unlock purpose", async () => {
    const assertion = { id: "vault-cred" };
    await verifyVaultUnlockAuthentication(assertion as never);
    expect(mocks.apiPost).toHaveBeenCalledWith("/api/passkeys/authenticate", {
      action: "verify",
      purpose: VAULT_UNLOCK_AUTHENTICATE_PURPOSE,
      response: { ...assertion, clientExtensionResults: {} },
    });
  });
});
