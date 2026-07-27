import {
  beginVaultOwnerOperation,
  lockVaultSession,
  unlockVaultSession,
} from "@/lib/crypto-client/vault-session";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithTestApplicationState as render } from "@/test/helpers/application-state";
import { NoteVersionHistory } from "@/components/notes/note-version-history";
import { encryptNote } from "@/lib/crypto-client/notes";
import { encryptNoteVersion } from "@/lib/crypto-client/note-versions";
import { normalizeNoteMetadata } from "@/lib/notes/note-metadata";import { generateUserVaultKey } from "@/lib/crypto-client/vault";
import { USER_ID, NOTE_ID } from "@/test/helpers/fixtures";

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({ data: { user: { id: USER_ID } }, status: "authenticated" })),
}));

const mocks = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), create: vi.fn() }));

vi.mock("@/lib/api-client/note-versions", () => ({
  noteVersionsApi: { list: mocks.list, get: mocks.get, create: mocks.create },
}));

async function buildVersionRow(versionId: string, versionNumber: number, body: string, title: string) {
  const note = await encryptNote(USER_ID, NOTE_ID, { title: "n", body: "n" });
  const payload = await encryptNoteVersion(
    USER_ID,
    NOTE_ID,
    versionId,
    normalizeNoteMetadata({ title }),
    body,
    note.encryptedWrappedNoteKey
  );
  return {
    id: versionId,
    noteId: NOTE_ID,
    vaultId: "vault-1",
    versionNumber,
    encryptedMetadata: payload.encryptedMetadata,
    encryptedBody: payload.encryptedBody,
    encryptedWrappedNoteKey: payload.encryptedWrappedNoteKey,
    bodyEncryptionVersion: payload.bodyEncryptionVersion,
    createdAt: new Date(2026, 5, versionNumber + 1).toISOString(),
  };
}

const V1 = "550e8400-e29b-41d4-a716-4466554400a1";
const V2 = "550e8400-e29b-41d4-a716-4466554400a2";

describe("NoteVersionHistory", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await unlockVaultSession(
      await generateUserVaultKey(),
      "password",
      beginVaultOwnerOperation(USER_ID)
    );
  });

  it("shows empty state when there are no versions", async () => {
    mocks.list.mockResolvedValue([]);
    render(
      <NoteVersionHistory
        noteId={NOTE_ID}
        enabled
        currentTitle="Now"
        currentBody="current body"
        onRestore={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId("note-version-history-toggle"));
    expect(await screen.findByTestId("no-versions")).toBeInTheDocument();
  });

  it("lists versions, compares two, and restores", async () => {
    const row2 = await buildVersionRow(V2, 2, "line one\nline two changed", "Title v2");
    const row1 = await buildVersionRow(V1, 1, "line one\nline two", "Title v1");
    mocks.list.mockResolvedValue([row2, row1]); // newest first

    const onRestore = vi.fn().mockResolvedValue(undefined);
    render(
      <NoteVersionHistory
        noteId={NOTE_ID}
        enabled
        currentTitle="Now"
        currentBody="line one\nline two changed"
        onRestore={onRestore}
      />
    );

    fireEvent.click(screen.getByTestId("note-version-history-toggle"));

    expect(await screen.findByTestId("version-row-2")).toBeInTheDocument();
    expect(screen.getByTestId("version-row-1")).toBeInTheDocument();

    // Diff is computed automatically (default: previous version vs current note).
    await waitFor(() => expect(screen.getByTestId("note-version-diff")).toBeInTheDocument());

    // Changing a selection recomputes automatically (compare v1 with v2).
    fireEvent.change(screen.getByTestId("version-select-b"), { target: { value: V2 } });
    await waitFor(() =>
      expect(screen.getByTestId("note-version-diff")).toBeInTheDocument()
    );

    // Restore version 1.
    fireEvent.click(screen.getByTestId("version-restore-1"));
    fireEvent.click(screen.getByText("Restore version"));

    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    const restored = onRestore.mock.calls[0][0];
    expect(restored.body).toBe("line one\nline two");
    expect(restored.metadata.title).toBe("Title v1");
  });

  it("surfaces a load error", async () => {
    mocks.list.mockRejectedValue(new Error("boom"));
    render(
      <NoteVersionHistory
        noteId={NOTE_ID}
        enabled
        currentTitle="Now"
        currentBody="b"
        onRestore={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId("note-version-history-toggle"));
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });
});
