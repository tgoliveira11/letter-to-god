import { beforeEach, describe, expect, it, vi } from "vitest";
import { PUT } from "@/app/api/vault/password-envelope/route";
import { encryptedPayload, USER_ID } from "@/test/helpers/fixtures";

const mocks = vi.hoisted(() => ({
  requireFullyAuthenticatedUser: vi.fn(),
  replacePasswordEnvelope: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireFullyAuthenticatedUser: mocks.requireFullyAuthenticatedUser,
}));
vi.mock("@/server/services/vault-service", () => ({
  vaultService: { replacePasswordEnvelope: mocks.replacePasswordEnvelope },
}));

describe("password envelope API route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFullyAuthenticatedUser.mockResolvedValue({ id: USER_ID });
  });

  it("persists an Argon2id ciphertext envelope", async () => {
    mocks.replacePasswordEnvelope.mockResolvedValue({
      id: "env-new",
      createdAt: "2026-07-27T12:00:00.000Z",
    });
    const response = await PUT(
      new Request("http://localhost/api/vault/password-envelope", {
        method: "PUT",
        body: JSON.stringify({
          encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
          kdfMetadata: {
            kdf: "argon2id",
            version: "kdf-v2",
            salt: "c2FsdA",
            memory: 65536,
            iterations: 3,
            parallelism: 1,
          },
        }),
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.replacePasswordEnvelope).toHaveBeenCalledWith(
      USER_ID,
      expect.objectContaining({ kdfMetadata: expect.objectContaining({ kdf: "argon2id" }) })
    );
  });

  it("rejects a plaintext vault password", async () => {
    const response = await PUT(
      new Request("http://localhost/api/vault/password-envelope", {
        method: "PUT",
        body: JSON.stringify({
          vaultPassword: "must-never-reach-the-server",
          encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
          kdfMetadata: {
            kdf: "argon2id",
            version: "kdf-v2",
            salt: "c2FsdA",
            memory: 65536,
            iterations: 3,
            parallelism: 1,
          },
        }),
      })
    );

    expect(response.status).toBe(400);
    expect(mocks.replacePasswordEnvelope).not.toHaveBeenCalled();
  });
});
