import type { EncryptedPayload } from "@/lib/validation/encrypted-payload";
import { ENCRYPTION_VERSION } from "@/lib/validation/encrypted-payload";

export const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
export const LETTER_ID = "550e8400-e29b-41d4-a716-446655440001";
export const NOTE_ID = "550e8400-e29b-41d4-a716-446655440003";
export const DEVICE_ID = "660e8400-e29b-41d4-a716-446655440002";
export const VERSION_ID = "550e8400-e29b-41d4-a716-446655440004";
export const BOARD_ID = "550e8400-e29b-41d4-a716-446655440005";
export const KANBAN_VERSION_ID = "550e8400-e29b-41d4-a716-446655440006";
export const KANBAN_BOARD_ID = BOARD_ID;

export function encryptedPayload(
  field: EncryptedPayload["aad"]["field"] = "title",
  resourceId = LETTER_ID
): EncryptedPayload {
  return {
    version: ENCRYPTION_VERSION,
    alg: "AES-GCM",
    iv: "dGVzdC1pdg",
    ciphertext: "dGVzdC1jaXBoZXJ0ZXh0",
    aad: {
      userId: USER_ID,
      resourceId,
      field,
      ...(field === "vault_key" ? { context: "selahkeep:vault-envelope:v1" } : {}),
    },
  };
}

export function createLetterInput() {
  return {
    id: LETTER_ID,
    encryptedTitle: encryptedPayload("title"),
    encryptedBody: encryptedPayload("body"),
    encryptedLetterKey: encryptedPayload("letter_key"),
    encryptionVersion: ENCRYPTION_VERSION,
  };
}

export function createNoteInput() {
  return {
    id: NOTE_ID,
    encryptedMetadata: encryptedPayload("note_metadata", NOTE_ID),
    encryptedBody: encryptedPayload("note_body", NOTE_ID),
    encryptedWrappedNoteKey: encryptedPayload("note_key", NOTE_ID),
    bodyEncryptionVersion: ENCRYPTION_VERSION,
  };
}

export function createNoteVersionInput() {
  return {
    id: VERSION_ID,
    encryptedMetadata: encryptedPayload("note_version_metadata", VERSION_ID),
    encryptedBody: encryptedPayload("note_version_body", VERSION_ID),
    encryptedWrappedNoteKey: encryptedPayload("note_key", NOTE_ID),
    bodyEncryptionVersion: ENCRYPTION_VERSION,
  };
}

export function createKanbanBoardInput(noteId: string | null = NOTE_ID) {
  return {
    id: BOARD_ID,
    noteId,
    encryptedBoard: encryptedPayload("note_kanban_board", BOARD_ID),
    encryptedWrappedKey: encryptedPayload(noteId ? "note_key" : "note_kanban_key", noteId ?? BOARD_ID),
    boardEncryptionVersion: ENCRYPTION_VERSION,
  };
}

export function updateKanbanBoardInput() {
  const { noteId: _noteId, ...input } = createKanbanBoardInput();
  return input;
}

export function createKanbanVersionInput(noteId: string | null = NOTE_ID) {
  return {
    id: KANBAN_VERSION_ID,
    encryptedBoard: encryptedPayload("note_kanban_version", KANBAN_VERSION_ID),
    encryptedWrappedKey: encryptedPayload(noteId ? "note_key" : "note_kanban_key", noteId ?? BOARD_ID),
    boardEncryptionVersion: ENCRYPTION_VERSION,
  };
}
