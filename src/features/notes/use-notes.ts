"use client";

import { useCallback, useRef, useState } from "react";
import { notesApi } from "@/lib/api-client/notes";
import { noteVersionsApi } from "@/lib/api-client/note-versions";
import { vaultApi } from "@/lib/api-client/vault";
import {
  decryptNote,
  encryptNote,
  reencryptNoteWithUpdatedMetadata,
  type EncryptNoteInput,
  type NoteMetadataPlaintext,
} from "@/lib/crypto-client/notes";
import { encryptNoteVersion } from "@/lib/crypto-client/note-versions";
import { normalizeNoteMetadata } from "@/lib/notes/note-metadata";
import {
  addVaultIndexEntry,
  createEmptyVaultIndex,
  decryptVaultIndex,
  encryptVaultIndex,
  removeVaultIndexEntry,
  restoreVaultIndexEntry,
  updateVaultIndexEntry,
} from "@/lib/crypto-client/vault-index";
import { generateDefaultNoteTitle } from "@/lib/crypto-client/vault";
import {
  duplicateNoteMetadata,
  metadataToIndexEntry,
} from "@/lib/notes/note-metadata";
import {
  appendLifecycleEvent,
  applyNoteReopened,
  applyNoteResolved,
  buildResolvedReflection,
  type ResolvedReflection,
} from "@/lib/notes/note-lifecycle";
import { countChecklistItems } from "@/lib/notes/markdown-checklist";
import { AsyncOwnershipController, isAsyncOwnershipCancellation } from "@/lib/application-state/async-ownership";
import { assertVaultAsyncOwnershipCurrent, captureVaultAsyncOwnership } from "@/lib/application-state/vault-async-ownership";

type AssertCurrent = () => void;

async function syncVaultIndex(
  userId: string,
  mutate: (index: ReturnType<typeof createEmptyVaultIndex>) => ReturnType<typeof createEmptyVaultIndex>,
  assertCurrent: AssertCurrent = () => undefined,
  vaultKey?: CryptoKey
) {
  if (!vaultKey) throw new Error("Vault is locked");

  const { encryptedVaultIndex } = await vaultApi.getIndex();
  assertCurrent();
  const current = encryptedVaultIndex
    ? await decryptVaultIndex(encryptedVaultIndex, userId, vaultKey)
    : createEmptyVaultIndex();
  assertCurrent();

  const next = mutate(current);
  const encrypted = await encryptVaultIndex(next, userId, vaultKey);
  assertCurrent();
  await vaultApi.updateIndex(encrypted);
  assertCurrent();
}

/**
 * Append an immutable encrypted version snapshot of a note's content.
 *
 * History is additive and best-effort: a failure here must never fail the
 * primary note save, so the caller swallows errors. The snapshot is encrypted
 * client-side under the note's existing Note Key (see
 * `docs/TDR_Note_Version_History.md`). Returns true when the version persisted.
 */
async function appendNoteVersionSnapshot(
  userId: string,
  noteId: string,
  metadata: NoteMetadataPlaintext,
  body: string,
  wrappedKey: import("@/lib/validation/encrypted-payload").EncryptedPayload,
  assertCurrent: AssertCurrent = () => undefined
): Promise<boolean> {
  try {
    const versionId = crypto.randomUUID();
    const payload = await encryptNoteVersion(
      userId,
      noteId,
      versionId,
      normalizeNoteMetadata(metadata),
      body,
      wrappedKey
    );
    assertCurrent();
    await noteVersionsApi.create(noteId, payload);
    assertCurrent();
    return true;
  } catch (error) {
    if (isAsyncOwnershipCancellation(error)) throw error;
    // History is additive; never block or surface the primary save.
    return false;
  }
}

async function loadNoteForUpdate(noteId: string, assertCurrent: AssertCurrent = () => undefined) {
  const note = await notesApi.get(noteId);
  assertCurrent();
  const decrypted = await decryptNote(
    note.encryptedMetadata,
    note.encryptedBody,
    note.encryptedWrappedNoteKey
  );
  assertCurrent();
  return { note, decrypted };
}

