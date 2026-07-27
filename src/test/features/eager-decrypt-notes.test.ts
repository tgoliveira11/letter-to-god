import {
  beginVaultOwnerOperation,
  lockVaultSession,
  unlockVaultSession,
} from "@/lib/crypto-client/vault-session";
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  applyUnlockBehavior,
  clearNoteBodyCache,
  getCachedNoteBody,
  setCachedNoteBody,
} from "@/features/notes/eager-decrypt-notes";import { generateUserVaultKey } from "@/lib/crypto-client/vault";
import { encryptNote } from "@/lib/crypto-client/notes";
import { encryptVaultSettings } from "@/lib/crypto-client/vault-settings";
import { USER_ID } from "@/test/helpers/fixtures";

const vaultApiMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

const notesApiMocks = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock("@/lib/api-client/vault", () => ({
  vaultApi: {
    getSettings: vaultApiMocks.getSettings,
  },
}));

vi.mock("@/lib/api-client/notes", () => ({
  notesApi: {
    list: notesApiMocks.list,
  },
}));

describe("eager decrypt unlock behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearNoteBodyCache();
  });

  it("does not cache bodies for metadata_only", async () => {
    const vaultKey = await generateUserVaultKey();
    await unlockVaultSession(vaultKey, "password", beginVaultOwnerOperation(USER_ID));

    const settings = await encryptVaultSettings(
      { setupVersion: 1, recoveryPhraseLength: 12, unlockBehavior: "metadata_only" },
      USER_ID,
      vaultKey
    );
    vaultApiMocks.getSettings.mockResolvedValue({ encryptedVaultSettings: settings });
    notesApiMocks.list.mockResolvedValue([]);

    await applyUnlockBehavior(USER_ID);
    expect(getCachedNoteBody("any")).toBeUndefined();
  });

  it("caches decrypted bodies for decrypt_all", async () => {
    const vaultKey = await generateUserVaultKey();
    await unlockVaultSession(vaultKey, "password", beginVaultOwnerOperation(USER_ID));
    const noteId = crypto.randomUUID();

    const payload = await encryptNote(USER_ID, noteId, { title: "T", body: "Secret body" });
    notesApiMocks.list.mockResolvedValue([
      { id: noteId, ...payload },
    ]);

    const settings = await encryptVaultSettings(
      { setupVersion: 1, recoveryPhraseLength: 12, unlockBehavior: "decrypt_all" },
      USER_ID,
      vaultKey
    );
    vaultApiMocks.getSettings.mockResolvedValue({ encryptedVaultSettings: settings });

    await applyUnlockBehavior(USER_ID);
    expect(getCachedNoteBody(noteId)).toBe("Secret body");
  });

  it("manual cache helpers work", () => {
    setCachedNoteBody("x", "body");
    expect(getCachedNoteBody("x")).toBe("body");
    clearNoteBodyCache();
    expect(getCachedNoteBody("x")).toBeUndefined();
  });
});
