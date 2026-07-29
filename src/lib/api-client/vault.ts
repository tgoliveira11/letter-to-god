import { apiClient } from "./client";
import type { EncryptedPayload, KdfMetadata } from "@/lib/validation/encrypted-payload";

export type VaultSetupPhase = "not_configured" | "setup_incomplete" | "complete";

export type VaultUnlockMethods = {
  password: boolean;
  recoveryPhrase: boolean;
  passkey: boolean;
  portablePasskey: boolean;
};

export type PortableVaultMapping = {
  id: string;
  state: "pending" | "active";
  brokerEnvelopeId: string | null;
  opaqueScope: { userId: string; resourceId: string };
  enrollmentRequestId: string | null;
  createdAt: string;
  activatedAt: string | null;
  credentialDbId: string;
  credentialId: string;
  friendlyName: string;
  signInEnabled: boolean;
};

export type RecoveryPhraseStatus = {
  phraseLength?: number;
  createdAt: string;
  replacedAt?: string;
};

export interface VaultStatus {
  initialized: boolean;
  hasVault: boolean;
  setupPhase: VaultSetupPhase;
  setupComplete: boolean;
  vaultVersion?: string;
  recoveryState?: "Protected" | "Basic" | "At Risk";
  methods?: string[];
  hasEncryptedSettings?: boolean;
  hasEncryptedIndex?: boolean;
  hasRecoveryCode?: boolean;
  hasRecoveryPhrase?: boolean;
  hasVaultPassword?: boolean;
  hasPasskey?: boolean;
  hasPortablePasskey?: boolean;
  passkeyUnlockAvailableOnThisDevice?: boolean;
  ltgSetupComplete?: boolean;
  recoveryPhrase?: RecoveryPhraseStatus;
  availableUnlockMethods?: VaultUnlockMethods;
}

export const vaultApi = {
  setup: (payload: {
    vaultVersion: "vault-v2";
    encryptedVaultSettings: EncryptedPayload;
    encryptedVaultIndex: EncryptedPayload;
    envelopes: Array<{
      method: "password" | "recovery_phrase";
      encryptedVaultKey: EncryptedPayload;
      kdfMetadata: KdfMetadata;
      publicMetadata?: Record<string, unknown>;
    }>;
  }) => apiClient.post<{ id: string }>("/api/vault/setup", payload),

  init: (payload: {
    vaultVersion: string;
    envelopes: Array<{
      method: string;
      encryptedVaultKey: EncryptedPayload;
      kdfMetadata?: KdfMetadata;
      publicMetadata?: Record<string, unknown>;
    }>;
  }) => apiClient.post<{ id: string }>("/api/vault/init", payload),

  status: () => apiClient.get<VaultStatus>("/api/vault/status"),

  storeRecoveryCode: (payload: {
    encryptedVaultKey: EncryptedPayload;
    kdfMetadata: KdfMetadata;
  }) => apiClient.post<{ id: string }>("/api/recovery-code", payload),

  replaceRecoveryPhrase: (payload: {
    encryptedVaultKey: EncryptedPayload;
    kdfMetadata: KdfMetadata;
    publicMetadata?: { phraseLength: 12 | 24 };
  }) =>
    apiClient.post<{ id: string; createdAt: string }>("/api/vault/recovery-phrase", payload),

  replacePasswordEnvelope: (payload: {
    encryptedVaultKey: EncryptedPayload;
    kdfMetadata: KdfMetadata;
  }) =>
    apiClient.put<{ id: string; createdAt: string }>("/api/vault/password-envelope", payload),

  unlockWithRecoveryCode: () =>
    apiClient.post<{
      encryptedVaultKey: EncryptedPayload;
      kdfMetadata: KdfMetadata;
    }>("/api/vault/unlock-with-recovery-code", {}),

  unlockEnvelope: (method: "password" | "recovery_phrase" | "recovery_code") =>
    apiClient.post<{
      encryptedVaultKey: EncryptedPayload;
      kdfMetadata: KdfMetadata;
      publicMetadata?: { phraseLength?: 12 | 24 };
    }>("/api/vault/unlock-envelope", { method }),

  getIndex: () =>
    apiClient.get<{ encryptedVaultIndex: EncryptedPayload | null }>("/api/vault/index"),

  updateIndex: (encryptedVaultIndex: EncryptedPayload) =>
    apiClient.patch<{ encryptedVaultIndex: EncryptedPayload | null }>("/api/vault/index", {
      encryptedVaultIndex,
    }),

  getSettings: () =>
    apiClient.get<{ encryptedVaultSettings: EncryptedPayload | null }>("/api/vault/settings"),

  updateSettings: (encryptedVaultSettings: EncryptedPayload) =>
    apiClient.patch<{ encryptedVaultSettings: EncryptedPayload | null }>(
      "/api/vault/settings",
      { encryptedVaultSettings }
    ),

  listSecurityEvents: () =>
    apiClient.get<{
      events: Array<{ id: string; eventType: string; label: string; createdAt: string }>;
    }>("/api/vault/security-events"),

  listPortablePasskeys: () =>
    apiClient.get<{
      mappings: PortableVaultMapping[];
      active: PortableVaultMapping[];
      pending: PortableVaultMapping[];
    }>("/api/vault/portable-passkey"),

  preparePortablePasskey: (payload: {
    credentialDbId: string;
    opaqueScope: { userId: string; resourceId: string };
  }) =>
    apiClient.post<PortableVaultMapping>("/api/vault/portable-passkey/prepare", payload),

  bindPortablePasskey: (payload: {
    mappingId: string;
    brokerEnvelopeId: string;
    requestId: string;
  }) =>
    apiClient.post<{ bound: true }>("/api/vault/portable-passkey/bind", payload),
};
