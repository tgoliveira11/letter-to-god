import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db, type DbClient } from "@/lib/db";
import {
  passkeyCleanupEpochs,
  passkeyCredentials,
  vaultPortableBrokerEnvelopes,
} from "@/lib/db/schema";

export const portableVaultBrokerRepository = {
  async findCurrentByCredential(
    userId: string,
    passkeyCredentialId: string,
    client: DbClient = db
  ) {
    const [row] = await client
      .select()
      .from(vaultPortableBrokerEnvelopes)
      .where(
        and(
          eq(vaultPortableBrokerEnvelopes.userId, userId),
          eq(vaultPortableBrokerEnvelopes.passkeyCredentialId, passkeyCredentialId),
          inArray(vaultPortableBrokerEnvelopes.state, ["pending", "active"])
        )
      )
      .limit(1);
    return row ?? null;
  },

  async createPending(
    input: {
      userId: string;
      passkeyCredentialId: string;
      opaqueAadUserId: string;
      opaqueAadResourceId: string;
    },
    client: DbClient = db
  ) {
    const [row] = await client
      .insert(vaultPortableBrokerEnvelopes)
      .values(input)
      .returning();
    return row;
  },

  async bindPendingBrokerEnvelope(
    input: {
      id: string;
      userId: string;
      brokerEnvelopeId: string;
      enrollmentRequestId: string;
    },
    client: DbClient = db
  ) {
    const [row] = await client
      .update(vaultPortableBrokerEnvelopes)
      .set({
        brokerEnvelopeId: input.brokerEnvelopeId,
        enrollmentRequestId: input.enrollmentRequestId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vaultPortableBrokerEnvelopes.id, input.id),
          eq(vaultPortableBrokerEnvelopes.userId, input.userId),
          eq(vaultPortableBrokerEnvelopes.state, "pending"),
          or(
            isNull(vaultPortableBrokerEnvelopes.brokerEnvelopeId),
            eq(vaultPortableBrokerEnvelopes.brokerEnvelopeId, input.brokerEnvelopeId)
          )
        )
      )
      .returning();
    return row ?? null;
  },

  async activateAfterReceipt(
    input: {
      userId: string;
      credentialId: string;
      brokerEnvelopeId: string;
      enrollmentRequestId: string;
    },
    client: DbClient = db
  ) {
    const [row] = await client
      .update(vaultPortableBrokerEnvelopes)
      .set({
        state: "active",
        activatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(vaultPortableBrokerEnvelopes.userId, input.userId),
          eq(vaultPortableBrokerEnvelopes.state, "pending"),
          eq(vaultPortableBrokerEnvelopes.brokerEnvelopeId, input.brokerEnvelopeId),
          eq(vaultPortableBrokerEnvelopes.enrollmentRequestId, input.enrollmentRequestId),
          inArray(
            vaultPortableBrokerEnvelopes.passkeyCredentialId,
            client
              .select({ id: passkeyCredentials.id })
              .from(passkeyCredentials)
              .where(
                and(
                  eq(passkeyCredentials.userId, input.userId),
                  eq(passkeyCredentials.credentialId, input.credentialId),
                  isNull(passkeyCredentials.revokedAt)
                )
              )
          )
        )
      )
      .returning();
    return row ?? null;
  },

  async revokeAfterReceipt(
    input: { userId: string; credentialId: string; brokerEnvelopeId: string },
    client: DbClient = db
  ) {
    const [row] = await client
      .update(vaultPortableBrokerEnvelopes)
      .set({ state: "revoked", revokedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(vaultPortableBrokerEnvelopes.userId, input.userId),
          eq(vaultPortableBrokerEnvelopes.state, "active"),
          eq(vaultPortableBrokerEnvelopes.brokerEnvelopeId, input.brokerEnvelopeId),
          inArray(
            vaultPortableBrokerEnvelopes.passkeyCredentialId,
            client
              .select({ id: passkeyCredentials.id })
              .from(passkeyCredentials)
              .where(
                and(
                  eq(passkeyCredentials.userId, input.userId),
                  eq(passkeyCredentials.credentialId, input.credentialId)
                )
              )
          )
        )
      )
      .returning();
    return row ?? null;
  },

  async listCurrentForUser(userId: string, client: DbClient = db) {
    return client
      .select({
        id: vaultPortableBrokerEnvelopes.id,
        state: vaultPortableBrokerEnvelopes.state,
        brokerEnvelopeId: vaultPortableBrokerEnvelopes.brokerEnvelopeId,
        opaqueAadUserId: vaultPortableBrokerEnvelopes.opaqueAadUserId,
        opaqueAadResourceId: vaultPortableBrokerEnvelopes.opaqueAadResourceId,
        enrollmentRequestId: vaultPortableBrokerEnvelopes.enrollmentRequestId,
        createdAt: vaultPortableBrokerEnvelopes.createdAt,
        activatedAt: vaultPortableBrokerEnvelopes.activatedAt,
        credentialDbId: passkeyCredentials.id,
        credentialId: passkeyCredentials.credentialId,
        friendlyName: passkeyCredentials.friendlyName,
        signInEnabled: passkeyCredentials.signInEnabled,
      })
      .from(vaultPortableBrokerEnvelopes)
      .innerJoin(
        passkeyCredentials,
        eq(vaultPortableBrokerEnvelopes.passkeyCredentialId, passkeyCredentials.id)
      )
      .where(
        and(
          eq(vaultPortableBrokerEnvelopes.userId, userId),
          inArray(vaultPortableBrokerEnvelopes.state, ["pending", "active"]),
          isNull(passkeyCredentials.revokedAt)
        )
      )
      .orderBy(desc(vaultPortableBrokerEnvelopes.activatedAt), desc(vaultPortableBrokerEnvelopes.createdAt));
  },

  async findLatestCutoverEpoch(client: DbClient = db) {
    const [row] = await client
      .select()
      .from(passkeyCleanupEpochs)
      .orderBy(desc(passkeyCleanupEpochs.cutoffAt))
      .limit(1);
    return row ?? null;
  },
};
