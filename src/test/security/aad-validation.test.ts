import { describe, it, expect } from "vitest";
import {
  assertPayloadAad,
  assertNoteCreateAad,
  assertNoteUpdateAad,
  assertKanbanBoardAad,
  assertKanbanVersionAad,
  assertVaultKeyAad,
  AadValidationError,
} from "@/server/policies/aad-validation";
import {
  createKanbanBoardInput,
  createKanbanVersionInput,
  createNoteInput,
  encryptedPayload,
  KANBAN_BOARD_ID,
  KANBAN_VERSION_ID,
  NOTE_ID,
  USER_ID,
} from "@/test/helpers/fixtures";

describe("AAD validation policy", () => {
  it("accepts matching userId, resourceId, and field", () => {
    expect(() =>
      assertPayloadAad(encryptedPayload("note_metadata", NOTE_ID), {
        userId: USER_ID,
        resourceId: NOTE_ID,
        field: "note_metadata",
      })
    ).not.toThrow();
  });

  it("rejects mismatched userId", () => {
    expect(() =>
      assertPayloadAad(encryptedPayload("note_metadata", NOTE_ID), {
        userId: "00000000-0000-0000-0000-000000000099",
        resourceId: NOTE_ID,
        field: "note_metadata",
      })
    ).toThrow(AadValidationError);
  });

  it("rejects mismatched resourceId", () => {
    expect(() =>
      assertPayloadAad(encryptedPayload("note_metadata", NOTE_ID), {
        userId: USER_ID,
        resourceId: "00000000-0000-0000-0000-000000000099",
        field: "note_metadata",
      })
    ).toThrow(AadValidationError);
  });

  it("rejects mismatched field", () => {
    expect(() =>
      assertPayloadAad(encryptedPayload("note_metadata", NOTE_ID), {
        userId: USER_ID,
        resourceId: NOTE_ID,
        field: "note_body",
      })
    ).toThrow(AadValidationError);
  });

  it("validates all note create payloads together", () => {
    const input = createNoteInput();
    expect(() => assertNoteCreateAad(USER_ID, NOTE_ID, input)).not.toThrow();
  });

  it("rejects note create when metadata AAD resourceId differs from note id", () => {
    const input = createNoteInput();
    input.encryptedMetadata.aad.resourceId = "00000000-0000-0000-0000-000000000099";
    expect(() => assertNoteCreateAad(USER_ID, NOTE_ID, input)).toThrow(AadValidationError);
  });

  it("validates note update payloads against persisted note id", () => {
    expect(() =>
      assertNoteUpdateAad(USER_ID, NOTE_ID, {
        encryptedBody: encryptedPayload("note_body", NOTE_ID),
      })
    ).not.toThrow();
  });

  it("validates vault key AAD binds to user id", () => {
    expect(() =>
      assertVaultKeyAad(USER_ID, encryptedPayload("vault_key", USER_ID), "selahkeep:vault-envelope:v1")
    ).not.toThrow();
    expect(() =>
      assertVaultKeyAad(USER_ID, encryptedPayload("vault_key", NOTE_ID), "selahkeep:vault-envelope:v1")
    ).toThrow(AadValidationError);
  });

  it("validates note-bound kanban board AAD", () => {
    expect(() =>
      assertKanbanBoardAad(USER_ID, KANBAN_BOARD_ID, NOTE_ID, createKanbanBoardInput())
    ).not.toThrow();
  });

  it("validates standalone kanban board AAD", () => {
    expect(() =>
      assertKanbanBoardAad(USER_ID, KANBAN_BOARD_ID, null, createKanbanBoardInput(null))
    ).not.toThrow();
  });

  it("rejects standalone kanban board wrapped keys bound to another resource", () => {
    const input = createKanbanBoardInput(null);
    input.encryptedWrappedKey.aad.resourceId = NOTE_ID;
    expect(() => assertKanbanBoardAad(USER_ID, KANBAN_BOARD_ID, null, input)).toThrow(
      AadValidationError
    );
  });

  it("validates note-bound kanban version AAD", () => {
    expect(() =>
      assertKanbanVersionAad(
        USER_ID,
        KANBAN_BOARD_ID,
        KANBAN_VERSION_ID,
        NOTE_ID,
        createKanbanVersionInput()
      )
    ).not.toThrow();
  });

  it("rejects kanban version content bound to the board instead of version id", () => {
    const input = createKanbanVersionInput();
    input.encryptedBoard.aad.resourceId = KANBAN_BOARD_ID;
    expect(() =>
      assertKanbanVersionAad(USER_ID, KANBAN_BOARD_ID, KANBAN_VERSION_ID, NOTE_ID, input)
    ).toThrow(AadValidationError);
  });
});
