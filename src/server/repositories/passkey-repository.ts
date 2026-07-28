import { sql } from "drizzle-orm";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { db, type DbClient } from "@/lib/db";
import { passkeyCredentials, webauthnChallenges } from "@/lib/db/schema";

export class ChallengeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChallengeValidationError";
  }
}

export const passkeyRepository = {
  async lockForVaultMutation(id: string, userId: string, client: DbClient = db) {
    await client.execute(sql`
      SELECT id
      FROM ${passkeyCredentials}
      WHERE ${passkeyCredentials.id} = ${id}
        AND ${passkeyCredentials.userId} = ${userId}
      FOR UPDATE
    `);
  },

  async createCredential(
    data: {
      userId: string;
      credentialId: string;
      publicKey: string;
      counter: string;
      transports?: string[] | null;
      friendlyName?: string | null;
      signInEnabled?: boolean;
      vaultUnlockEnabled?: boolean;
      prfSupported?: boolean | null;
      credentialDeviceType?: "singleDevice" | "multiDevice" | null;
      backupEligible?: boolean | null;
      credentialBackedUp?: boolean | null;
    },
    client: DbClient = db
  ) {
    const [cred] = await client
      .insert(passkeyCredentials)
      .values({
        userId: data.userId,
        credentialId: data.credentialId,
        publicKey: data.publicKey,
        counter: data.counter,
        transports: data.transports ?? null,
        friendlyName: data.friendlyName ?? null,
        signInEnabled: data.signInEnabled ?? true,
        vaultUnlockEnabled: data.vaultUnlockEnabled ?? false,
        prfSupported: data.prfSupported ?? null,
        credentialDeviceType: data.credentialDeviceType ?? null,
        backupEligible: data.backupEligible ?? null,
        credentialBackedUp: data.credentialBackedUp ?? null,
      })
      .returning();
    return cred;
  },

  async findByIdForUser(id: string, userId: string) {
    const [cred] = await db
      .select()
      .from(passkeyCredentials)
      .where(
        and(
          eq(passkeyCredentials.id, id),
          eq(passkeyCredentials.userId, userId),
          isNull(passkeyCredentials.revokedAt)
        )
      )
      .limit(1);
    return cred ?? null;
  },

  async updateCredentialFlags(
    id: string,
    userId: string,
    data: {
      vaultUnlockEnabled?: boolean;
      prfSupported?: boolean | null;
      friendlyName?: string | null;
      credentialDeviceType?: "singleDevice" | "multiDevice" | null;
      backupEligible?: boolean | null;
      credentialBackedUp?: boolean | null;
    },
    client: DbClient = db
  ) {
    const [cred] = await client
      .update(passkeyCredentials)
      .set(data)
      .where(
        and(
          eq(passkeyCredentials.id, id),
          eq(passkeyCredentials.userId, userId),
          isNull(passkeyCredentials.revokedAt)
        )
      )
      .returning();
    return cred ?? null;
  },

  async updateLastUsedAt(credentialId: string, client: DbClient = db) {
    await client
      .update(passkeyCredentials)
      .set({ lastUsedAt: new Date() })
      .where(eq(passkeyCredentials.credentialId, credentialId));
  },

  async findByCredentialId(credentialId: string) {
    const [cred] = await db
      .select()
      .from(passkeyCredentials)
      .where(
        and(eq(passkeyCredentials.credentialId, credentialId), isNull(passkeyCredentials.revokedAt))
      )
      .limit(1);
    return cred ?? null;
  },

  async findByUserId(userId: string, client: DbClient = db) {
    return client
      .select()
      .from(passkeyCredentials)
      .where(and(eq(passkeyCredentials.userId, userId), isNull(passkeyCredentials.revokedAt)));
  },

  async advanceCounter(
    credentialId: string,
    expectedCounter: string,
    nextCounter: string,
    expectedRevision: number,
    client: DbClient = db
  ): Promise<"advanced" | "conflict"> {
    const [updated] = await client
      .update(passkeyCredentials)
      .set({
        counter: nextCounter,
        counterRevision: sql`${passkeyCredentials.counterRevision} + 1`,
      })
      .where(
        and(
          eq(passkeyCredentials.credentialId, credentialId),
          eq(passkeyCredentials.counter, expectedCounter),
          eq(passkeyCredentials.counterRevision, expectedRevision),
          isNull(passkeyCredentials.revokedAt)
        )
      )
      .returning({ credentialId: passkeyCredentials.credentialId });

    return updated ? "advanced" : "conflict";
  },

  async revoke(id: string, userId: string, client: DbClient = db) {
    const [cred] = await client
      .update(passkeyCredentials)
      .set({ revokedAt: new Date() })
      .where(and(eq(passkeyCredentials.id, id), eq(passkeyCredentials.userId, userId)))
      .returning();
    return cred ?? null;
  },

  async revokeAllByUserId(userId: string, client: DbClient = db) {
    return client
      .update(passkeyCredentials)
      .set({ revokedAt: new Date() })
      .where(and(eq(passkeyCredentials.userId, userId), isNull(passkeyCredentials.revokedAt)))
      .returning({ id: passkeyCredentials.id });
  },

  async deleteExpiredChallenges(client: DbClient = db) {
    await client.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, new Date()));
  },

  async storeChallenge(
    data: {
      userId?: string;
      challenge: string;
      type: string;
      expiresAt: Date;
    },
    client: DbClient = db
  ) {
    await passkeyRepository.deleteExpiredChallenges(client);
    const [row] = await client
      .insert(webauthnChallenges)
      .values({
        userId: data.userId ?? null,
        challenge: data.challenge,
        type: data.type,
        expiresAt: data.expiresAt,
      })
      .returning();
    return row;
  },

  async consumeValidChallenge(
    challenge: string,
    type: string,
    expectedUserId?: string,
    client: DbClient = db
  ) {
    const now = new Date();
    const userCondition =
      expectedUserId === undefined
        ? sql`true`
        : eq(webauthnChallenges.userId, expectedUserId);

    const [row] = await client
      .delete(webauthnChallenges)
      .where(
        and(
          eq(webauthnChallenges.challenge, challenge),
          eq(webauthnChallenges.type, type),
          gt(webauthnChallenges.expiresAt, now),
          userCondition
        )
      )
      .returning();

    if (!row) {
      throw new ChallengeValidationError("Invalid or expired challenge");
    }

    return row;
  },
};
