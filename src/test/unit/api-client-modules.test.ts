import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { notesApi } from "@/lib/api-client/notes";
import { noteVersionsApi } from "@/lib/api-client/note-versions";
import { vaultApi } from "@/lib/api-client/vault";
import { passkeysApi } from "@/lib/api-client/passkeys";
import { integrationsApi } from "@/lib/api-client/integrations";
import {
  createNoteInput,
  createNoteVersionInput,
  encryptedPayload,
  NOTE_ID,
  USER_ID,
  VERSION_ID,
} from "@/test/helpers/fixtures";

describe("typed API client modules", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === "/api/notes" && !init?.method) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url === "/api/notes/id-1" && init?.method === "DELETE") {
          return new Response(JSON.stringify({ success: true }), { status: 200 });
        }
        if (url === "/api/notes/id-1" && init?.method === "PUT") {
          return new Response(JSON.stringify({ id: "id-1" }), { status: 200 });
        }
        if (url === "/api/notes/id-1") {
          return new Response(JSON.stringify({ id: "id-1" }), { status: 200 });
        }
        if (url === "/api/notes" && init?.method === "POST") {
          return new Response(JSON.stringify({ id: "new" }), { status: 201 });
        }
        if (url === "/api/vault/settings" && !init?.method) {
          return new Response(JSON.stringify({ encryptedVaultSettings: null }), { status: 200 });
        }
        if (url === "/api/vault/settings" && init?.method === "PATCH") {
          return new Response(JSON.stringify({ encryptedVaultSettings: encryptedPayload("vault_settings", USER_ID) }), {
            status: 200,
          });
        }
        if (url === "/api/vault/status") {
          return new Response(JSON.stringify({ initialized: true }), { status: 200 });
        }
        if (url === "/api/vault/init" && init?.method === "POST") {
          return new Response(JSON.stringify({ id: "vault-1" }), { status: 201 });
        }
        if (url === "/api/recovery-code" && init?.method === "POST") {
          return new Response(JSON.stringify({ id: "env-1" }), { status: 201 });
        }
        if (url === "/api/vault/recovery-phrase" && init?.method === "POST") {
          return new Response(
            JSON.stringify({ id: "env-phrase", createdAt: "2026-06-17T00:00:00.000Z" }),
            { status: 201 }
          );
        }
        if (url === "/api/vault/unlock-with-recovery-code" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
              kdfMetadata: {},
            }),
            { status: 200 }
          );
        }
        if (url === "/api/vault/portable-passkey" && !init?.method) {
          return new Response(JSON.stringify({ mappings: [], active: [], pending: [] }), {
            status: 200,
          });
        }
        if (url === "/api/vault/portable-passkey/prepare" && init?.method === "POST") {
          return new Response(JSON.stringify({ id: "mapping-1", state: "pending" }), {
            status: 200,
          });
        }
        if (url === "/api/vault/portable-passkey/bind" && init?.method === "POST") {
          return new Response(JSON.stringify({ bound: true }), { status: 200 });
        }
        if (url === "/api/passkeys/vault-unlock" && init?.method === "DELETE") {
          return new Response(
            JSON.stringify({
              success: true,
              removedVaultPasskeyCount: 2,
              preservedSignInPasskeyCount: 1,
            }),
            { status: 200 }
          );
        }
        if (url === `/api/notes/${NOTE_ID}/versions` && init?.method === "POST") {
          return new Response(JSON.stringify({ id: VERSION_ID, versionNumber: 1 }), { status: 201 });
        }
        if (url === `/api/notes/${NOTE_ID}/versions`) {
          return new Response(JSON.stringify([{ id: VERSION_ID, versionNumber: 1 }]), { status: 200 });
        }
        if (url === `/api/notes/${NOTE_ID}/versions/${VERSION_ID}`) {
          return new Response(JSON.stringify({ id: VERSION_ID }), { status: 200 });
        }
        if (url === "/api/integrations" && !init?.method) {
          return new Response(JSON.stringify([{ id: "int-1", name: "Cursor" }]), { status: 200 });
        }
        if (url === "/api/integrations" && init?.method === "POST") {
          return new Response(
            JSON.stringify({
              integration: { id: "int-1", name: "Cursor", type: "mcp" },
              token: "sk_int_test",
              integrationId: "int-1",
            }),
            { status: 201 }
          );
        }
        if (url === "/api/integrations/int-1" && init?.method === "DELETE") {
          return new Response(JSON.stringify({ ok: true }), { status: 200 });
        }
        if (url === "/api/integrations/int-1/grants" && !init?.method) {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        if (url === "/api/integrations/int-1/grants" && init?.method === "PUT") {
          return new Response(JSON.stringify([]), { status: 200 });
        }
        return new Response("{}", { status: 404 });
      })
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("notesApi covers CRUD helpers", async () => {
    await expect(notesApi.list()).resolves.toEqual([]);
    await expect(notesApi.get("id-1")).resolves.toEqual({ id: "id-1" });
    await expect(notesApi.create(createNoteInput())).resolves.toEqual({ id: "new" });
    await expect(notesApi.update("id-1", createNoteInput())).resolves.toEqual({ id: "id-1" });
    await expect(notesApi.delete("id-1")).resolves.toEqual({ success: true });
  });

  it("vaultApi covers vault endpoints", async () => {
    await expect(vaultApi.status()).resolves.toEqual({ initialized: true });
    await expect(vaultApi.getSettings()).resolves.toEqual({ encryptedVaultSettings: null });
    await expect(
      vaultApi.updateSettings(encryptedPayload("vault_settings", USER_ID))
    ).resolves.toHaveProperty("encryptedVaultSettings");
    await expect(
      vaultApi.init({
        vaultVersion: "vault-v1",
        envelopes: [
          {
            method: "recovery_code",
            encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
          },
        ],
      })
    ).resolves.toEqual({ id: "vault-1" });
    await expect(
      vaultApi.storeRecoveryCode({
        encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
        kdfMetadata: {
          kdf: "argon2id",
          version: "kdf-v1",
          salt: "c2FsdA",
          memory: 65536,
          iterations: 3,
          parallelism: 1,
        },
      })
    ).resolves.toEqual({ id: "env-1" });
    await expect(
      vaultApi.replaceRecoveryPhrase({
        encryptedVaultKey: encryptedPayload("vault_key", USER_ID),
        kdfMetadata: {
          kdf: "argon2id",
          version: "kdf-v1",
          salt: "c2FsdA",
          memory: 65536,
          iterations: 3,
          parallelism: 1,
        },
        publicMetadata: { phraseLength: 12 },
      })
    ).resolves.toEqual({ id: "env-phrase", createdAt: "2026-06-17T00:00:00.000Z" });
    await expect(vaultApi.unlockWithRecoveryCode()).resolves.toHaveProperty("encryptedVaultKey");
    await expect(vaultApi.listPortablePasskeys()).resolves.toEqual({
      mappings: [],
      active: [],
      pending: [],
    });
    await expect(
      vaultApi.preparePortablePasskey({
        credentialDbId: "20000000-0000-4000-8000-000000000001",
        opaqueScope: {
          userId: "30000000-0000-4000-8000-000000000001",
          resourceId: "40000000-0000-4000-8000-000000000001",
        },
      })
    ).resolves.toMatchObject({ id: "mapping-1" });
    await expect(
      vaultApi.bindPortablePasskey({
        mappingId: "50000000-0000-4000-8000-000000000001",
        brokerEnvelopeId: "60000000-0000-4000-8000-000000000001",
        requestId: "70000000-0000-4000-8000-000000000001",
      })
    ).resolves.toEqual({ bound: true });
  });

  it("passkeysApi covers scoped vault-passkey removal", async () => {
    await expect(passkeysApi.removeAllVaultUnlock()).resolves.toEqual({
      success: true,
      removedVaultPasskeyCount: 2,
      preservedSignInPasskeyCount: 1,
    });
  });

  it("noteVersionsApi covers list/get/create", async () => {
    await expect(noteVersionsApi.list(NOTE_ID)).resolves.toEqual([
      { id: VERSION_ID, versionNumber: 1 },
    ]);
    await expect(noteVersionsApi.get(NOTE_ID, VERSION_ID)).resolves.toEqual({ id: VERSION_ID });
    const { id: _id, ...version } = createNoteVersionInput();
    await expect(
      noteVersionsApi.create(NOTE_ID, { id: VERSION_ID, ...version })
    ).resolves.toEqual({ id: VERSION_ID, versionNumber: 1 });
  });

  it("integrationsApi covers integration management endpoints", async () => {
    await expect(integrationsApi.list()).resolves.toEqual([{ id: "int-1", name: "Cursor" }]);
    await expect(integrationsApi.create("Cursor")).resolves.toMatchObject({
      token: "sk_int_test",
      integrationId: "int-1",
    });
    await expect(integrationsApi.revoke("int-1")).resolves.toEqual({ ok: true });
    await expect(integrationsApi.listGrants("int-1")).resolves.toEqual([]);
    await expect(
      integrationsApi.upsertGrants("int-1", {
        grants: [
          {
            resourceType: "note",
            resourceId: NOTE_ID,
            permissions: "read",
            encryptedWrappedKey: encryptedPayload("integration_grant", NOTE_ID),
          },
        ],
      })
    ).resolves.toEqual([]);
  });
});
