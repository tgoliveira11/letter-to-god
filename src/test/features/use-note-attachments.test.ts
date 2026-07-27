/** @vitest-environment happy-dom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import {
  assertNoVaultPlaintextInDocument,
  SENTINEL_PRIVATE_NOTE,
} from "@tgoliveira/vault-core/testing";
import { useNoteAttachments } from "@/features/notes/use-note-attachments";
import { encryptedPayload, NOTE_ID } from "@/test/helpers/fixtures";
import { generateUserVaultKey } from "@/lib/crypto-client/vault";
import {
  beginVaultOwnerOperation,
  resetVaultSessionStoreForTests,
  unlockVaultSession,
} from "@/lib/crypto-client/vault-session";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  decryptAttachment: vi.fn(),
}));

const vaultLockMocks = vi.hoisted(() => ({
  triggerLock: null as (() => void) | null,
}));

vi.mock("@tgoliveira/vault-core/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tgoliveira/vault-core/react")>();
  return {
    ...actual,
    useOnVaultLocked: (handler: () => void) => {
      vaultLockMocks.triggerLock = handler;
      return actual.useOnVaultLocked(handler);
    },
  };
});

vi.mock("@/lib/api-client/note-attachments", () => ({
  noteAttachmentsApi: {
    list: mocks.list,
    create: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/crypto-client/note-attachments", () => ({
  decryptAttachment: mocks.decryptAttachment,
  encryptAttachment: vi.fn(),
}));

describe("useNoteAttachments", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetVaultSessionStoreForTests();
    await unlockVaultSession(
      await generateUserVaultKey(),
      "password",
      beginVaultOwnerOperation("user-1")
    );
  });

  it("does not re-fetch forever when the caller passes a new owner object every render", async () => {
    mocks.list.mockResolvedValue({ attachments: [] });
    const wrappedKey = encryptedPayload("note_key", NOTE_ID);

    // Mirrors how JSX callers pass `owner={{ kind: "note", id }}` inline —
    // a fresh object reference on every render.
    const { rerender } = renderHook(
      () =>
        useNoteAttachments({
          owner: { kind: "note", id: NOTE_ID },
          userId: "user-1",
          wrappedKey,
          enabled: true,
        }),
      { initialProps: {} }
    );

    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));

    for (let i = 0; i < 5; i++) {
      rerender({});
    }

    // Give any runaway effect loop a chance to fire before asserting it didn't.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.list).toHaveBeenCalledTimes(1);
  });

  it("does not re-fetch when wrappedKey is a new object reference with the same ciphertext", async () => {
    mocks.list.mockResolvedValue({ attachments: [] });
    const wrappedKey = encryptedPayload("note_key", NOTE_ID);

    const { rerender } = renderHook(
      ({ keyRef }: { keyRef: typeof wrappedKey }) =>
        useNoteAttachments({
          owner: { kind: "note", id: NOTE_ID },
          userId: "user-1",
          wrappedKey: keyRef,
          enabled: true,
        }),
      { initialProps: { keyRef: wrappedKey } }
    );

    await waitFor(() => expect(mocks.list.mock.calls.length).toBeGreaterThan(0));
    const callsBeforeRerender = mocks.list.mock.calls.length;

    rerender({ keyRef: { ...wrappedKey } });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocks.list.mock.calls.length).toBe(callsBeforeRerender);
  });

  it("clears decrypted attachment metadata when the vault locks", async () => {
    const attachmentId = "att-sentinel-1";
    mocks.list.mockResolvedValue({
      attachments: [
        {
          id: attachmentId,
          encryptedMetadata: encryptedPayload("meta", attachmentId),
          encryptedBlob: encryptedPayload("blob", attachmentId),
          blobEncryptionVersion: 1,
          ciphertextBytes: 16,
        },
      ],
    });
    mocks.decryptAttachment.mockResolvedValue({
      metadata: {
        filename: SENTINEL_PRIVATE_NOTE,
        mimeType: "text/plain",
        sizeBytes: 24,
      },
      bytes: new Uint8Array(),
    });

    const wrappedKey = encryptedPayload("note_key", NOTE_ID);
    const { result } = renderHook(() =>
      useNoteAttachments({
        owner: { kind: "note", id: NOTE_ID },
        userId: "user-1",
        wrappedKey,
        enabled: true,
      })
    );

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]?.metadata.filename).toBe(SENTINEL_PRIVATE_NOTE);

    vaultLockMocks.triggerLock?.();

    await waitFor(() => {
      expect(result.current.items).toEqual([]);
      expect(result.current.error).toBeNull();
    });
    expect(() => assertNoVaultPlaintextInDocument(document.body)).not.toThrow();
  });
});
