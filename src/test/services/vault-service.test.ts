import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  vaultService,
  ConflictError,
  NotFoundError,
  RateLimitError,
} from "@/server/services/vault-service";
import { encryptedPayload, USER_ID } from "@/test/helpers/fixtures";

const mocks = vi.hoisted(() => ({
  findVaultByUserId: vi.fn(),
  createVault: vi.fn(),
  createEnvelope: vi.fn(),
  findActiveEnvelopesByUserId: vi.fn(),
  findActiveEnvelopeByMethod: vi.fn(),
  findEnvelopesByMethod: vi.fn(),
  lockEnvelopeMutation: vi.fn(),
  revokeEnvelope: vi.fn(),
  updateVaultIndex: vi.fn(),
  updateVaultSettings: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/server/repositories/vault-repository", () => ({
  vaultRepository: {
    findVaultByUserId: mocks.findVaultByUserId,
    createVault: mocks.createVault,
    createEnvelope: mocks.createEnvelope,
    findActiveEnvelopesByUserId: mocks.findActiveEnvelopesByUserId,
    findActiveEnvelopeByMethod: mocks.findActiveEnvelopeByMethod,
    findEnvelopesByMethod: mocks.findEnvelopesByMethod,
    lockEnvelopeMutation: mocks.lockEnvelopeMutation,
    revokeEnvelope: mocks.revokeEnvelope,
    updateVaultIndex: mocks.updateVaultIndex,
    updateVaultSettings: mocks.updateVaultSettings,
  },
}));

vi.mock("@/server/repositories/audit-repository", () => ({
  auditRepository: { record: mocks.record },
}));

