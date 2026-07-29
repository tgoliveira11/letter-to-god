import { z } from "zod";

export const portableVaultOpaqueScopeSchema = z
  .object({
    userId: z.string().uuid(),
    resourceId: z.string().uuid(),
  })
  .strict();

export const portableVaultPrepareSchema = z
  .object({
    credentialDbId: z.string().uuid(),
    opaqueScope: portableVaultOpaqueScopeSchema,
  })
  .strict();

export const portableVaultBindSchema = z
  .object({
    mappingId: z.string().uuid(),
    brokerEnvelopeId: z.string().uuid(),
    requestId: z.string().uuid(),
  })
  .strict();

export const portableVaultBrokerCompletionSchema = z
  .object({
    envelopeId: z.string().uuid(),
    requestId: z.string().uuid(),
    completionReceipt: z.string().min(1).max(16_384),
  })
  .strict();

export const portableVaultBrokerOperationCompletionSchema = z
  .object({
    requestId: z.string().uuid(),
    completionReceipt: z.string().min(1).max(16_384),
  })
  .strict();

export const portableVaultFinalizedReceiptSchema = z
  .object({
    action: z.enum(["enroll", "unlock", "revoke"]),
    requestId: z.string().uuid(),
    credentialId: z.string().min(1).max(2048),
    envelopeId: z.string().uuid(),
    completed: z.literal(true),
    vaultUnlockEnabled: z.boolean().optional(),
  })
  .strict();

export type PortableVaultPrepareInput = z.infer<typeof portableVaultPrepareSchema>;
export type PortableVaultBindInput = z.infer<typeof portableVaultBindSchema>;
