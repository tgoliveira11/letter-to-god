import { beforeEach, describe, expect, it, vi } from "vitest";
import { USER_ID } from "@/test/helpers/fixtures";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  list: vi.fn(),
  prepare: vi.fn(),
  bind: vi.fn(),
  complete: vi.fn(),
  finalize: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireFullyAuthenticatedUser: mocks.requireUser,
  UnauthorizedError: class UnauthorizedError extends Error {
    name = "UnauthorizedError";
  },
}));
vi.mock("@/server/services/portable-vault-broker-service", () => ({
  portableVaultBrokerService: {
    list: mocks.list,
    prepareEnrollment: mocks.prepare,
    bindPendingEnrollment: mocks.bind,
    completeVerifiedReceipt: mocks.complete,
  },
}));
vi.mock("@/lib/secure-auth", () => ({
  secureAuth: {
    routes: {
      passkeyPortableVaultGrantFinalize: { POST: mocks.finalize },
    },
  },
}));

describe("portable vault broker app routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: USER_ID });
  });

  it("lists mappings for the fully authenticated owner", async () => {
    mocks.list.mockResolvedValue({ mappings: [], active: [], pending: [] });
    const { GET } = await import("@/app/api/vault/portable-passkey/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(mocks.list).toHaveBeenCalledWith(USER_ID);
  });

  it("validates and prepares an opaque mapping", async () => {
    const input = {
      credentialDbId: "20000000-0000-4000-8000-000000000001",
      opaqueScope: {
        userId: "30000000-0000-4000-8000-000000000001",
        resourceId: "40000000-0000-4000-8000-000000000001",
      },
    };
    mocks.prepare.mockResolvedValue({ id: "mapping-id" });
    const { POST } = await import("@/app/api/vault/portable-passkey/prepare/route");
    const response = await POST(
      new Request("https://www.selahkeep.com/api/vault/portable-passkey/prepare", {
        method: "POST",
        body: JSON.stringify(input),
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.prepare).toHaveBeenCalledWith(USER_ID, input);
  });

  it("rejects malformed prepare input without calling the service", async () => {
    const { POST } = await import("@/app/api/vault/portable-passkey/prepare/route");
    const response = await POST(
      new Request("https://www.selahkeep.com/api/vault/portable-passkey/prepare", {
        method: "POST",
        body: JSON.stringify({ credentialDbId: "not-a-uuid" }),
      })
    );
    expect(response.status).toBe(400);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("validates and binds broker reconciliation state", async () => {
    const input = {
      mappingId: "20000000-0000-4000-8000-000000000001",
      brokerEnvelopeId: "30000000-0000-4000-8000-000000000001",
      requestId: "40000000-0000-4000-8000-000000000001",
    };
    mocks.bind.mockResolvedValue({ bound: true });
    const { POST } = await import("@/app/api/vault/portable-passkey/bind/route");
    const response = await POST(
      new Request("https://www.selahkeep.com/api/vault/portable-passkey/bind", {
        method: "POST",
        body: JSON.stringify(input),
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.bind).toHaveBeenCalledWith(USER_ID, input);
  });

  it("rejects malformed binding input without calling the service", async () => {
    const { POST } = await import("@/app/api/vault/portable-passkey/bind/route");
    const response = await POST(
      new Request("https://www.selahkeep.com/api/vault/portable-passkey/bind", {
        method: "POST",
        body: JSON.stringify({ mappingId: "not-a-uuid" }),
      })
    );
    expect(response.status).toBe(400);
    expect(mocks.bind).not.toHaveBeenCalled();
  });

  it("updates local state only after secure-auth accepts the receipt", async () => {
    const finalized = {
      action: "unlock",
      requestId: "40000000-0000-4000-8000-000000000001",
      credentialId: "credential-id",
      envelopeId: "30000000-0000-4000-8000-000000000001",
      completed: true,
    };
    mocks.finalize.mockResolvedValue(
      Response.json(finalized, { status: 200 })
    );
    const { POST } = await import(
      "@/app/api/account/passkeys/portable-vault-grants/finalize/route"
    );
    const response = await POST(
      new Request("https://www.selahkeep.com/api/account/passkeys/portable-vault-grants/finalize", {
        method: "POST",
        body: JSON.stringify({ receipt: "signed-receipt" }),
      })
    );
    expect(response.status).toBe(200);
    expect(mocks.complete).toHaveBeenCalledWith(USER_ID, finalized);
  });

  it("does not update local state when receipt verification fails", async () => {
    mocks.finalize.mockResolvedValue(Response.json({ error: "invalid" }, { status: 400 }));
    const { POST } = await import(
      "@/app/api/account/passkeys/portable-vault-grants/finalize/route"
    );
    const response = await POST(new Request("https://www.selahkeep.com", { method: "POST" }));
    expect(response.status).toBe(400);
    expect(mocks.complete).not.toHaveBeenCalled();
  });
});