async function persistMetadataUpdate(
  userId: string,
  noteId: string,
  metadata: NoteMetadataPlaintext,
  body: string,
  wrappedKey: import("@/lib/validation/encrypted-payload").EncryptedPayload,
  options?: { appendUpdatedEvent?: boolean; assertCurrent?: AssertCurrent; vaultKey?: CryptoKey }
) {
  const now = new Date().toISOString();
  let updatedMetadata = { ...metadata, updatedAt: now };
  if (options?.appendUpdatedEvent) {
    updatedMetadata = {
      ...updatedMetadata,
      lifecycleEvents: appendLifecycleEvent(updatedMetadata.lifecycleEvents, "updated", now),
    };
  }
  const payload = await reencryptNoteWithUpdatedMetadata(
    userId,
    noteId,
    updatedMetadata,
    body,
    wrappedKey
  );
  options?.assertCurrent?.();
  const note = await notesApi.update(noteId, payload);
  options?.assertCurrent?.();

  await syncVaultIndex(
    userId,
    (index) =>
      updateVaultIndexEntry(
        index,
        noteId,
        metadataToIndexEntry(noteId, updatedMetadata, body)
      ),
    options?.assertCurrent,
    options?.vaultKey
  );

  return { metadata: updatedMetadata, note };
}

