import {
  beginVaultOwnerOperation,
  lockVaultSession,
  unlockVaultSession,
} from "@/lib/crypto-client/vault-session";
/** @vitest-environment happy-dom */
import { describe, it, expect, vi, beforeEach } from "vitest";import { generateUserVaultKey } from "@/lib/crypto-client/vault";
import {
  clearUserNoteDrafts,
  deleteEncryptedNoteDraft,
  listEncryptedNoteDraftKeys,
  loadEncryptedNoteDraft,
  NEW_NOTE_DRAFT_KEY,
  resetNoteDraftDbForTests,
  saveEncryptedNoteDraft,
} from "@/lib/crypto-client/note-drafts";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const store = new Map<string, unknown>();

vi.mock("idb", () => ({
  openDB: vi.fn(async () => ({
    put: vi.fn(async (_name: string, value: { userId: string; draftKey: string }) => {
      store.set(`${value.userId}:${value.draftKey}`, value);
    }),
    get: vi.fn(async (_name: string, key: [string, string]) => store.get(`${key[0]}:${key[1]}`)),
    getAll: vi.fn(async () => Array.from(store.values())),
    delete: vi.fn(async (_name: string, key: [string, string]) => {
      store.delete(`${key[0]}:${key[1]}`);
    }),
    transaction: vi.fn(() => ({
      objectStore: () => ({
        getAll: async () => Array.from(store.values()),
        delete: async (key: [string, string]) => {
          store.delete(`${key[0]}:${key[1]}`);
        },
      }),
      done: Promise.resolve(),
    })),
  })),
}));

describe("encrypted note drafts", () => {
  beforeEach(async () => {
    store.clear();
    resetNoteDraftDbForTests();
    const key = await generateUserVaultKey();
    await unlockVaultSession(key, "password", beginVaultOwnerOperation(USER_ID));
  });

  it("stores and loads encrypted drafts", async () => {
    await saveEncryptedNoteDraft(USER_ID, NEW_NOTE_DRAFT_KEY, {
      title: "Secret title",
      body: "Secret body",
      categoryId: null,
      tagIds: [],
      answered: false,
      updatedAt: new Date().toISOString(),
    });

    const loaded = await loadEncryptedNoteDraft(USER_ID, NEW_NOTE_DRAFT_KEY);
    expect(loaded?.title).toBe("Secret title");
    expect(loaded?.body).toBe("Secret body");
  });

  it("deletes encrypted drafts", async () => {
    await saveEncryptedNoteDraft(USER_ID, NEW_NOTE_DRAFT_KEY, {
      title: "Draft",
      body: "Body",
      categoryId: null,
      tagIds: [],
      answered: false,
      updatedAt: new Date().toISOString(),
    });
    await deleteEncryptedNoteDraft(USER_ID, NEW_NOTE_DRAFT_KEY);
    expect(await loadEncryptedNoteDraft(USER_ID, NEW_NOTE_DRAFT_KEY)).toBeNull();
  });

  it("lists draft keys and clears user drafts", async () => {
    const otherUser = "00000000-0000-4000-8000-000000000002";
    const draft = {
      title: "Draft",
      body: "Body",
      categoryId: null,
      tagIds: [],
      answered: false,
      updatedAt: new Date().toISOString(),
    };
    await saveEncryptedNoteDraft(USER_ID, NEW_NOTE_DRAFT_KEY, draft);
    await saveEncryptedNoteDraft(USER_ID, "note-2", draft);
    const currentRecord = store.get(`${USER_ID}:${NEW_NOTE_DRAFT_KEY}`) as Record<string, unknown>;
    store.set(`${otherUser}:${NEW_NOTE_DRAFT_KEY}`, {
      ...currentRecord,
      userId: otherUser,
    });

    expect(await listEncryptedNoteDraftKeys(USER_ID)).toEqual(
      expect.arrayContaining([NEW_NOTE_DRAFT_KEY, "note-2"])
    );

    await clearUserNoteDrafts(USER_ID);
    expect(await listEncryptedNoteDraftKeys(USER_ID)).toEqual([]);
    expect(await listEncryptedNoteDraftKeys(otherUser)).toEqual([NEW_NOTE_DRAFT_KEY]);
  });

  it("no-ops when vault is locked", async () => {
    const { setSessionVaultKey } = await import("@/lib/crypto-client/vault");
    lockVaultSession();
    await saveEncryptedNoteDraft(USER_ID, NEW_NOTE_DRAFT_KEY, {
      title: "Draft",
      body: "Body",
      categoryId: null,
      tagIds: [],
      answered: false,
      updatedAt: new Date().toISOString(),
    });
    expect(await loadEncryptedNoteDraft(USER_ID, NEW_NOTE_DRAFT_KEY)).toBeNull();
  });
});
