import { openDB, type IDBPDatabase } from "idb";
import { encryptField, decryptField } from "./aes-gcm";
import { verifyPayloadAad, ClientAadMismatchError } from "./aad-verify";
import { getSessionVaultKey } from "./vault";
import type { EncryptedPayload } from "@/lib/validation/encrypted-payload";
import { AsyncOwnershipController } from "@/lib/application-state/async-ownership";
import { assertVaultAsyncOwnershipCurrent, captureVaultAsyncOwnership } from "@/lib/application-state/vault-async-ownership";

const DB_NAME = "letters-vault";
const DB_VERSION = 4;
const DRAFT_STORE = "encrypted_note_drafts";

export const NEW_NOTE_DRAFT_KEY = "new";

export interface NoteDraftPlaintext {
  title: string;
  body: string;
  categoryId: string | null;
  tagIds: string[];
  answered: boolean;
  updatedAt: string;
}

interface DraftRecord {
  userId: string;
  draftKey: string;
  payload: EncryptedPayload;
  updatedAt: string;
}

let dbPromise: Promise<IDBPDatabase> | null = null;
const ownershipByDraft = new Map<string, AsyncOwnershipController>();

function draftOwnership(userId: string, draftKey: string): AsyncOwnershipController {
  const key = `${userId}:${draftKey}`;
  let controller = ownershipByDraft.get(key);
  if (!controller) {
    controller = new AsyncOwnershipController();
    ownershipByDraft.set(key, controller);
  }
  return controller;
}

/** @internal Test helper */
export function resetNoteDraftDbForTests(): void {
  dbPromise = null;
  ownershipByDraft.clear();
}

function openDraftDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 3) {
          for (const name of [...db.objectStoreNames]) {
            if (name === "device_secrets" || name === "vault_envelopes") {
              db.deleteObjectStore(name);
            }
          }
        }
        if (!db.objectStoreNames.contains(DRAFT_STORE)) {
          db.createObjectStore(DRAFT_STORE, { keyPath: ["userId", "draftKey"] });
        }
      },
    });
  }
  return dbPromise;
}

function draftResourceId(userId: string, draftKey: string): string {
  return draftKey === NEW_NOTE_DRAFT_KEY ? userId : draftKey;
}

export async function saveEncryptedNoteDraft(
  userId: string,
  draftKey: string,
  draft: NoteDraftPlaintext
): Promise<void> {
  const vaultKey = getSessionVaultKey();
  if (!vaultKey) return;
  const controller = draftOwnership(userId, draftKey);
  const ownership = captureVaultAsyncOwnership(controller, {
    ownerId: userId,
    resourceId: `note-draft:${draftKey}`,
  });

  const payload = await encryptField(JSON.stringify(draft), ownership.lease.vaultKey, {
    userId,
    resourceId: draftResourceId(userId, draftKey),
    field: "note_draft",
  });
  assertVaultAsyncOwnershipCurrent(controller, ownership);

  const db = await openDraftDb();
  assertVaultAsyncOwnershipCurrent(controller, ownership);
  const record: DraftRecord = {
    userId,
    draftKey,
    payload,
    updatedAt: draft.updatedAt,
  };
  await db.put(DRAFT_STORE, record);
  assertVaultAsyncOwnershipCurrent(controller, ownership);
}

export async function loadEncryptedNoteDraft(
  userId: string,
  draftKey: string
): Promise<NoteDraftPlaintext | null> {
  const vaultKey = getSessionVaultKey();
  if (!vaultKey) return null;
  const controller = draftOwnership(userId, draftKey);
  const ownership = captureVaultAsyncOwnership(controller, {
    ownerId: userId,
    resourceId: `note-draft:${draftKey}`,
  });

  const db = await openDraftDb();
  assertVaultAsyncOwnershipCurrent(controller, ownership);
  const record = (await db.get(DRAFT_STORE, [userId, draftKey])) as DraftRecord | undefined;
  assertVaultAsyncOwnershipCurrent(controller, ownership);
  if (!record?.payload) return null;
  if (record.userId !== userId) {
    throw new ClientAadMismatchError("Encrypted draft user binding mismatch");
  }

  verifyPayloadAad(record.payload, {
    userId,
    resourceId: draftResourceId(userId, draftKey),
    field: "note_draft",
  });

  const json = await decryptField(record.payload, ownership.lease.vaultKey);
  assertVaultAsyncOwnershipCurrent(controller, ownership);
  return JSON.parse(json) as NoteDraftPlaintext;
}

export async function listEncryptedNoteDraftKeys(userId: string): Promise<string[]> {
  const db = await openDraftDb();
  const all = (await db.getAll(DRAFT_STORE)) as DraftRecord[];
  return all.filter((record) => record.userId === userId).map((record) => record.draftKey);
}

export async function deleteEncryptedNoteDraft(userId: string, draftKey: string): Promise<void> {
  const db = await openDraftDb();
  await db.delete(DRAFT_STORE, [userId, draftKey]);
}

export async function clearUserNoteDrafts(userId: string): Promise<void> {
  const db = await openDraftDb();
  const tx = db.transaction(DRAFT_STORE, "readwrite");
  const store = tx.objectStore(DRAFT_STORE);
  const all = await store.getAll();
  for (const record of all as DraftRecord[]) {
    if (record.userId === userId) {
      await store.delete([userId, record.draftKey]);
    }
  }
  await tx.done;
}
