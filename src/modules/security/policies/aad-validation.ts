import type { EncryptedPayload } from "@/lib/validation/encrypted-payload";
import type { CreateNoteInput, UpdateNoteInput } from "@/lib/validation/notes";
import type { CreateNoteVersionInput } from "@/lib/validation/note-versions";
import type { CreateAttachmentInput } from "@/lib/validation/note-attachments";
import type {
  CreateKanbanBoardInput,
  CreateKanbanVersionInput,
  UpdateKanbanBoardInput,
} from "@/lib/validation/kanban";

export class AadValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AadValidationError";
  }
}

type AadField = EncryptedPayload["aad"]["field"];

export function assertPayloadAad(
  payload: EncryptedPayload,
  expected: { userId: string; resourceId: string; field: AadField }
): void {
  if (payload.aad.userId !== expected.userId) {
    throw new AadValidationError("AAD userId does not match authenticated user");
  }
  if (payload.aad.resourceId !== expected.resourceId) {
    throw new AadValidationError("AAD resourceId does not match resource");
  }
  if (payload.aad.field !== expected.field) {
    throw new AadValidationError("AAD field does not match expected field");
  }
}

export function assertVaultKeyAad(
  userId: string,
  payload: EncryptedPayload,
  expectedContext: string
): void {
  assertPayloadAad(payload, { userId, resourceId: userId, field: "vault_key" });
  if (payload.aad.context !== expectedContext) {
    throw new AadValidationError("AAD context does not match the canonical vault envelope context");
  }
}

export function assertVaultSettingsAad(userId: string, payload: EncryptedPayload): void {
  assertPayloadAad(payload, { userId, resourceId: userId, field: "vault_settings" });
}

export function assertVaultIndexAad(userId: string, payload: EncryptedPayload): void {
  assertPayloadAad(payload, { userId, resourceId: userId, field: "vault_index" });
}

export function assertNoteCreateAad(userId: string, noteId: string, input: CreateNoteInput): void {
  assertPayloadAad(input.encryptedMetadata, { userId, resourceId: noteId, field: "note_metadata" });
  assertPayloadAad(input.encryptedBody, { userId, resourceId: noteId, field: "note_body" });
  assertPayloadAad(input.encryptedWrappedNoteKey, { userId, resourceId: noteId, field: "note_key" });
}

export function assertNoteVersionAad(
  userId: string,
  noteId: string,
  versionId: string,
  input: CreateNoteVersionInput
): void {
  assertPayloadAad(input.encryptedMetadata, {
    userId,
    resourceId: versionId,
    field: "note_version_metadata",
  });
  assertPayloadAad(input.encryptedBody, {
    userId,
    resourceId: versionId,
    field: "note_version_body",
  });
  assertPayloadAad(input.encryptedWrappedNoteKey, {
    userId,
    resourceId: noteId,
    field: "note_key",
  });
}

export function assertNoteUpdateAad(userId: string, noteId: string, input: UpdateNoteInput): void {
  if (input.encryptedMetadata) {
    assertPayloadAad(input.encryptedMetadata, { userId, resourceId: noteId, field: "note_metadata" });
  }
  if (input.encryptedBody) {
    assertPayloadAad(input.encryptedBody, { userId, resourceId: noteId, field: "note_body" });
  }
  if (input.encryptedWrappedNoteKey) {
    assertPayloadAad(input.encryptedWrappedNoteKey, { userId, resourceId: noteId, field: "note_key" });
  }
}

export function assertAttachmentCreateAad(
  userId: string,
  attachmentId: string,
  input: CreateAttachmentInput
): void {
  assertPayloadAad(input.encryptedMetadata, {
    userId,
    resourceId: attachmentId,
    field: "note_attachment_metadata",
  });
  assertPayloadAad(input.encryptedBlob, {
    userId,
    resourceId: attachmentId,
    field: "note_attachment_blob",
  });
}

function assertKanbanWrappedKeyAad(
  userId: string,
  boardId: string,
  noteId: string | null,
  payload: EncryptedPayload
): void {
  if (noteId) {
    assertPayloadAad(payload, { userId, resourceId: noteId, field: "note_key" });
    return;
  }
  assertPayloadAad(payload, { userId, resourceId: boardId, field: "note_kanban_key" });
}

export function assertKanbanBoardAad(
  userId: string,
  boardId: string,
  noteId: string | null,
  input: CreateKanbanBoardInput | UpdateKanbanBoardInput
): void {
  assertPayloadAad(input.encryptedBoard, {
    userId,
    resourceId: boardId,
    field: "note_kanban_board",
  });
  assertKanbanWrappedKeyAad(userId, boardId, noteId, input.encryptedWrappedKey);
}

export function assertKanbanVersionAad(
  userId: string,
  boardId: string,
  versionId: string,
  noteId: string | null,
  input: CreateKanbanVersionInput
): void {
  assertPayloadAad(input.encryptedBoard, {
    userId,
    resourceId: versionId,
    field: "note_kanban_version",
  });
  assertKanbanWrappedKeyAad(userId, boardId, noteId, input.encryptedWrappedKey);
}
