"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOnVaultLocked } from "@tgoliveira/vault-core/react";
import { noteAttachmentsApi, type AttachmentOwnerRef } from "@/lib/api-client/note-attachments";
import {
  decryptAttachment,
  encryptAttachment,
  type AttachmentMetadataPlaintext,
  type EncryptedAttachmentPayload,
} from "@/lib/crypto-client/note-attachments";
import type { EncryptedPayload } from "@/lib/validation/encrypted-payload";
import {
  getMaxAttachmentSizeBytes,
  getMaxAttachmentsPerNote,
} from "@/lib/config/attachment-policy";
import { attachmentRejectionReason } from "@/lib/notes/attachment-file-types";
import { AsyncOwnershipController, isAsyncOwnershipCancellation } from "@/lib/application-state/async-ownership";
import { assertVaultAsyncOwnershipCurrent, captureVaultAsyncOwnership } from "@/lib/application-state/vault-async-ownership";

export interface AttachmentListItem {
  id: string;
  metadata: AttachmentMetadataPlaintext;
  uploading?: boolean;
  uploadProgress?: number;
  error?: string | null;
}

interface UseNoteAttachmentsOptions {
  owner: AttachmentOwnerRef | null;
  userId: string | null;
  wrappedKey: EncryptedPayload | null;
  enabled: boolean;
  onAttachmentsChange?: () => void;
  /**
   * When the owner holds attachments for more than one thing (e.g. a kanban
   * board's cards), restricts the visible list to these ids. Upload/delete
   * still operate against the shared owner.
   */
  filterIds?: string[] | null;
}

/** Stable identity for note/board wrapped keys — avoids reload loops when callers pass new object refs. */
function wrappedKeyFingerprint(key: EncryptedPayload | null): string | null {
  if (!key) return null;
  return `${key.version}:${key.iv}:${key.ciphertext}`;
}

