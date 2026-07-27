import {
  assertNoVaultPlaintextFields as coreAssertNoVaultPlaintextFields,
} from "@tgoliveira/vault-core";
import { z } from "zod";
import { encryptedPayloadSchema, kdfMetadataSchema } from "./encrypted-payload";

const SELAHKEEP_EXTRA_FORBIDDEN_FIELDS = [
  "noteKey",
  "title",
  "body",
  "content",
  "message",
  "tags",
  "tagIds",
  "tagNames",
  "category",
  "categoryId",
  "categoryName",
  "answered",
  "unlockBehavior",
  "categories",
  "plaintextTitle",
  "plaintextBody",
] as const;

export function rejectVaultPlaintextFields(body: Record<string, unknown>): string | null {
  try {
    coreAssertNoVaultPlaintextFields(body);
  } catch (error) {
    return error instanceof Error ? error.message : "Plaintext field rejected";
  }
  for (const field of SELAHKEEP_EXTRA_FORBIDDEN_FIELDS) {
    if (field in body && body[field] !== undefined) {
      return `Plaintext field '${field}' is not allowed`;
    }
  }
  return null;
}

export function assertNoVaultPlaintextFields(body: Record<string, unknown>): void {
  const error = rejectVaultPlaintextFields(body);
  if (error) {
    throw new VaultPlaintextRejectionError(error);
  }
}

export class VaultPlaintextRejectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VaultPlaintextRejectionError";
  }
}

const ltgEnvelopeSchema = z.object({
  method: z.enum(["password", "recovery_phrase"]),
  encryptedVaultKey: encryptedPayloadSchema,
  kdfMetadata: kdfMetadataSchema,
  publicMetadata: z.record(z.unknown()).optional(),
});

export const vaultSetupSchema = z.object({
  vaultVersion: z.literal("vault-v2"),
  encryptedVaultSettings: encryptedPayloadSchema,
  encryptedVaultIndex: encryptedPayloadSchema,
  envelopes: z.array(ltgEnvelopeSchema).length(2),
});

export const vaultUnlockEnvelopeRequestSchema = z.object({
  method: z.enum(["password", "recovery_phrase", "recovery_code"]),
});

export const vaultInitSchema = z.object({
  vaultVersion: z.string().min(1),
  envelopes: z
    .array(
      z.object({
        method: z.enum([
          "passkey_authorized_device",
          "recovery_code",
          "password",
          "recovery_phrase",
        ]),
        encryptedVaultKey: encryptedPayloadSchema,
        kdfMetadata: kdfMetadataSchema.optional(),
        publicMetadata: z.record(z.unknown()).optional(),
      })
    )
    .min(1),
});

export const recoveryCodeSchema = z.object({
  encryptedVaultKey: encryptedPayloadSchema,
  kdfMetadata: kdfMetadataSchema,
});

export const recoveryPhraseReplaceSchema = z.object({
  encryptedVaultKey: encryptedPayloadSchema,
  kdfMetadata: kdfMetadataSchema,
  publicMetadata: z
    .object({
      phraseLength: z.union([z.literal(12), z.literal(24)]),
    })
    .optional(),
});

export const passwordEnvelopeReplaceSchema = z.object({
  encryptedVaultKey: encryptedPayloadSchema,
  kdfMetadata: kdfMetadataSchema,
});

export const unlockWithRecoveryCodeSchema = z.object({
  encryptedVaultKey: encryptedPayloadSchema,
  kdfMetadata: kdfMetadataSchema,
});

export const vaultSettingsUpdateSchema = z.object({
  encryptedVaultSettings: encryptedPayloadSchema,
});

export type VaultSettingsUpdateInput = z.infer<typeof vaultSettingsUpdateSchema>;
export type VaultSetupInput = z.infer<typeof vaultSetupSchema>;
export type VaultInitInput = z.infer<typeof vaultInitSchema>;
export type RecoveryCodeInput = z.infer<typeof recoveryCodeSchema>;
export type RecoveryPhraseReplaceInput = z.infer<typeof recoveryPhraseReplaceSchema>;
export type PasswordEnvelopeReplaceInput = z.infer<typeof passwordEnvelopeReplaceSchema>;

export const ALLOWED_ENCRYPTED_PREFIXES = [
  "encrypted",
  "kdf",
  "public",
  "vaultVersion",
  "envelopes",
  "method",
  "id",
  "answered",
  "encryptionVersion",
] as const;
