import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { PasskeyVaultUnlockSetup } from "@/features/passkey/passkey-vault-unlock-setup";
import {
  PASSKEY_VAULT_UNLOCK_DISABLED_MESSAGE,
  PASSKEY_VAULT_UNLOCK_ENABLED_MESSAGE,
  PASSKEY_VAULT_UNLOCK_ENABLED_REFRESH_WARNING,
  PASSKEY_VAULT_UNLOCK_TEST_SUCCEEDED_MESSAGE,
} from "@/lib/passkey/messages";
import { USER_ID } from "@/test/helpers/fixtures";

const mocks = vi.hoisted(() => ({
  vaultStatus: vi.fn(),
  getSessionVaultKey: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  startAuthentication: vi.fn(),
  startRegistration: vi.fn(),
  extractPasskeyPrfOutput: vi.fn(),
  wrapVaultKeyForPasskey: vi.fn(),
  unlockCandidates: vi.fn(),
  resolveCapability: vi.fn(),
  probeEnvironment: vi.fn(),
}));

vi.mock("@/lib/api-client/vault", () => ({
  vaultApi: {
    status: mocks.vaultStatus,
  },
}));

vi.mock("@/lib/crypto-client/vault", () => ({
  getSessionVaultKey: mocks.getSessionVaultKey,
}));

vi.mock("@/lib/api-client/client", () => ({
  apiClient: {
    get: mocks.apiGet,
    post: mocks.apiPost,
    delete: mocks.apiDelete,
  },
}));

vi.mock("@simplewebauthn/browser", () => ({
  startAuthentication: mocks.startAuthentication,
  startRegistration: mocks.startRegistration,
}));

vi.mock("@/lib/crypto-client/passkey-vault", () => ({
  extractPasskeyPrfOutput: mocks.extractPasskeyPrfOutput,
  wrapVaultKeyForPasskey: mocks.wrapVaultKeyForPasskey,
  unlockVaultFromPasskeyEnvelopeCandidates: mocks.unlockCandidates,
}));

vi.mock("@tgoliveira/vault-core/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tgoliveira/vault-core/browser")>()),
  resolvePasskeyPrfCapability: mocks.resolveCapability,
}));

vi.mock("@/lib/passkey/prepare-webauthn-options", () => ({
  prepareAuthenticationOptions: (options: unknown) => options,
  prepareRegistrationOptions: (options: unknown) => options,
  alignPrfExtensionsForAllowCredentials: (options: unknown) => options,
}));

vi.mock("@/lib/passkey/passkey-prf-diagnostics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/passkey/passkey-prf-diagnostics")>();
  return {
    ...actual,
    probePasskeyPrfEnvironmentAsync: mocks.probeEnvironment,
  };
});

function mockEnvironment(overrides: Record<string, unknown> = {}) {
  return {
    userAgent: "vitest",
    secureContext: true,
    webauthnAvailable: true,
    credentialsApiAvailable: true,
    clientCapabilitiesAvailable: true,
    clientCapabilitiesPrf: null,
    capabilityProbe: "unknown" as const,
    ...overrides,
  };
}

function mockVaultUnlockList(
  passkeys: Array<{
    id: string;
    friendlyName: string;
    signInEnabled: boolean;
    vaultUnlockEnabled: boolean;
    prfSupported: boolean | null;
    credentialId: string;
  }> = [],
  options?: { passkeyUnlockAvailableOnThisDevice?: boolean }
) {
  const hasVaultPasskey = passkeys.some((p) => p.vaultUnlockEnabled);
  mocks.apiGet.mockImplementation(async (path: string) => {
    if (path === "/api/passkeys/vault-unlock") {
      return {
        passkeys,
        serverEnvelopeConfigured: hasVaultPasskey,
        passkeyUnlockAvailableOnThisDevice:
          options?.passkeyUnlockAvailableOnThisDevice ?? hasVaultPasskey,
        deviceBindings: hasVaultPasskey
          ? [
              {
                id: "binding-1",
                credentialId: passkeys[0]?.credentialId ?? "cred-1",
                deviceLabel: "This Mac",
                isCurrentDevice: options?.passkeyUnlockAvailableOnThisDevice ?? hasVaultPasskey,
              },
            ]
          : [],
        currentDeviceCredentialId:
          options?.passkeyUnlockAvailableOnThisDevice ?? hasVaultPasskey
            ? passkeys[0]?.credentialId
            : undefined,
      };
    }
    throw new Error(`Unexpected GET ${path}`);
  });
}

describe("PasskeyVaultUnlockSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSessionVaultKey.mockReturnValue({} as CryptoKey);
    mocks.vaultStatus.mockResolvedValue({
      hasPasskey: false,
      vaultConfigured: true,
      setupComplete: true,
      availableUnlockMethods: { password: true, recoveryPhrase: true, passkey: false },
      passkeyUnlockAvailableOnThisDevice: false,
    });
    mockVaultUnlockList([]);
    mocks.probeEnvironment.mockResolvedValue(mockEnvironment());
    mocks.apiPost.mockImplementation(async (path: string, body?: Record<string, unknown>) => {
      // Vault-only setup step 1: register credential without envelope.
      if (path === "/api/passkeys/register" && body?.action === "verify") {
        return {
          verified: true,
          credentialDbId: "pk-new",
          verifiedCredentialId: "cred-new",
        };
      }
      // Vault-only setup step 2 + unlock/test: single-credential auth (get) options.
      if (
        (path === "/api/passkeys/authenticate" || path.endsWith("/enable-vault-unlock")) &&
        body?.action === "options"
      ) {
        const credentialId = path.includes("pk-new") ? "cred-new" : "cred-1";
        return {
          challenge: "abc",
          extensions: { prf: { eval: {} } },
          allowCredentials: [
            { id: credentialId, type: "public-key", transports: ["internal"] },
          ],
        };
      }
      if (path.endsWith("/enable-vault-unlock") && body?.action === "verify") {
        const credentialId = path.includes("pk-new") ? "cred-new" : "cred-1";
        return {
          verified: true,
          verifiedCredentialId: credentialId,
          enrollmentProof: "enrollment-proof",
        };
      }
      if (path.endsWith("/enable-vault-unlock") && body?.action === "persist") {
        const credentialId = path.includes("pk-new") ? "cred-new" : "cred-1";
        return {
          verifiedCredentialId: credentialId,
          envelopeVariantId: "550e8400-e29b-41d4-a716-446655440001",
          bindingProof: "binding-proof",
        };
      }
      if (path === "/api/passkeys/authenticate" && body?.action === "verify") {
        const credentialId = (body.response as { id?: string } | undefined)?.id ?? "cred-1";
        return {
          verified: true,
          verifiedCredentialId: credentialId,
          bindingProof: "binding-proof",
          candidates: [
            {
              envelopeVariantId: "550e8400-e29b-41d4-a716-446655440001",
              credentialId,
              envelope: { method: "passkey_prf", encryptedVaultKey: {}, kdfMetadata: null },
            },
          ],
        };
      }
      if (path === "/api/passkeys/authenticate" && body?.action === "bind") {
        return { bindingId: "binding-1" };
      }
      return { challenge: "abc", extensions: { prf: { eval: {} } } };
    });
    mocks.startAuthentication.mockImplementation(
      async ({ optionsJSON }: { optionsJSON?: { allowCredentials?: Array<{ id: string }> } }) => ({
        id: optionsJSON?.allowCredentials?.[0]?.id ?? "cred-1",
        clientExtensionResults: {},
      })
    );
    mocks.startRegistration.mockResolvedValue({
      id: "cred-new",
      clientExtensionResults: {},
    });
    mocks.extractPasskeyPrfOutput.mockReturnValue(new Uint8Array(32));
    mocks.wrapVaultKeyForPasskey.mockResolvedValue({ version: "enc-v1" });
    mocks.resolveCapability.mockReturnValue({ state: "confirmed_authentication" });
    mocks.unlockCandidates.mockResolvedValue({
      status: "matched",
      envelopeVariantId: "550e8400-e29b-41d4-a716-446655440001",
      candidateIndex: 0,
      vaultKey: {} as CryptoKey,
    });
  });

  it("1. does not render Set up account passkey first", async () => {
    render(<PasskeyVaultUnlockSetup userId={USER_ID} vaultUnlocked />);
    await screen.findByText(/independent/i);
    expect(screen.queryByText(/set up account passkey first/i)).toBeNull();
  });

  it("2. does not render link-a-compatible-passkey copy", async () => {
    render(<PasskeyVaultUnlockSetup userId={USER_ID} vaultUnlocked />);
    await screen.findByText(/independent/i);
    expect(screen.queryByText(/link a compatible passkey/i)).toBeNull();
  });

  it("3. shows PRF unsupported when browser lacks PRF, not account passkey messaging", async () => {
    mocks.probeEnvironment.mockResolvedValue(
      mockEnvironment({ capabilityProbe: "unsupported", webauthnAvailable: true })
    );
    render(<PasskeyVaultUnlockSetup userId={USER_ID} vaultUnlocked />);
    expect(await screen.findByText(/not supported by this browser or passkey provider/i)).toBeTruthy();
    expect(screen.queryByText(/set up account passkey first/i)).toBeNull();
  });

  it("4. explains account passkeys and vault passkeys are independent", async () => {
    render(<PasskeyVaultUnlockSetup userId={USER_ID} vaultUnlocked />);
    expect(await screen.findByText(/account passkeys and vault passkeys are independent/i)).toBeTruthy();
  });

  it("5. shows setup when vault is unlocked and PRF is available without account passkey", async () => {
    mocks.probeEnvironment.mockResolvedValue(
      mockEnvironment({ capabilityProbe: "supported", clientCapabilitiesPrf: true })
    );
    render(<PasskeyVaultUnlockSetup userId={USER_ID} vaultUnlocked />);
    expect(await screen.findByRole("button", { name: /set up passkey vault unlock/i })).toBeTruthy();
  });

  it("shows unknown capability notice without blocking setup", async () => {
    render(<PasskeyVaultUnlockSetup userId={USER_ID} vaultUnlocked />);
    expect(await screen.findByText(/could not be confirmed yet/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /set up passkey vault unlock/i })).toBeTruthy();
  });

  it("shows configured state when vault unlock passkey exists", async () => {
    mockVaultUnlockList([
      {
        id: "pk-1",
        friendlyName: "Vault passkey",
        signInEnabled: false,
        vaultUnlockEnabled: true,
        prfSupported: true,
        credentialId: "cred-1",
      },
    ]);

    render(<PasskeyVaultUnlockSetup userId={USER_ID} vaultUnlocked />);
    expect(await screen.findByText(/passkey vault unlock is configured/i)).toBeTruthy();
    expect(screen.getByText(/vault unlock: configured/i)).toBeTruthy();
  });

  it("registers vault-only passkey when PRF output is returned", async () => {
    mocks.probeEnvironment.mockResolvedValue(
      mockEnvironment({ capabilityProbe: "supported", clientCapabilitiesPrf: true })
    );
    render(<PasskeyVaultUnlockSetup userId={USER_ID} vaultUnlocked />);
    fireEvent.click(await screen.findByRole("button", { name: /set up passkey vault unlock/i }));

    await waitFor(() => {
      // Step 1: register vault-only credential WITHOUT an envelope.
      expect(mocks.apiPost).toHaveBeenCalledWith("/api/passkeys/register", {
        action: "options",
        vaultOnly: true,
      });
      expect(mocks.startRegistration).toHaveBeenCalled();
      expect(mocks.apiPost).toHaveBeenCalledWith(
        "/api/passkeys/register",
        expect.objectContaining({ action: "verify", vaultOnly: true })
      );
      // Step 2: create the envelope from an authentication (get) PRF via enable.
      expect(mocks.apiPost).toHaveBeenCalledWith(
        "/api/account/passkeys/pk-new/enable-vault-unlock",
        { action: "options" }
      );
      expect(mocks.apiPost).toHaveBeenCalledWith(
        "/api/account/passkeys/pk-new/enable-vault-unlock",
        expect.objectContaining({
          action: "verify",
          response: expect.any(Object),
        })
      );
      expect(mocks.apiPost).toHaveBeenCalledWith(
        "/api/account/passkeys/pk-new/enable-vault-unlock",
        expect.objectContaining({
          action: "persist",
          enrollmentProof: "enrollment-proof",
          encryptedVaultKey: expect.anything(),
        })
      );
    });
    expect(await screen.findByText(PASSKEY_VAULT_UNLOCK_ENABLED_MESSAGE)).toBeTruthy();
  });

  it("keeps registration successful when the post-registration status refresh fails", async () => {
    mocks.probeEnvironment.mockResolvedValue(
      mockEnvironment({ capabilityProbe: "supported", clientCapabilitiesPrf: true })
    );
    let vaultListRequests = 0;
    mocks.apiGet.mockImplementation(async (path: string) => {
      if (path !== "/api/passkeys/vault-unlock") {
        throw new Error(`Unexpected GET ${path}`);
      }
      vaultListRequests += 1;
      if (vaultListRequests === 1) {
        return { passkeys: [], serverEnvelopeConfigured: false };
      }
      throw new Error("Internal server error");
    });

    render(<PasskeyVaultUnlockSetup userId={USER_ID} vaultUnlocked />);
    fireEvent.click(await screen.findByRole("button", { name: /set up passkey vault unlock/i }));

    expect(
      await screen.findByText(PASSKEY_VAULT_UNLOCK_ENABLED_REFRESH_WARNING)
    ).toBeTruthy();
    expect(screen.queryByText(/^Internal server error$/i)).toBeNull();
    expect(mocks.apiPost).toHaveBeenCalledWith(
      "/api/passkeys/register",
      expect.objectContaining({ action: "verify", vaultOnly: true })
    );
  });

  it("requires unlocked vault before setup", async () => {
    render(<PasskeyVaultUnlockSetup userId={USER_ID} vaultUnlocked={false} />);
    expect(await screen.findByText(/unlock your vault to set up passkey vault unlock/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /set up passkey vault unlock/i })).toBeNull();
  });

  it("shows prf_not_returned when ceremony omits PRF output", async () => {
    mocks.extractPasskeyPrfOutput.mockReturnValue(null);
    render(<PasskeyVaultUnlockSetup userId={USER_ID} vaultUnlocked />);
    fireEvent.click(await screen.findByRole("button", { name: /set up passkey vault unlock/i }));
    expect(
      await screen.findByText(
        /Authentication completed, but your passkey or browser did not return PRF output/i
      )
    ).toBeTruthy();
    expect(mocks.wrapVaultKeyForPasskey).not.toHaveBeenCalled();
  });

  it("disables vault unlock for configured passkey with PRF proof", async () => {
    mockVaultUnlockList([
      {
        id: "pk-1",
        friendlyName: "Vault passkey",
        signInEnabled: false,
        vaultUnlockEnabled: true,
        prfSupported: true,
        credentialId: "cred-1",
      },
    ]);

    render(<PasskeyVaultUnlockSetup userId={USER_ID} vaultUnlocked />);
    fireEvent.click(await screen.findByRole("button", { name: /^disable$/i }));

    await waitFor(() => {
      expect(mocks.apiDelete).toHaveBeenCalledWith("/api/account/passkeys/pk-1/vault-unlock", {
        bindingProof: "binding-proof",
        verifiedCredentialId: "cred-1",
        selectedEnvelopeVariantId: "550e8400-e29b-41d4-a716-446655440001",
      });
    });
    expect(await screen.findByText(PASSKEY_VAULT_UNLOCK_DISABLED_MESSAGE)).toBeTruthy();
  });

  it("removes all vault passkeys while explicitly preserving account sign-in passkeys", async () => {
    mockVaultUnlockList([
      {
        id: "pk-vault-only",
        friendlyName: "Vault passkey",
        signInEnabled: false,
        vaultUnlockEnabled: true,
        prfSupported: true,
        credentialId: "cred-vault-only",
      },
      {
        id: "pk-dual",
        friendlyName: "Account and vault passkey",
        signInEnabled: true,
        vaultUnlockEnabled: true,
        prfSupported: true,
        credentialId: "cred-dual",
      },
    ]);
    mocks.apiDelete.mockResolvedValue({
      success: true,
      removedVaultPasskeyCount: 2,
      preservedSignInPasskeyCount: 1,
    });

    render(<PasskeyVaultUnlockSetup userId={USER_ID} vaultUnlocked />);
    fireEvent.click(
      await screen.findByRole("button", { name: /remove all vault passkeys/i })
    );

    const dialog = screen.getByRole("alertdialog");
    expect(
      within(dialog).getByText(/account sign-in passkeys will not be changed/i)
    ).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: /remove all vault passkeys/i })
    );

    await waitFor(() => {
      expect(mocks.apiDelete).toHaveBeenCalledWith("/api/passkeys/vault-unlock");
    });
    expect(mocks.startAuthentication).not.toHaveBeenCalled();
    expect(
      await screen.findByText(/removed from every passkey and browser/i)
    ).toBeTruthy();
  });

  it("shows read-only configured state without destructive actions in unsupported browser", async () => {
    mocks.probeEnvironment.mockResolvedValue(
      mockEnvironment({
        webauthnAvailable: false,
        credentialsApiAvailable: false,
        capabilityProbe: "unsupported",
      })
    );
    mockVaultUnlockList([
      {
        id: "pk-1",
        friendlyName: "Vault passkey",
        signInEnabled: false,
        vaultUnlockEnabled: true,
        prfSupported: true,
        credentialId: "cred-1",
      },
    ]);

    render(<PasskeyVaultUnlockSetup userId={USER_ID} vaultUnlocked />);
    expect(
      await screen.findByText(/configured, but unavailable in this browser/i)
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^disable$/i })).toBeNull();
    expect(mocks.apiDelete).not.toHaveBeenCalled();
  });

  it("tests configured passkey via authenticate options", async () => {
    mockVaultUnlockList([
      {
        id: "pk-1",
        friendlyName: "Vault passkey",
        signInEnabled: false,
        vaultUnlockEnabled: true,
        prfSupported: true,
        credentialId: "cred-1",
      },
    ]);

    render(<PasskeyVaultUnlockSetup userId={USER_ID} vaultUnlocked />);
    fireEvent.click(await screen.findByRole("button", { name: /^test$/i }));

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledWith("/api/passkeys/authenticate", {
        action: "options",
        purpose: "vault_unlock",
        credentialId: "cred-1",
      });
    });
    expect(await screen.findByText(PASSKEY_VAULT_UNLOCK_TEST_SUCCEEDED_MESSAGE)).toBeTruthy();
  });

  it("appends a compatibility variant to the same synced credential", async () => {
    mockVaultUnlockList([
      {
        id: "pk-1",
        friendlyName: "Synced passkey",
        signInEnabled: true,
        vaultUnlockEnabled: true,
        prfSupported: true,
        credentialId: "cred-1",
      },
    ]);

    render(<PasskeyVaultUnlockSetup userId={USER_ID} vaultUnlocked />);
    fireEvent.click(await screen.findByRole("button", { name: /add compatibility variant/i }));

    await waitFor(() => {
      expect(mocks.apiPost).toHaveBeenCalledWith(
        "/api/account/passkeys/pk-1/enable-vault-unlock",
        expect.objectContaining({ action: "persist", enrollmentProof: "enrollment-proof" })
      );
      expect(mocks.apiPost).toHaveBeenCalledWith(
        "/api/passkeys/authenticate",
        expect.objectContaining({
          action: "bind",
          verifiedCredentialId: "cred-1",
          selectedEnvelopeVariantId: "550e8400-e29b-41d4-a716-446655440001",
        })
      );
    });
    expect(
      await screen.findByText(/compatibility envelope variant was added and verified/i)
    ).toBeTruthy();
    expect(
      mocks.apiPost.mock.calls.some(
        ([path, body]) => path === "/api/passkeys/register" && body?.action === "options"
      )
    ).toBe(false);
  });
});

describe("passkey vault setup documentation guard", () => {
  it("27-30. docs do not require account passkey before vault passkey setup", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = join(import.meta.dirname, "../../..");
    const audit = readFileSync(join(root, "docs/archive/PASSKEY_VAULT_SETUP_AVAILABILITY_AUDIT.md"), "utf8");
    expect(audit.toLowerCase()).not.toContain("set up account passkey first");
    expect(audit.toLowerCase()).not.toMatch(/account passkey is required before vault passkey/);
    expect(audit).toMatch(/independent/i);
    expect(audit).toMatch(/never unlocks the vault by itself/i);
  });
});