export function useNotes(userId: string | null) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ownershipRef = useRef(new AsyncOwnershipController());

  const createNote = useCallback(
    async (input: Omit<EncryptNoteInput, "title"> & { title?: string }) => {
      if (!userId) throw new Error("Not authenticated");
      const noteId = crypto.randomUUID();
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `note:${noteId}`,
      });
      const assertCurrent = () =>
        assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setBusy(true);
      setError(null);
      try {
        const title = input.title?.trim() || generateDefaultNoteTitle();
        const payload = await encryptNote(userId, noteId, { ...input, title });
        assertCurrent();
        const note = await notesApi.create({ id: noteId, ...payload });
        assertCurrent();

        await appendNoteVersionSnapshot(
          userId,
          noteId,
          normalizeNoteMetadata({
            title,
            categoryId: input.categoryId ?? null,
            tagIds: input.tagIds ?? [],
            answered: input.answered ?? false,
            pinned: input.pinned ?? false,
            favorite: input.favorite ?? false,
            archived: input.archived ?? false,
            trashed: input.trashed ?? false,
            trashedAt: input.trashedAt ?? null,
            createdAt: note.createdAt,
            updatedAt: note.updatedAt,
          }),
          input.body,
          payload.encryptedWrappedNoteKey,
          assertCurrent
        );

        await syncVaultIndex(
          userId,
          (index) =>
            addVaultIndexEntry(
              index,
              metadataToIndexEntry(noteId, {
              title,
              categoryId: input.categoryId ?? null,
              tagIds: input.tagIds ?? [],
              answered: input.answered ?? false,
              pinned: input.pinned ?? false,
              favorite: input.favorite ?? false,
              archived: input.archived ?? false,
              trashed: input.trashed ?? false,
              trashedAt: input.trashedAt ?? null,
              createdAt: note.createdAt,
              updatedAt: note.updatedAt,
              }, input.body)
            ),
          assertCurrent,
          ownership.lease.vaultKey
        );

        return { ...note, encryptedWrappedNoteKey: payload.encryptedWrappedNoteKey };
      } catch (e) {
        if (!isAsyncOwnershipCancellation(e)) {
          const message = e instanceof Error ? e.message : "Failed to create note";
          setError(message);
        }
        throw e;
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) setBusy(false);
      }
    },
    [userId]
  );

  const updateNote = useCallback(
    async (
      noteId: string,
      metadata: NoteMetadataPlaintext,
      body: string,
      existingWrappedKey: import("@/lib/validation/encrypted-payload").EncryptedPayload
    ) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `note:${noteId}`,
        encryptedKeyFingerprint: `${existingWrappedKey.version}:${existingWrappedKey.iv}:${existingWrappedKey.ciphertext}`,
      });
      const assertCurrent = () =>
        assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setBusy(true);
      setError(null);
      try {
        const result = await persistMetadataUpdate(userId, noteId, metadata, body, existingWrappedKey, {
          appendUpdatedEvent: true,
          assertCurrent,
          vaultKey: ownership.lease.vaultKey,
        });
        await appendNoteVersionSnapshot(
          userId,
          noteId,
          result.metadata,
          body,
          existingWrappedKey,
          assertCurrent
        );
        return result.note;
      } catch (e) {
        if (!isAsyncOwnershipCancellation(e)) {
          const message = e instanceof Error ? e.message : "Failed to update note";
          setError(message);
        }
        throw e;
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) setBusy(false);
      }
    },
    [userId]
  );

  const moveNoteToTrash = useCallback(
    async (noteId: string) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `note:${noteId}`,
      });
      const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setBusy(true);
      setError(null);
      try {
        const { decrypted, note } = await loadNoteForUpdate(noteId, assertCurrent);
        const now = new Date().toISOString();
        const updatedMetadata: NoteMetadataPlaintext = {
          ...decrypted.metadata,
          trashed: true,
          trashedAt: now,
          pinned: false,
          updatedAt: now,
          lifecycleEvents: appendLifecycleEvent(decrypted.metadata.lifecycleEvents, "trashed", now),
        };
        const result = await persistMetadataUpdate(
          userId,
          noteId,
          updatedMetadata,
          decrypted.body,
          note.encryptedWrappedNoteKey,
          { assertCurrent, vaultKey: ownership.lease.vaultKey }
        );
        return result.metadata;
      } catch (e) {
        if (!isAsyncOwnershipCancellation(e)) {
          setError(e instanceof Error ? e.message : "Failed to move note to trash");
        }
        throw e;
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) setBusy(false);
      }
    },
    [userId]
  );

  const restoreNoteFromTrash = useCallback(
    async (noteId: string) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `note:${noteId}`,
      });
      const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setBusy(true);
      setError(null);
      try {
        const { decrypted, note } = await loadNoteForUpdate(noteId, assertCurrent);
        const now = new Date().toISOString();
        const updatedMetadata: NoteMetadataPlaintext = {
          ...decrypted.metadata,
          trashed: false,
          trashedAt: null,
          lifecycleEvents: appendLifecycleEvent(decrypted.metadata.lifecycleEvents, "restored", now),
          updatedAt: now,
        };
        const result = await persistMetadataUpdate(
          userId,
          noteId,
          updatedMetadata,
          decrypted.body,
          note.encryptedWrappedNoteKey,
          { assertCurrent, vaultKey: ownership.lease.vaultKey }
        );
        await syncVaultIndex(
          userId,
          (index) => restoreVaultIndexEntry(index, noteId),
          assertCurrent,
          ownership.lease.vaultKey
        );
        return result.metadata;
      } catch (e) {
        if (!isAsyncOwnershipCancellation(e)) {
          setError(e instanceof Error ? e.message : "Failed to restore note");
        }
        throw e;
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) setBusy(false);
      }
    },
    [userId]
  );

  const permanentlyDeleteNote = useCallback(
    async (noteId: string) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `note:${noteId}`,
      });
      const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setBusy(true);
      setError(null);
      try {
        await notesApi.delete(noteId);
        assertCurrent();
        await syncVaultIndex(
          userId,
          (index) => removeVaultIndexEntry(index, noteId),
          assertCurrent,
          ownership.lease.vaultKey
        );
        return { success: true as const };
      } catch (e) {
        if (!isAsyncOwnershipCancellation(e)) {
          setError(e instanceof Error ? e.message : "Failed to delete note");
        }
        throw e;
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) setBusy(false);
      }
    },
    [userId]
  );

  /** @deprecated Use moveNoteToTrash */
  const deleteNote = moveNoteToTrash;

  const toggleNoteResolved = useCallback(
    async (noteId: string, answered: boolean) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `note:${noteId}`,
      });
      const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setBusy(true);
      setError(null);
      try {
        const { decrypted, note } = await loadNoteForUpdate(noteId, assertCurrent);
        const updatedMetadata = answered
          ? applyNoteResolved(decrypted.metadata, decrypted.metadata.resolvedReflection)
          : applyNoteReopened(decrypted.metadata);
        const result = await persistMetadataUpdate(
          userId,
          noteId,
          updatedMetadata,
          decrypted.body,
          note.encryptedWrappedNoteKey,
          { assertCurrent, vaultKey: ownership.lease.vaultKey }
        );
        return result.metadata;
      } catch (e) {
        if (!isAsyncOwnershipCancellation(e)) {
          setError(e instanceof Error ? e.message : "Failed to update note");
        }
        throw e;
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) setBusy(false);
      }
    },
    [userId]
  );

  const resolveNoteWithReflection = useCallback(
    async (
      noteId: string,
      reflectionFields?: {
        whatChanged?: string;
        howResolved?: string;
        whatToRemember?: string;
      } | null
    ) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `note:${noteId}`,
      });
      const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setBusy(true);
      setError(null);
      try {
        const { decrypted, note } = await loadNoteForUpdate(noteId, assertCurrent);
        const reflection: ResolvedReflection | null = reflectionFields
          ? buildResolvedReflection(reflectionFields)
          : null;
        const updatedMetadata = applyNoteResolved(decrypted.metadata, reflection);
        const result = await persistMetadataUpdate(
          userId,
          noteId,
          updatedMetadata,
          decrypted.body,
          note.encryptedWrappedNoteKey,
          { assertCurrent, vaultKey: ownership.lease.vaultKey }
        );
        return result.metadata;
      } catch (e) {
        if (!isAsyncOwnershipCancellation(e)) {
          setError(e instanceof Error ? e.message : "Failed to resolve note");
        }
        throw e;
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) setBusy(false);
      }
    },
    [userId]
  );

  const toggleNotePinned = useCallback(
    async (noteId: string, pinned: boolean) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `note:${noteId}`,
      });
      const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setBusy(true);
      setError(null);
      try {
        const { decrypted, note } = await loadNoteForUpdate(noteId, assertCurrent);
        const updatedMetadata = { ...decrypted.metadata, pinned };
        const result = await persistMetadataUpdate(
          userId,
          noteId,
          updatedMetadata,
          decrypted.body,
          note.encryptedWrappedNoteKey,
          { assertCurrent, vaultKey: ownership.lease.vaultKey }
        );
        return result.metadata;
      } catch (e) {
        if (!isAsyncOwnershipCancellation(e)) {
          setError(e instanceof Error ? e.message : "Failed to update note");
        }
        throw e;
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) setBusy(false);
      }
    },
    [userId]
  );

  const toggleNoteFavorite = useCallback(
    async (noteId: string, favorite: boolean) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `note:${noteId}`,
      });
      const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setBusy(true);
      setError(null);
      try {
        const { decrypted, note } = await loadNoteForUpdate(noteId, assertCurrent);
        const updatedMetadata = { ...decrypted.metadata, favorite };
        const result = await persistMetadataUpdate(
          userId,
          noteId,
          updatedMetadata,
          decrypted.body,
          note.encryptedWrappedNoteKey,
          { assertCurrent, vaultKey: ownership.lease.vaultKey }
        );
        return result.metadata;
      } catch (e) {
        if (!isAsyncOwnershipCancellation(e)) {
          setError(e instanceof Error ? e.message : "Failed to update note");
        }
        throw e;
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) setBusy(false);
      }
    },
    [userId]
  );

  const toggleNoteArchived = useCallback(
    async (noteId: string, archived: boolean) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `note:${noteId}`,
      });
      const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setBusy(true);
      setError(null);
      try {
        const { decrypted, note } = await loadNoteForUpdate(noteId, assertCurrent);
        const updatedMetadata = {
          ...decrypted.metadata,
          archived,
          pinned: archived ? false : decrypted.metadata.pinned,
          lifecycleEvents: appendLifecycleEvent(
            decrypted.metadata.lifecycleEvents,
            archived ? "archived" : "unarchived"
          ),
        };
        const result = await persistMetadataUpdate(
          userId,
          noteId,
          updatedMetadata,
          decrypted.body,
          note.encryptedWrappedNoteKey,
          { assertCurrent, vaultKey: ownership.lease.vaultKey }
        );
        return result.metadata;
      } catch (e) {
        if (!isAsyncOwnershipCancellation(e)) {
          setError(e instanceof Error ? e.message : "Failed to update note");
        }
        throw e;
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) setBusy(false);
      }
    },
    [userId]
  );

  const duplicateNote = useCallback(
    async (noteId: string) => {
      if (!userId) throw new Error("Not authenticated");
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `note:${noteId}:duplicate`,
      });
      const assertCurrent = () => assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      setBusy(true);
      setError(null);
      try {
        const { decrypted } = await loadNoteForUpdate(noteId, assertCurrent);
        const newNoteId = crypto.randomUUID();
        const now = new Date().toISOString();
        const metadata = duplicateNoteMetadata(decrypted.metadata, decrypted.body, now, now);
        const payload = await encryptNote(userId, newNoteId, {
          title: metadata.title,
          body: decrypted.body,
          categoryId: metadata.categoryId,
          tagIds: metadata.tagIds,
          answered: metadata.answered,
          pinned: metadata.pinned,
          favorite: metadata.favorite,
          archived: metadata.archived,
          trashed: metadata.trashed,
          trashedAt: metadata.trashedAt,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
        });
        assertCurrent();
        const note = await notesApi.create({ id: newNoteId, ...payload });
        assertCurrent();

        await syncVaultIndex(
          userId,
          (index) =>
            addVaultIndexEntry(
              index,
              metadataToIndexEntry(newNoteId, metadata, decrypted.body)
            ),
          assertCurrent,
          ownership.lease.vaultKey
        );

        return { noteId: newNoteId, note };
      } catch (e) {
        if (!isAsyncOwnershipCancellation(e)) {
          setError(e instanceof Error ? e.message : "Failed to duplicate note");
        }
        throw e;
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) setBusy(false);
      }
    },
    [userId]
  );

  return {
    createNote,
    updateNote,
    deleteNote,
    moveNoteToTrash,
    restoreNoteFromTrash,
    permanentlyDeleteNote,
    toggleNoteResolved,
    resolveNoteWithReflection,
    toggleNotePinned,
    toggleNoteFavorite,
    toggleNoteArchived,
    duplicateNote,
    busy,
    error,
  };
}
