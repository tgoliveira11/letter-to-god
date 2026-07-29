import { runInTransaction } from "@/lib/db/transaction";
import { resolvePortableVaultBrokerPublicConfig } from "@/lib/env/portable-vault-broker";
import type {
  PortableVaultBindInput,
  PortableVaultPrepareInput,
} from "@/lib/validation/portable-vault-broker";
import { auditRepository } from "@/server/repositories/audit-repository";
import { passkeyRepository } from "@/server/repositories/passkey-repository";
import { portableVaultBrokerRepository } from "@/server/repositories/portable-vault-broker-repository";
import { vaultRepository } from "@/server/repositories/vault-repository";

export class PortableVaultBrokerDisabledError extends Error {
  constructor() {
    super("Portable passkey vault unlock is not enabled");
    this.name = "NotFoundError";
  }
}

export class PortableVaultBrokerConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

function assertEnabled() {
  if (!resolvePortableVaultBrokerPublicConfig().enabled) {
    throw new PortableVaultBrokerDisabledError();
  }
}

function toView(row: Awaited<ReturnType<typeof portableVaultBrokerRepository.listCurrentForUser>>[number]) {
  return {
    id: row.id,
    state: row.state as "pending" | "active",
    brokerEnvelopeId: row.brokerEnvelopeId,
    opaqueScope: {
      userId: row.opaqueAadUserId,
      resourceId: row.opaqueAadResourceId,
    },
    enrollmentRequestId: row.enrollmentRequestId,
    createdAt: row.createdAt.toISOString(),
    activatedAt: row.activatedAt?.toISOString() ?? null,
    credentialDbId: row.credentialDbId,
    credentialId: row.credentialId,
    friendlyName: row.friendlyName ?? "Passkey",
    signInEnabled: row.signInEnabled,
  };
}

export const portableVaultBrokerService = {
  async list(userId: string) {
    assertEnabled();
    const rows = await portableVaultBrokerRepository.listCurrentForUser(userId);
    return {
      mappings: rows.map(toView),
      active: rows.filter((row) => row.state === "active").map(toView),
      pending: rows.filter((row) => row.state === "pending").map(toView),
    };
  },

  async prepareEnrollment(userId: string, input: PortableVaultPrepareInput) {
    assertEnabled();
    const vault = await vaultRepository.findVaultByUserId(userId);
    if (!vault || vault.vaultVersion !== "vault-v2") {
      throw new PortableVaultBrokerConflictError("Set up the vault before enabling portable passkey unlock");
    }

    return runInTransaction(async (tx) => {
      await passkeyRepository.lockForVaultMutation(input.credentialDbId, userId, tx);
      const credential = await passkeyRepository.findByIdForUser(input.credentialDbId, userId, tx);
      if (!credential || !credential.signInEnabled) {
        throw new PortableVaultBrokerConflictError(
          "Choose an active account sign-in passkey for portable vault unlock"
        );
      }

      const cutover = await portableVaultBrokerRepository.findLatestCutoverEpoch(tx);
      if (cutover && credential.createdAt.getTime() <= cutover.cutoffAt.getTime()) {
        throw new PortableVaultBrokerConflictError(
          "Create a new account passkey after the portable-vault cutover before enabling it"
        );
      }

      const existing = await portableVaultBrokerRepository.findCurrentByCredential(
        userId,
        credential.id,
        tx
      );
      if (existing?.state === "active") {
        throw new PortableVaultBrokerConflictError("This passkey already has portable vault unlock");
      }
      if (existing) {
        const existingView = (
          await portableVaultBrokerRepository.listCurrentForUser(userId, tx)
        ).find((row) => row.id === existing.id);
        if (!existingView) {
          throw new PortableVaultBrokerConflictError(
            "Portable vault enrollment state changed"
          );
        }
        return toView(existingView);
      }

      const created = await portableVaultBrokerRepository.createPending(
        {
          userId,
          passkeyCredentialId: credential.id,
          opaqueAadUserId: input.opaqueScope.userId,
          opaqueAadResourceId: input.opaqueScope.resourceId,
        },
        tx
      );
      await auditRepository.record(
        "portable_vault_enrollment_pending",
        userId,
        { method: "portable_passkey" },
        tx
      );
      return {
        id: created.id,
        state: "pending" as const,
        brokerEnvelopeId: null,
        opaqueScope: input.opaqueScope,
        enrollmentRequestId: null,
        createdAt: created.createdAt.toISOString(),
        activatedAt: null,
        credentialDbId: credential.id,
        credentialId: credential.credentialId,
        friendlyName: credential.friendlyName ?? "Passkey",
        signInEnabled: credential.signInEnabled,
      };
    });
  },

  async bindPendingEnrollment(userId: string, input: PortableVaultBindInput) {
    assertEnabled();
    const row = await portableVaultBrokerRepository.bindPendingBrokerEnvelope({
      id: input.mappingId,
      userId,
      brokerEnvelopeId: input.brokerEnvelopeId,
      enrollmentRequestId: input.requestId,
    });
    if (!row) {
      throw new PortableVaultBrokerConflictError("Portable vault enrollment state changed");
    }
    return { bound: true as const };
  },

  async completeVerifiedReceipt(
    userId: string,
    result: {
      action: "enroll" | "unlock" | "revoke";
      requestId: string;
      credentialId: string;
      envelopeId: string;
    }
  ) {
    assertEnabled();
    if (result.action === "unlock") {
      const active = (await portableVaultBrokerRepository.listCurrentForUser(userId)).find(
        (row) =>
          row.state === "active" &&
          row.credentialId === result.credentialId &&
          row.brokerEnvelopeId === result.envelopeId
      );
      if (!active) {
        throw new PortableVaultBrokerConflictError("Portable vault mapping is not active");
      }
      return { completed: true as const };
    }

    return runInTransaction(async (tx) => {
      const row =
        result.action === "enroll"
          ? await portableVaultBrokerRepository.activateAfterReceipt(
              {
                userId,
                credentialId: result.credentialId,
                brokerEnvelopeId: result.envelopeId,
                enrollmentRequestId: result.requestId,
              },
              tx
            )
          : await portableVaultBrokerRepository.revokeAfterReceipt(
              {
                userId,
                credentialId: result.credentialId,
                brokerEnvelopeId: result.envelopeId,
              },
              tx
            );
      if (!row) {
        throw new PortableVaultBrokerConflictError(
          `Portable vault ${result.action} mapping could not be finalized`
        );
      }
      await auditRepository.record(
        result.action === "enroll" ? "portable_vault_enabled" : "portable_vault_revoked",
        userId,
        { method: "portable_passkey" },
        tx
      );
      return { completed: true as const };
    });
  },
};
