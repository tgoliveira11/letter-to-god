import { and, eq } from "drizzle-orm";
import { db, type DbClient } from "@/lib/db";
import { passkeyCredentials, vaultPasskeyDeviceBindings } from "@/lib/db/schema";

export const vaultPasskeyDeviceBindingRepository = {
  async findByIdForUser(id: string, userId: string, client: DbClient = db) {
    const [row] = await client
      .select()
      .from(vaultPasskeyDeviceBindings)
      .where(and(eq(vaultPasskeyDeviceBindings.id, id), eq(vaultPasskeyDeviceBindings.userId, userId)))
      .limit(1);
    return row ?? null;
  },

  async findByPasskeyCredentialId(passkeyCredentialId: string, userId: string, client: DbClient = db) {
    return client
      .select()
      .from(vaultPasskeyDeviceBindings)
      .where(
        and(
          eq(vaultPasskeyDeviceBindings.passkeyCredentialId, passkeyCredentialId),
          eq(vaultPasskeyDeviceBindings.userId, userId)
        )
      );
  },

  async listByUserId(userId: string, client: DbClient = db) {
    return client
      .select({
        id: vaultPasskeyDeviceBindings.id,
        passkeyCredentialId: vaultPasskeyDeviceBindings.passkeyCredentialId,
        deviceLabel: vaultPasskeyDeviceBindings.deviceLabel,
        createdAt: vaultPasskeyDeviceBindings.createdAt,
        lastUsedAt: vaultPasskeyDeviceBindings.lastUsedAt,
        selectedEnvelopeVariantId: vaultPasskeyDeviceBindings.selectedEnvelopeVariantId,
        credentialId: passkeyCredentials.credentialId,
        friendlyName: passkeyCredentials.friendlyName,
      })
      .from(vaultPasskeyDeviceBindings)
      .innerJoin(
        passkeyCredentials,
        eq(vaultPasskeyDeviceBindings.passkeyCredentialId, passkeyCredentials.id)
      )
      .where(eq(vaultPasskeyDeviceBindings.userId, userId));
  },

  async bindPasskeyToDevice(
    userId: string,
    passkeyCredentialId: string,
    options: {
      deviceLabel?: string | null;
      existingBindingId?: string;
      selectedEnvelopeVariantId?: string | null;
    },
    client: DbClient = db
  ): Promise<{ bindingId: string }> {
    const label = options.deviceLabel?.trim() ? options.deviceLabel.trim().slice(0, 80) : null;

    if (options.existingBindingId) {
      const existing = await vaultPasskeyDeviceBindingRepository.findByIdForUser(
        options.existingBindingId,
        userId,
        client
      );
      if (existing) {
        const [updated] = await client
          .update(vaultPasskeyDeviceBindings)
          .set({
            passkeyCredentialId,
            selectedEnvelopeVariantId: options.selectedEnvelopeVariantId ?? null,
            deviceLabel: label,
            lastUsedAt: new Date(),
          })
          .where(
            and(
              eq(vaultPasskeyDeviceBindings.id, existing.id),
              eq(vaultPasskeyDeviceBindings.userId, userId)
            )
          )
          .returning({ id: vaultPasskeyDeviceBindings.id });
        if (updated) {
          return { bindingId: updated.id };
        }
      }
    }

    const [created] = await client
      .insert(vaultPasskeyDeviceBindings)
      .values({
        userId,
        passkeyCredentialId,
        selectedEnvelopeVariantId: options.selectedEnvelopeVariantId ?? null,
        deviceLabel: label,
        lastUsedAt: new Date(),
      })
      .returning({ id: vaultPasskeyDeviceBindings.id });

    return { bindingId: created.id };
  },

  async deleteAllByPasskeyCredentialId(
    passkeyCredentialId: string,
    userId: string,
    client: DbClient = db
  ): Promise<string[]> {
    const deleted = await client
      .delete(vaultPasskeyDeviceBindings)
      .where(
        and(
          eq(vaultPasskeyDeviceBindings.passkeyCredentialId, passkeyCredentialId),
          eq(vaultPasskeyDeviceBindings.userId, userId)
        )
      )
      .returning({ id: vaultPasskeyDeviceBindings.id });
    return deleted.map((binding) => binding.id);
  },

  async deleteByIdForUser(id: string, userId: string, client: DbClient = db): Promise<boolean> {
    const [deleted] = await client
      .delete(vaultPasskeyDeviceBindings)
      .where(
        and(
          eq(vaultPasskeyDeviceBindings.id, id),
          eq(vaultPasskeyDeviceBindings.userId, userId)
        )
      )
      .returning({ id: vaultPasskeyDeviceBindings.id });
    return Boolean(deleted);
  },

  async deleteAllByUserId(userId: string, client: DbClient = db) {
    return client
      .delete(vaultPasskeyDeviceBindings)
      .where(eq(vaultPasskeyDeviceBindings.userId, userId));
  },

  async touchLastUsedAt(id: string, userId: string, client: DbClient = db) {
    await client
      .update(vaultPasskeyDeviceBindings)
      .set({ lastUsedAt: new Date() })
      .where(
        and(eq(vaultPasskeyDeviceBindings.id, id), eq(vaultPasskeyDeviceBindings.userId, userId))
      );
  },
};