describe("vault service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findEnvelopesByMethod.mockResolvedValue([]);
    mocks.findActiveEnvelopeByMethod.mockResolvedValue(null);
  });

  it("initializes a new vault with recovery_code envelope", async () => {
    mocks.findVaultByUserId.mockResolvedValue(null);
    mocks.createVault.mockResolvedValue({ id: "vault-1" });

    const result = await vaultService.init(USER_ID, {
      vaultVersion: "vault-v1",
      envelopes: [
        {
          method: "recovery_code",
          encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
          kdfMetadata: {
            kdf: "argon2id",
            version: "kdf-v1",
            salt: "c2FsdA",
            memory: 65536,
            iterations: 3,
            parallelism: 1,
          },
        },
      ],
    });

    expect(result.id).toBe("vault-1");
    expect(mocks.createEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({ method: "recovery_code" }),
      expect.anything()
    );
    expect(mocks.record).toHaveBeenCalledWith(
      "vault_initialized",
      USER_ID,
      undefined,
      expect.anything()
    );
  });

  it("initializes vault with non-device envelopes in the same transaction", async () => {
    mocks.findVaultByUserId.mockResolvedValue(null);
    mocks.createVault.mockResolvedValue({ id: "vault-1" });
    mocks.createEnvelope.mockResolvedValue({ id: "env-recovery" });

    await vaultService.init(USER_ID, {
      vaultVersion: "vault-v1",
      envelopes: [
        {
          method: "recovery_code",
          encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
          kdfMetadata: {
            kdf: "argon2id",
            version: "kdf-v1",
            salt: "c2FsdA",
            memory: 65536,
            iterations: 3,
            parallelism: 1,
          },
        },
      ],
    });

    expect(mocks.createEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({ method: "recovery_code" }),
      expect.anything()
    );
  });

  it("rejects duplicate vault init", async () => {
    mocks.findVaultByUserId.mockResolvedValue({ id: "vault-1" });
    await expect(
      vaultService.init(USER_ID, {
        vaultVersion: "vault-v1",
        envelopes: [
          {
            method: "recovery_code",
            encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
          },
        ],
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("returns not_configured when vault missing", async () => {
    mocks.findVaultByUserId.mockResolvedValue(null);
    await expect(vaultService.getStatus(USER_ID)).resolves.toEqual({
      initialized: false,
      hasVault: false,
      setupPhase: "not_configured",
      setupComplete: false,
    });
  });

  it("reports setup_incomplete for vault-v2 missing encrypted settings", async () => {
    mocks.findVaultByUserId.mockResolvedValue({
      vaultVersion: "vault-v2",
      encryptedVaultSettings: null,
      encryptedVaultIndex: encryptedPayload("vault_index", USER_ID),
    });
    mocks.findActiveEnvelopesByUserId.mockResolvedValue([
      { method: "password" },
      { method: "recovery_phrase" },
    ]);

    await expect(vaultService.getStatus(USER_ID)).resolves.toMatchObject({
      setupPhase: "setup_incomplete",
      setupComplete: false,
      ltgSetupComplete: false,
      recoveryState: undefined,
    });
  });

  it("classifies Protected recovery state", async () => {
    mocks.findVaultByUserId.mockResolvedValue({ vaultVersion: "vault-v1" });
    mocks.findActiveEnvelopesByUserId.mockResolvedValue([
      { method: "password" },
      { method: "recovery_code" },
    ]);
    const status = await vaultService.getStatus(USER_ID);
    expect(status.recoveryState).toBe("Protected");
    expect(status.hasRecoveryCode).toBe(true);
  });

  it("stores recovery code and revokes previous envelope", async () => {
    mocks.findVaultByUserId.mockResolvedValue({ id: "vault-1" });
    mocks.findActiveEnvelopeByMethod.mockResolvedValue({ id: "env-old" });
    mocks.createEnvelope.mockResolvedValue({ id: "env-new" });

    const result = await vaultService.storeRecoveryCode(USER_ID, {
      encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
      kdfMetadata: {
        kdf: "argon2id",
        version: "kdf-v1",
        salt: "c2FsdA",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
      },
    });

    expect(result.id).toBe("env-new");
    expect(mocks.revokeEnvelope).toHaveBeenCalledWith("env-old", USER_ID, expect.anything());
  });

  it("rejects recovery code envelope with non-Argon2id KDF metadata", async () => {
    mocks.findVaultByUserId.mockResolvedValue({ id: "vault-1" });
    await expect(
      vaultService.storeRecoveryCode(USER_ID, {
        encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
        kdfMetadata: {
          kdf: "pbkdf2-sha256",
          version: "kdf-v1",
          salt: "c2FsdA",
          iterations: 600_000,
        },
      })
    ).rejects.toThrow(/Argon2id/);
  });

  it("unlockWithRecoveryCode rate limits attempts", async () => {
    mocks.findActiveEnvelopeByMethod.mockResolvedValue({
      encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
      kdfMetadata: {},
    });
    for (let i = 0; i < 5; i++) {
      await vaultService.unlockWithRecoveryCode(USER_ID);
    }
    await expect(vaultService.unlockWithRecoveryCode(USER_ID)).rejects.toBeInstanceOf(
      RateLimitError
    );
  });

  it("classifies At Risk recovery state with only password", async () => {
    mocks.findVaultByUserId.mockResolvedValue({ vaultVersion: "vault-v1" });
    mocks.findActiveEnvelopesByUserId.mockResolvedValue([{ method: "password" }]);
    await expect(vaultService.getStatus(USER_ID)).resolves.toMatchObject({
      recoveryState: "Basic",
      hasPasskey: false,
    });
  });

  it("stores first recovery code without revoking previous envelope", async () => {
    mocks.findVaultByUserId.mockResolvedValue({ id: "vault-1" });
    mocks.findActiveEnvelopeByMethod.mockResolvedValue(null);
    mocks.createEnvelope.mockResolvedValue({ id: "env-new" });
    await vaultService.storeRecoveryCode(USER_ID, {
      encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
      kdfMetadata: {
        kdf: "argon2id",
        version: "kdf-v1",
        salt: "c2FsdA",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
      },
    });
    expect(mocks.revokeEnvelope).not.toHaveBeenCalled();
    expect(mocks.record).toHaveBeenCalledWith(
      "recovery_code_generated",
      USER_ID,
      undefined,
      expect.anything()
    );
  });

  it("unlockWithRecoveryCode fails when no envelope", async () => {
    mocks.findActiveEnvelopeByMethod.mockResolvedValue(null);
    await expect(vaultService.unlockWithRecoveryCode(USER_ID)).rejects.toBeInstanceOf(
      NotFoundError
    );
  });

  it("getSettings returns encrypted vault settings", async () => {
    const settings = encryptedPayload("vault_settings", USER_ID);
    mocks.findVaultByUserId.mockResolvedValue({ encryptedVaultSettings: settings });
    await expect(vaultService.getSettings(USER_ID)).resolves.toEqual({
      encryptedVaultSettings: settings,
    });
  });

  it("updateSettings persists encrypted vault settings", async () => {
    const settings = encryptedPayload("vault_settings", USER_ID);
    mocks.findVaultByUserId.mockResolvedValue({ id: "vault-1" });
    mocks.updateVaultSettings.mockResolvedValue({ encryptedVaultSettings: settings });
    await expect(vaultService.updateSettings(USER_ID, settings)).resolves.toEqual({
      encryptedVaultSettings: settings,
    });
  });

  it("getIndex returns encrypted vault index", async () => {
    const index = encryptedPayload("vault_index", USER_ID);
    mocks.findVaultByUserId.mockResolvedValue({ encryptedVaultIndex: index });
    await expect(vaultService.getIndex(USER_ID)).resolves.toEqual({
      encryptedVaultIndex: index,
    });
  });

  it("replaceRecoveryPhrase revokes previous envelope and creates a new one", async () => {
    mocks.findVaultByUserId.mockResolvedValue({ id: "vault-1", vaultVersion: "vault-v2" });
    mocks.findActiveEnvelopeByMethod.mockResolvedValue({ id: "env-old" });
    mocks.createEnvelope.mockResolvedValue({
      id: "env-new",
      createdAt: new Date("2026-06-17T12:00:00.000Z"),
    });

    const result = await vaultService.replaceRecoveryPhrase(USER_ID, {
      encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
      kdfMetadata: {
        kdf: "argon2id",
        version: "kdf-v1",
        salt: "c2FsdA",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
      },
      publicMetadata: { phraseLength: 24 },
    });

    expect(result.id).toBe("env-new");
    expect(mocks.revokeEnvelope).toHaveBeenCalledWith("env-old", USER_ID, expect.anything());
    expect(mocks.createEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({ method: "recovery_phrase", publicMetadata: { phraseLength: 24 } }),
      expect.anything()
    );
    expect(mocks.record).toHaveBeenCalledWith(
      "recovery_phrase_replaced",
      USER_ID,
      undefined,
      expect.anything()
    );
  });

  it("replaceRecoveryPhrase fails when no active recovery phrase exists", async () => {
    mocks.findVaultByUserId.mockResolvedValue({ id: "vault-1", vaultVersion: "vault-v2" });
    mocks.findActiveEnvelopeByMethod.mockResolvedValue(null);

    await expect(
      vaultService.replaceRecoveryPhrase(USER_ID, {
        encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
        kdfMetadata: {
          kdf: "argon2id",
          version: "kdf-v1",
          salt: "c2FsdA",
          memory: 65536,
          iterations: 3,
          parallelism: 1,
        },
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("atomically replaces a password envelope after a KDF upgrade", async () => {
    mocks.findVaultByUserId.mockResolvedValue({ id: "vault-1", vaultVersion: "vault-v2" });
    mocks.findActiveEnvelopeByMethod.mockResolvedValue({ id: "env-password-old" });
    mocks.createEnvelope.mockResolvedValue({
      id: "env-password-new",
      createdAt: new Date("2026-07-27T12:00:00.000Z"),
    });

    const result = await vaultService.replacePasswordEnvelope(USER_ID, {
      encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
      kdfMetadata: {
        kdf: "argon2id",
        version: "kdf-v2",
        salt: "c2FsdA",
        memory: 65536,
        iterations: 3,
        parallelism: 1,
      },
    });

    expect(mocks.lockEnvelopeMutation).toHaveBeenCalledWith(
      USER_ID,
      "password",
      expect.anything()
    );
    expect(mocks.revokeEnvelope).toHaveBeenCalledWith(
      "env-password-old",
      USER_ID,
      expect.anything()
    );
    expect(mocks.createEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({ method: "password" }),
      expect.anything()
    );
    expect(mocks.record).toHaveBeenCalledWith(
      "vault_password_kdf_upgraded",
      USER_ID,
      undefined,
      expect.anything()
    );
    expect(result).toEqual({
      id: "env-password-new",
      createdAt: "2026-07-27T12:00:00.000Z",
    });
  });

  it("includes recovery phrase metadata in status", async () => {
    const createdAt = new Date("2026-01-01T00:00:00.000Z");
    const replacedAt = new Date("2026-06-01T00:00:00.000Z");
    mocks.findVaultByUserId.mockResolvedValue({
      vaultVersion: "vault-v2",
      encryptedVaultSettings: encryptedPayload("vault_settings", USER_ID),
      encryptedVaultIndex: encryptedPayload("vault_index", USER_ID),
    });
    mocks.findActiveEnvelopesByUserId.mockResolvedValue([
      { method: "password" },
      { method: "recovery_phrase" },
    ]);
    mocks.findActiveEnvelopeByMethod.mockResolvedValue({
      createdAt: replacedAt,
      publicMetadata: { phraseLength: 12 },
    });
    mocks.findEnvelopesByMethod.mockResolvedValue([
      { createdAt, revokedAt: createdAt },
      { createdAt: replacedAt, revokedAt: null },
    ]);

    await expect(vaultService.getStatus(USER_ID)).resolves.toMatchObject({
      recoveryPhrase: {
        phraseLength: 12,
        createdAt: createdAt.toISOString(),
        replacedAt: replacedAt.toISOString(),
      },
    });
  });
});
