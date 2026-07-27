import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import { RecoveryPhraseReplace } from "@/features/recovery/recovery-phrase-replace";
import { vaultApi } from "@/lib/api-client/vault";
import { getSessionVaultKey } from "@/lib/crypto-client/vault";
import { wrapVaultKeyForRecoveryPhrase } from "@/lib/crypto-client/vault-envelope";

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: { user: { id: "user-1" } },
    status: "authenticated",
  })),
}));

vi.mock("@/lib/crypto-client/vault", () => ({
  getSessionVaultKey: vi.fn(),
}));

vi.mock("@/lib/crypto-client/vault-envelope", () => ({
  wrapVaultKeyForRecoveryPhrase: vi.fn(),
}));

vi.mock("@/lib/crypto-client/vault-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crypto-client/vault-session")>();
  return {
    ...actual,
    getCurrentVaultSessionLease: vi.fn(() => ({
      ownerId: "user-1",
      epoch: 1,
      role: "primary",
      vaultKey: {} as CryptoKey,
    })),
  };
});

vi.mock("@tgoliveira/vault-core/browser", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tgoliveira/vault-core/browser")>();
  return {
    ...actual,
    assertVaultSessionLeaseCurrent: vi.fn(),
    isVaultSessionLeaseCurrent: vi.fn(() => true),
  };
});

vi.mock("@/lib/crypto-client/recovery-phrase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crypto-client/recovery-phrase")>();
  return {
    ...actual,
    generateRecoveryPhrase: vi.fn(
      () =>
        "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
    ),
  };
});

vi.mock("@/lib/api-client/vault", () => ({
  vaultApi: {
    replaceRecoveryPhrase: vi.fn(),
  },
}));

const recoveryPhraseStatus = {
  createdAt: "2026-01-01T00:00:00.000Z",
  phraseLength: 12 as const,
};

describe("RecoveryPhraseReplace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSessionVaultKey).mockReturnValue({} as CryptoKey);
    vi.mocked(wrapVaultKeyForRecoveryPhrase).mockResolvedValue({
      encryptedVaultKey: {
        ciphertext: "ct",
        iv: "iv",
        aad: { userId: "user-1", resourceId: "user-1", field: "vault_key" },
        encryptionVersion: "aes-gcm-v1",
      },
      kdfMetadata: {
        kdf: "argon2id",
        version: "kdf-v1",
        salt: "c2FsdA",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
      },
    });
    vi.mocked(vaultApi.replaceRecoveryPhrase).mockResolvedValue({
      id: "env-new",
      createdAt: "2026-06-17T00:00:00.000Z",
    });
  });

  it("replaces recovery phrase with encrypted envelope only", async () => {
    const onReplaced = vi.fn();
    const phrase =
      "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    render(
      <RecoveryPhraseReplace recoveryPhrase={recoveryPhraseStatus} onReplaced={onReplaced} />
    );

    fireEvent.click(screen.getByRole("button", { name: /replace recovery phrase/i }));
    fireEvent.click(screen.getByRole("button", { name: /12 words/i }));
    fireEvent.click(screen.getByRole("button", { name: /i have saved my phrase/i }));

    const textarea = screen.getByLabelText(/recovery phrase/i);
    fireEvent.change(textarea, { target: { value: phrase } });
    fireEvent.click(screen.getByRole("button", { name: /^replace recovery phrase$/i }));

    await waitFor(() => {
      expect(vaultApi.replaceRecoveryPhrase).toHaveBeenCalledWith(
        expect.objectContaining({
          publicMetadata: { phraseLength: 12 },
        })
      );
    });

    expect(wrapVaultKeyForRecoveryPhrase).toHaveBeenCalled();
    expect(onReplaced).toHaveBeenCalled();
  });
});