export function useNoteAttachments({
  owner,
  userId,
  wrappedKey,
  enabled,
  onAttachmentsChange,
  filterIds,
}: UseNoteAttachmentsOptions) {
  // Callers often pass an inline object literal for `owner`, which is a new
  // reference every render — depend on its primitive fields instead so this
  // hook's callbacks/effects don't re-run (and re-fetch) on every render.
  const ownerKind = owner?.kind ?? null;
  const ownerId = owner?.id ?? null;
  const stableOwner = useMemo<AttachmentOwnerRef | null>(
    () => (ownerKind && ownerId ? { kind: ownerKind, id: ownerId } : null),
    [ownerKind, ownerId]
  );
  const wrappedKeyId = wrappedKeyFingerprint(wrappedKey);
  const stableWrappedKey = useMemo(
    () => wrappedKey,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fingerprint is the stable identity
    [wrappedKeyId]
  );

  const [allItems, setAllItems] = useState<AttachmentListItem[]>([]);
  const items = filterIds
    ? allItems.filter((item) => item.uploading || filterIds.includes(item.id))
    : allItems;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pendingRef = useRef<Map<string, File>>(new Map());
  const listInFlightRef = useRef<{ key: string; request: Promise<void> } | null>(null);
  const lastFailedLoadRef = useRef<{ key: string; at: number } | null>(null);
  const ownershipRef = useRef(new AsyncOwnershipController());

  const reload = useCallback(async () => {
    const key = stableWrappedKey;
    if (!stableOwner || !enabled || !key || !wrappedKeyId || !userId) {
      ownershipRef.current.invalidate();
      setAllItems([]);
      return;
    }

    const loadKey = `${userId}:${stableOwner.kind}:${stableOwner.id}:${wrappedKeyId}`;
    const recentFailure = lastFailedLoadRef.current;
    if (recentFailure?.key === loadKey && Date.now() - recentFailure.at < 5_000) {
      return;
    }

    if (listInFlightRef.current?.key === loadKey) {
      return listInFlightRef.current.request;
    }

    let ownership;
    try {
      ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `attachments:${stableOwner.kind}:${stableOwner.id}`,
        encryptedKeyFingerprint: wrappedKeyId,
      });
    } catch (cause) {
      // A lock/account transition can race the passive effect. It is a normal
      // cancellation state, not a load failure and never a reason to retain UI.
      if (isAsyncOwnershipCancellation(cause)) {
        ownershipRef.current.invalidate();
        setAllItems([]);
        setLoading(false);
        return;
      }
      throw cause;
    }

    const request = (async () => {
      setLoading(true);
      setError(null);
      try {
        const { attachments } = await noteAttachmentsApi.list(stableOwner);
        assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
        const decrypted = await Promise.all(
          attachments.map(async (record) => {
            const payload: EncryptedAttachmentPayload = {
              id: record.id,
              encryptedMetadata: record.encryptedMetadata,
              encryptedBlob: record.encryptedBlob,
              blobEncryptionVersion:
                record.blobEncryptionVersion as EncryptedAttachmentPayload["blobEncryptionVersion"],
              ciphertextBytes: record.ciphertextBytes,
            };
            const { metadata } = await decryptAttachment(payload, key);
            return { id: record.id, metadata };
          })
        );
        assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
        lastFailedLoadRef.current = null;
        setAllItems(decrypted);
      } catch (e) {
        if (!isAsyncOwnershipCancellation(e)) {
          lastFailedLoadRef.current = { key: loadKey, at: Date.now() };
          setError(e instanceof Error ? e.message : "Failed to load attachments");
          setAllItems([]);
        }
      } finally {
        if (ownershipRef.current.isCurrent(ownership.token)) setLoading(false);
      }
    })();

    listInFlightRef.current = { key: loadKey, request };
    try {
      await request;
    } finally {
      if (listInFlightRef.current?.request === request) {
        listInFlightRef.current = null;
      }
    }
  }, [stableOwner, enabled, wrappedKeyId, stableWrappedKey, userId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useOnVaultLocked(() => {
    ownershipRef.current.invalidate();
    setAllItems([]);
    setError(null);
    pendingRef.current.clear();
    listInFlightRef.current = null;
    lastFailedLoadRef.current = null;
  });

  const uploadFile = useCallback(
    async (file: File): Promise<string> => {
      const key = stableWrappedKey;
      if (!stableOwner || !userId || !key) {
        throw new Error("Save before adding attachments");
      }
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `attachment-upload:${stableOwner.kind}:${stableOwner.id}`,
        encryptedKeyFingerprint: wrappedKeyId,
      });

      const rejection = attachmentRejectionReason(file);
      if (rejection) throw new Error(rejection);

      const maxBytes = getMaxAttachmentSizeBytes();
      if (file.size > maxBytes) {
        throw new Error(`File exceeds ${Math.round(maxBytes / (1024 * 1024))} MB limit`);
      }

      if (allItems.length >= getMaxAttachmentsPerNote()) {
        throw new Error("Maximum attachments reached");
      }

      const tempId = crypto.randomUUID();
      pendingRef.current.set(tempId, file);
      setAllItems((current) => [
        ...current,
        {
          id: tempId,
          metadata: { filename: file.name, mimeType: file.type, sizeBytes: file.size },
          uploading: true,
          uploadProgress: 0,
        },
      ]);

      try {
        const encrypted = await encryptAttachment(userId, tempId, file, key);
        assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
        setAllItems((current) =>
          current.map((item) =>
            item.id === tempId ? { ...item, uploadProgress: 80 } : item
          )
        );
        await noteAttachmentsApi.create(stableOwner, encrypted);
        assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
        pendingRef.current.delete(tempId);
        onAttachmentsChange?.();
        lastFailedLoadRef.current = null;
        await reload();
        return tempId;
      } catch (e) {
        if (isAsyncOwnershipCancellation(e)) throw e;
        pendingRef.current.delete(tempId);
        const message = e instanceof Error ? e.message : "Upload failed";
        setAllItems((current) => current.filter((item) => item.id !== tempId));
        throw new Error(message);
      }
    },
    [allItems.length, stableOwner, onAttachmentsChange, reload, userId, stableWrappedKey, wrappedKeyId]
  );

  const removeAttachment = useCallback(
    async (attachmentId: string) => {
      if (!stableOwner || !userId) return;
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `attachment-delete:${stableOwner.kind}:${stableOwner.id}:${attachmentId}`,
        encryptedKeyFingerprint: wrappedKeyId,
      });
      await noteAttachmentsApi.delete(stableOwner, attachmentId);
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      onAttachmentsChange?.();
      lastFailedLoadRef.current = null;
      await reload();
    },
    [stableOwner, onAttachmentsChange, reload, userId, wrappedKeyId]
  );

  const getDecryptedAttachment = useCallback(
    async (attachmentId: string) => {
      const key = stableWrappedKey;
      if (!stableOwner || !key || !userId) {
        throw new Error("Vault must be unlocked to preview attachments");
      }
      const ownership = captureVaultAsyncOwnership(ownershipRef.current, {
        ownerId: userId,
        resourceId: `attachment:${stableOwner.kind}:${stableOwner.id}:${attachmentId}`,
        encryptedKeyFingerprint: wrappedKeyId,
      });
      const record = await noteAttachmentsApi.get(stableOwner, attachmentId);
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      const payload: EncryptedAttachmentPayload = {
        id: record.id,
        encryptedMetadata: record.encryptedMetadata,
        encryptedBlob: record.encryptedBlob,
        blobEncryptionVersion:
          record.blobEncryptionVersion as EncryptedAttachmentPayload["blobEncryptionVersion"],
        ciphertextBytes: record.ciphertextBytes,
      };
      const decrypted = await decryptAttachment(payload, key);
      assertVaultAsyncOwnershipCurrent(ownershipRef.current, ownership);
      return decrypted;
    },
    [stableOwner, stableWrappedKey, userId, wrappedKeyId]
  );

  const downloadAttachment = useCallback(
    async (attachmentId: string) => {
      const { metadata, bytes } = await getDecryptedAttachment(attachmentId);
      const blob = new Blob([new Uint8Array(bytes)], { type: metadata.mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = metadata.filename;
      anchor.click();
      URL.revokeObjectURL(url);
    },
    [getDecryptedAttachment]
  );

  const getPendingFile = useCallback((attachmentId: string) => {
    return pendingRef.current.get(attachmentId) ?? null;
  }, []);

  return {
    items,
    loading,
    error,
    uploadFile,
    removeAttachment,
    downloadAttachment,
    getDecryptedAttachment,
    getPendingFile,
    reload,
    canUpload: Boolean(stableOwner && userId && stableWrappedKey),
  };
}
