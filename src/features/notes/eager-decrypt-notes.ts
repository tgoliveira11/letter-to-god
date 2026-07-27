import { notesApi } from "@/lib/api-client/notes";
import { decryptNote } from "@/lib/crypto-client/notes";
import {
  getCurrentVaultSessionLease,
} from "@/lib/crypto-client/vault-session";
import { assertVaultSessionLeaseCurrent } from "@tgoliveira/vault-core/browser";
import { decryptVaultSettings } from "@/lib/crypto-client/vault-settings";
import { vaultApi } from "@/lib/api-client/vault";

const bodyCache = new Map<string, string>();

export function getCachedNoteBody(noteId: string): string | undefined {
  return bodyCache.get(noteId);
}

export function setCachedNoteBody(noteId: string, body: string): void {
  bodyCache.set(noteId, body);
}

export function clearNoteBodyCache(): void {
  bodyCache.clear();
}

export async function applyUnlockBehavior(userId: string): Promise<void> {
  const lease = getCurrentVaultSessionLease(userId);
  if (!lease) {
    clearNoteBodyCache();
    return;
  }

  const { encryptedVaultSettings } = await vaultApi.getSettings();
  assertVaultSessionLeaseCurrent(lease);
  const settings = encryptedVaultSettings
    ? await decryptVaultSettings(encryptedVaultSettings, userId, lease.vaultKey)
    : { unlockBehavior: "metadata_only" as const };
  assertVaultSessionLeaseCurrent(lease);

  if (settings.unlockBehavior !== "decrypt_all") {
    clearNoteBodyCache();
    return;
  }

  const notes = await notesApi.list();
  assertVaultSessionLeaseCurrent(lease);
  const decryptedBodies = await Promise.all(
    notes.map(async (note) => {
      const decrypted = await decryptNote(
        note.encryptedMetadata,
        note.encryptedBody,
        note.encryptedWrappedNoteKey,
        lease.vaultKey
      );
      return [note.id, decrypted.body] as const;
    })
  );
  assertVaultSessionLeaseCurrent(lease);
  clearNoteBodyCache();
  for (const [noteId, body] of decryptedBodies) setCachedNoteBody(noteId, body);
}
