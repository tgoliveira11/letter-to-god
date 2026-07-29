import { runInTransaction } from "@/lib/db/transaction";
import { vaultRepository } from "@/server/repositories/vault-repository";
import { auditRepository } from "@/server/repositories/audit-repository";
import type {
  VaultInitInput,
  RecoveryCodeInput,
  VaultSetupInput,
  RecoveryPhraseReplaceInput,
  PasswordEnvelopeReplaceInput,
} from "@/lib/validation/vault";
import {
  assertVaultKeyAad,
  assertVaultSettingsAad,
  assertVaultIndexAad,
} from "@/server/policies/aad-validation";
import { enforceRateLimit, RateLimitError } from "@/server/policies/rate-limit";
import { deriveSetupPhase } from "@/lib/vault/vault-status";
import { resolvePasskeyUnlockAvailableOnThisDevice } from "@/server/services/vault-passkey-device-binding-service";
import { SELAHKEEP_VAULT_PROFILE } from "@/modules/vault/selahkeep-profile";
import { resolvePortableVaultBrokerPublicConfig } from "@/lib/env/portable-vault-broker";
import { portableVaultBrokerRepository } from "@/server/repositories/portable-vault-broker-repository";

export const vaultService = {
  async setup(userId: string, input: VaultSetupInput) {
    const existing = await vaultRepository.findVaultByUserId(userId);
    if (existing) {
      throw new ConflictError("Vault already initialized");
    }

    assertVaultSettingsAad(userId, input.encryptedVaultSettings);
    assertVaultIndexAad(userId, input.encryptedVaultIndex);

    const methods = new Set(input.envelopes.map((e) => e.method));
    if (!methods.has("password") || !methods.has("recovery_phrase")) {
      throw new Error("Vault setup requires password and recovery_phrase envelopes");
    }

    return runInTransaction(async (tx) => {
      const vault = await vaultRepository.createVault(userId, input.vaultVersion, tx, {
        encryptedVaultSettings: input.encryptedVaultSettings,
        encryptedVaultIndex: input.encryptedVaultIndex,
      });

      for (const envelope of input.envelopes) {
        assertVaultKeyAad(userId, envelope.encryptedVaultKey, SELAHKEEP_VAULT_PROFILE.aadContextEnvelope);
        if (envelope.kdfMetadata.kdf !== "argon2id") {
          throw new Error("Vault envelopes require Argon2id KDF metadata");
        }
        await vaultRepository.createEnvelope(
          {
            userId,
            method: envelope.method,
            encryptedVaultKey: envelope.encryptedVaultKey,
            kdfMetadata: envelope.kdfMetadata,
            publicMetadata: envelope.publicMetadata ?? null,
          },
          tx
        );
      }

      await auditRepository.record("vault_initialized", userId, { vaultVersion: "vault-v2" }, tx);
      return vault;
    });
  },

  async init(userId: string, input: VaultInitInput) {
    const existing = await vaultRepository.findVaultByUserId(userId);
    if (existing) {
      throw new ConflictError("Vault already initialized");
    }

    return runInTransaction(async (tx) => {
      const vault = await vaultRepository.createVault(userId, input.vaultVersion, tx);

      for (const envelope of input.envelopes) {
        assertVaultKeyAad(userId, envelope.encryptedVaultKey, SELAHKEEP_VAULT_PROFILE.aadContextEnvelope);

        await vaultRepository.createEnvelope(
          {
            userId,
            method: envelope.method,
            encryptedVaultKey: envelope.encryptedVaultKey,
            kdfMetadata: envelope.kdfMetadata ?? null,
            publicMetadata: envelope.publicMetadata ?? null,
          },
          tx
        );
      }

      await auditRepository.record("vault_initialized", userId, undefined, tx);
      return vault;
    });
  },

  async getStatus(userId: string, deviceBindingId?: string) {
    const vault = await vaultRepository.findVaultByUserId(userId);
    if (!vault) {
      return {
        initialized: false,
        hasVault: false,
        setupPhase: "not_configured" as const,
        setupComplete: false,
      };
    }

    const envelopes = await vaultRepository.findActiveEnvelopesByUserId(userId);
    const methods = new Set(envelopes.map((e) => e.method));
    const methodList = Array.from(methods);

    const hasEncryptedSettings = vault.encryptedVaultSettings != null;
    const hasEncryptedIndex = vault.encryptedVaultIndex != null;

    const ltgSetupComplete =
      vault.vaultVersion === "vault-v2" &&
      methods.has("password") &&
      methods.has("recovery_phrase") &&
      hasEncryptedSettings &&
      hasEncryptedIndex;

    const setupPhase = deriveSetupPhase({
      initialized: true,
      vaultVersion: vault.vaultVersion,
      ltgSetupComplete,
      hasEncryptedSettings,
      hasEncryptedIndex,
      methods: methodList,
    });

    const setupComplete = setupPhase === "complete";
    const portablePasskeys = resolvePortableVaultBrokerPublicConfig().enabled
      ? await portableVaultBrokerRepository.listCurrentForUser(userId)
      : [];
    const hasPortablePasskey = portablePasskeys.some((mapping) => mapping.state === "active");

    const activeRecoveryPhrase = methods.has("recovery_phrase")
      ? await vaultRepository.findActiveEnvelopeByMethod(userId, "recovery_phrase")
      : null;

    let recoveryPhraseMeta:
      | {
          phraseLength?: number;
          createdAt: string;
          replacedAt?: string;
        }
      | undefined;

    if (activeRecoveryPhrase) {
      const phraseHistory = await vaultRepository.findEnvelopesByMethod(userId, "recovery_phrase");
      const firstEnvelope = phraseHistory[0];
      const revokedCount = phraseHistory.filter((envelope) => envelope.revokedAt != null).length;
      const publicMetadata = activeRecoveryPhrase.publicMetadata as { phraseLength?: number } | null;

      recoveryPhraseMeta = {
        phraseLength: publicMetadata?.phraseLength,
        createdAt: firstEnvelope?.createdAt.toISOString() ?? activeRecoveryPhrase.createdAt.toISOString(),
        replacedAt:
          revokedCount > 0 ? activeRecoveryPhrase.createdAt.toISOString() : undefined,
      };
    }

    let recoveryState: "Protected" | "Basic" | "At Risk" | undefined;
    if (setupComplete) {
      const durableMethods = ["recovery_code", "recovery_phrase", "passkey_authorized_device"].filter(
        (m) => methods.has(m)
      );
      if (hasPortablePasskey) durableMethods.push("portable_passkey");

      if (ltgSetupComplete || (durableMethods.length >= 1 && methods.size >= 2)) {
        recoveryState = "Protected";
      } else if (methods.has("password")) {
        recoveryState = "Basic";
      } else {
        recoveryState = "At Risk";
      }
    }

    const passkeyUnlockAvailableOnThisDevice =
      setupComplete && methods.has("passkey_authorized_device")
        ? await resolvePasskeyUnlockAvailableOnThisDevice(userId, deviceBindingId)
        : false;

    return {
      initialized: true,
      hasVault: true,
      setupPhase,
      setupComplete,
      vaultVersion: vault.vaultVersion,
      recoveryState,
      methods: methodList,
      hasEncryptedSettings,
      hasEncryptedIndex,
      hasRecoveryCode: methods.has("recovery_code"),
      hasRecoveryPhrase: methods.has("recovery_phrase"),
      hasVaultPassword: methods.has("password"),
      hasPasskey: hasPortablePasskey || methods.has("passkey_authorized_device"),
      hasPortablePasskey,
      ltgSetupComplete,
      recoveryPhrase: recoveryPhraseMeta,
      passkeyUnlockAvailableOnThisDevice,
      availableUnlockMethods: setupComplete
        ? {
            password: methods.has("password"),
            recoveryPhrase: methods.has("recovery_phrase"),
            passkey: hasPortablePasskey || methods.has("passkey_authorized_device"),
            portablePasskey: hasPortablePasskey,
          }
        : undefined,
    };
  },

  async storeRecoveryCode(userId: string, input: RecoveryCodeInput) {
    const vault = await vaultRepository.findVaultByUserId(userId);
    if (!vault) throw new NotFoundError("Vault not initialized");

    assertVaultKeyAad(userId, input.encryptedVaultKey, SELAHKEEP_VAULT_PROFILE.aadContextEnvelope);
    if (input.kdfMetadata.kdf !== "argon2id") {
      throw new Error("Recovery code envelope requires Argon2id KDF metadata");
    }

    return runInTransaction(async (tx) => {
      const existing = await vaultRepository.findActiveEnvelopeByMethod(userId, "recovery_code");
      if (existing) {
        await vaultRepository.revokeEnvelope(existing.id, userId, tx);
        await auditRepository.record("recovery_code_regenerated", userId, undefined, tx);
      } else {
        await auditRepository.record("recovery_code_generated", userId, undefined, tx);
      }

      const envelope = await vaultRepository.createEnvelope(
        {
          userId,
          method: "recovery_code",
          encryptedVaultKey: input.encryptedVaultKey,
          kdfMetadata: input.kdfMetadata,
        },
        tx
      );

      return { id: envelope.id };
    });
  },

  async replaceRecoveryPhrase(userId: string, input: RecoveryPhraseReplaceInput) {
    const vault = await vaultRepository.findVaultByUserId(userId);
    if (!vault) throw new NotFoundError("Vault not initialized");
    if (vault.vaultVersion !== "vault-v2") {
      throw new Error("Recovery phrase replacement requires vault-v2");
    }

    assertVaultKeyAad(userId, input.encryptedVaultKey, SELAHKEEP_VAULT_PROFILE.aadContextEnvelope);
    if (input.kdfMetadata.kdf !== "argon2id") {
      throw new Error("Recovery phrase envelope requires Argon2id KDF metadata");
    }

    return runInTransaction(async (tx) => {
      await vaultRepository.lockEnvelopeMutation(userId, "recovery_phrase", tx);
      const existing = await vaultRepository.findActiveEnvelopeByMethod(userId, "recovery_phrase", tx);
      if (!existing) {
        throw new NotFoundError("No recovery phrase configured");
      }

      await vaultRepository.revokeEnvelope(existing.id, userId, tx);
      await auditRepository.record("recovery_phrase_replaced", userId, undefined, tx);

      const envelope = await vaultRepository.createEnvelope(
        {
          userId,
          method: "recovery_phrase",
          encryptedVaultKey: input.encryptedVaultKey,
          kdfMetadata: input.kdfMetadata,
          publicMetadata: input.publicMetadata ?? null,
        },
        tx
      );

      return {
        id: envelope.id,
        createdAt: envelope.createdAt.toISOString(),
      };
    });
  },

  async replacePasswordEnvelope(userId: string, input: PasswordEnvelopeReplaceInput) {
    const vault = await vaultRepository.findVaultByUserId(userId);
    if (!vault) throw new NotFoundError("Vault not initialized");
    if (vault.vaultVersion !== "vault-v2") {
      throw new Error("Password envelope upgrade requires vault-v2");
    }

    assertVaultKeyAad(userId, input.encryptedVaultKey, SELAHKEEP_VAULT_PROFILE.aadContextEnvelope);
    if (input.kdfMetadata.kdf !== "argon2id") {
      throw new Error("Password envelope requires Argon2id KDF metadata");
    }

    return runInTransaction(async (tx) => {
      await vaultRepository.lockEnvelopeMutation(userId, "password", tx);
      const existing = await vaultRepository.findActiveEnvelopeByMethod(userId, "password", tx);
      if (!existing) throw new NotFoundError("No vault password configured");

      await vaultRepository.revokeEnvelope(existing.id, userId, tx);
      const envelope = await vaultRepository.createEnvelope(
        {
          userId,
          method: "password",
          encryptedVaultKey: input.encryptedVaultKey,
          kdfMetadata: input.kdfMetadata,
        },
        tx
      );
      await auditRepository.record("vault_password_kdf_upgraded", userId, undefined, tx);
      return { id: envelope.id, createdAt: envelope.createdAt.toISOString() };
    });
  },

  async getIndex(userId: string) {
    const vault = await vaultRepository.findVaultByUserId(userId);
    if (!vault) throw new NotFoundError("Vault not initialized");
    return { encryptedVaultIndex: vault.encryptedVaultIndex };
  },

  async updateIndex(userId: string, encryptedVaultIndex: import("@/lib/validation/encrypted-payload").EncryptedPayload) {
    const vault = await vaultRepository.findVaultByUserId(userId);
    if (!vault) throw new NotFoundError("Vault not initialized");

    assertVaultIndexAad(userId, encryptedVaultIndex);

    const updated = await vaultRepository.updateVaultIndex(userId, encryptedVaultIndex);
    if (!updated) throw new NotFoundError("Vault not initialized");
    return { encryptedVaultIndex: updated.encryptedVaultIndex };
  },

  async getSettings(userId: string) {
    const vault = await vaultRepository.findVaultByUserId(userId);
    if (!vault) throw new NotFoundError("Vault not initialized");
    return { encryptedVaultSettings: vault.encryptedVaultSettings };
  },

  async updateSettings(
    userId: string,
    encryptedVaultSettings: import("@/lib/validation/encrypted-payload").EncryptedPayload
  ) {
    const vault = await vaultRepository.findVaultByUserId(userId);
    if (!vault) throw new NotFoundError("Vault not initialized");

    assertVaultSettingsAad(userId, encryptedVaultSettings);

    const updated = await vaultRepository.updateVaultSettings(userId, encryptedVaultSettings);
    if (!updated) throw new NotFoundError("Vault not initialized");
    return { encryptedVaultSettings: updated.encryptedVaultSettings };
  },

  async getUnlockEnvelope(userId: string, method: string, ip?: string) {
    try {
      await enforceRateLimit({
        operation: "recovery.attempt",
        userId,
        ip,
        endpoint: "/api/vault/unlock-envelope",
      });
    } catch (error) {
      if (error instanceof RateLimitError) {
        await auditRepository.record("failed_unlock_attempt", userId, { method });
        throw error;
      }
      throw error;
    }

    const envelope = await vaultRepository.findActiveEnvelopeByMethod(userId, method);
    if (!envelope) {
      await auditRepository.record("failed_unlock_attempt", userId, { method });
      throw new NotFoundError(`No ${method} envelope configured`);
    }

    return {
      encryptedVaultKey: envelope.encryptedVaultKey,
      kdfMetadata: envelope.kdfMetadata,
    };
  },

  async unlockWithRecoveryCode(userId: string, ip?: string) {
    try {
      await enforceRateLimit({
        operation: "recovery.attempt",
        userId,
        ip,
        endpoint: "/api/vault/unlock-with-recovery-code",
      });
    } catch (error) {
      if (error instanceof RateLimitError) {
        await auditRepository.record("failed_unlock_attempt", userId, { method: "recovery_code" });
        throw error;
      }
      throw error;
    }

    const envelope = await vaultRepository.findActiveEnvelopeByMethod(userId, "recovery_code");
    if (!envelope) {
      await auditRepository.record("failed_unlock_attempt", userId, { method: "recovery_code" });
      throw new NotFoundError("No recovery code configured");
    }

    return {
      encryptedVaultKey: envelope.encryptedVaultKey,
      kdfMetadata: envelope.kdfMetadata,
    };
  },
};

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export { RateLimitError };
