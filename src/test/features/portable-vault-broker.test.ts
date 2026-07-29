import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  enrollPortablePasskey,
  revokePortablePasskey,
  unlockWithPortablePasskey,
} from "@/features/passkey/portable-vault-broker";
import type { PortableVaultMapping } from "@/lib/api-client/vault";

const mocks = vi.hoisted(() => ({
  disposeEnrollment: vi.fn(),
  disposeSession: vi.fn(),
  enrollPackage: vi.fn(),
  prepare: vi.fn(),
  bind: vi.fn(),
  grant: vi.fn(),
  finalize: vi.fn(),
  unlockResponse: vi.fn(),
  assertOperation: vi.fn(),
  isUnlockResponse: vi.fn(),
  unseal: vi.fn(),
}));

vi.mock("@tgoliveira/vault-core", () => ({
  generatePortableVaultOpaqueAadScope: () => ({
    userId: "10000000-0000-4000-8000-000000000001",
    resourceId: "10000000-0000-4000-8000-000000000002",
  }),
}));

vi.mock("@tgoliveira/vault-core/browser", () => ({
  createPortableVaultBrokerEnrollmentPackageWithSessionCache: mocks.enrollPackage,
  serializePortableVaultBrokerEnrollmentPackage: vi.fn(() => ({
    puk: "A".repeat(43),
    encryptedVaultKey: { version: "enc-v1" },
  })),
  createPortableVaultBrokerUnlockSession: vi.fn(async () => ({
    publicJwk: { kty: "EC", crv: "P-256", x: "x", y: "y" },
    thumbprint: "thumbprint",
    unseal: mocks.unseal,
    dispose: mocks.disposeSession,
  })),
  unlockPortableVaultBrokerResponse: mocks.unlockResponse,
  isPortableVaultBrokerUnlockResponse: mocks.isUnlockResponse,
  assertVaultSessionOperationCurrent: mocks.assertOperation,
}));

vi.mock("@tgoliveira/secure-auth/client", () => ({
  requestPortableVaultGrant: mocks.grant,
  passkeyPortableVaultGrantApi: { finalizeReceipt: mocks.finalize },
}));

vi.mock("@/lib/crypto-client/vault-session", () => ({
  getUserVaultKey: () => ({ type: "secret" }),
}));

vi.mock("@/lib/api-client/vault", () => ({
  vaultApi: {
    preparePortablePasskey: mocks.prepare,
    bindPortablePasskey: mocks.bind,
  },
}));

const mapping: PortableVaultMapping = {
  id: "20000000-0000-4000-8000-000000000001",
  state: "active",
  brokerEnvelopeId: "20000000-0000-4000-8000-000000000002",
  opaqueScope: {
    userId: "10000000-0000-4000-8000-000000000001",
    resourceId: "10000000-0000-4000-8000-000000000002",
  },
  enrollmentRequestId: "30000000-0000-4000-8000-000000000001",
  createdAt: new Date().toISOString(),
  activatedAt: new Date().toISOString(),
  credentialDbId: "40000000-0000-4000-8000-000000000001",
  credentialId: "credential-id",
  friendlyName: "Synced passkey",
  signInEnabled: true,
};

describe("portable vault broker browser flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
    mocks.prepare.mockResolvedValue({ ...mapping, state: "pending", brokerEnvelopeId: null });
    mocks.bind.mockResolvedValue({ bound: true });
    mocks.isUnlockResponse.mockReturnValue(true);
    mocks.enrollPackage.mockResolvedValue({
      puk: new Uint8Array(32).fill(7),
      encryptedVaultKey: { version: "enc-v1" },
      dispose: mocks.disposeEnrollment,
    });
  });

  it("sends enrollment material directly to the broker and disposes the PUK", async () => {
    mocks.grant.mockResolvedValue({
      grant: "signed-grant",
      requestId: "30000000-0000-4000-8000-000000000001",
      verifiedCredentialId: "credential-id",
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          envelopeId: mapping.brokerEnvelopeId,
          requestId: "30000000-0000-4000-8000-000000000001",
          completionReceipt: "signed-receipt",
        }),
        { status: 201 }
      )
    );
    mocks.finalize.mockResolvedValue({
      action: "enroll",
      requestId: "30000000-0000-4000-8000-000000000001",
      credentialId: "credential-id",
      envelopeId: mapping.brokerEnvelopeId,
    });

    await enrollPortablePasskey({
      credentialDbId: mapping.credentialDbId,
      brokerUrl: "https://vault-broker-green.vercel.app",
      operation: { ownerId: "user-1", operationId: 1 },
    });

    expect(fetch).toHaveBeenCalledWith(
      "https://vault-broker-green.vercel.app/api/v1/envelopes/enroll",
      expect.objectContaining({
        credentials: "omit",
        body: JSON.stringify({
          puk: "A".repeat(43),
          encryptedVaultKey: { version: "enc-v1" },
        }),
      })
    );
    expect(mocks.enrollPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: { ownerId: "user-1", operationId: 1 },
      })
    );
    expect(mocks.bind).toHaveBeenCalledBefore(mocks.finalize);
    expect(mocks.disposeEnrollment).toHaveBeenCalledOnce();
  });

  it("fails closed on enrollment request mismatch and still disposes the PUK", async () => {
    mocks.grant.mockResolvedValue({
      grant: "signed-grant",
      requestId: "30000000-0000-4000-8000-000000000001",
      verifiedCredentialId: "credential-id",
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          envelopeId: mapping.brokerEnvelopeId,
          requestId: "30000000-0000-4000-8000-000000000099",
          completionReceipt: "signed-receipt",
        }),
        { status: 201 }
      )
    );

    await expect(
      enrollPortablePasskey({
        credentialDbId: mapping.credentialDbId,
        brokerUrl: "https://vault-broker-green.vercel.app",
        operation: { ownerId: "user-1", operationId: 1 },
      })
    ).rejects.toThrow("request mismatch");
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.disposeEnrollment).toHaveBeenCalledOnce();
  });

  it("returns the UVK only after receipt finalization and disposes the one-use session", async () => {
    const order: string[] = [];
    const vaultKey = { type: "secret" } as CryptoKey;
    mocks.grant.mockResolvedValue({
      grant: "signed-grant",
      requestId: "30000000-0000-4000-8000-000000000001",
      verifiedCredentialId: "credential-id",
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          requestId: "30000000-0000-4000-8000-000000000001",
          completionReceipt: "signed-receipt",
        })
      )
    );
    mocks.unlockResponse.mockImplementation(async (input) => {
      order.push("unwrapped");
      await input.verifyAndConsumeCompletionReceipt("signed-receipt");
      return {
        status: "unlocked",
        vaultKey,
        requestId: "30000000-0000-4000-8000-000000000001",
        completionReceipt: "signed-receipt",
      };
    });
    mocks.finalize.mockImplementation(async () => {
      order.push("finalized");
      return {
        action: "unlock",
        requestId: "30000000-0000-4000-8000-000000000001",
        credentialId: "credential-id",
        envelopeId: mapping.brokerEnvelopeId,
      };
    });

    await expect(
      unlockWithPortablePasskey({
        mapping,
        brokerUrl: "https://vault-broker-green.vercel.app",
        operation: { ownerId: "user-1", operationId: 1 },
      })
    ).resolves.toBe(vaultKey);
    expect(order).toEqual(["unwrapped", "finalized"]);
    expect(mocks.unlockResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: { ownerId: "user-1", operationId: 1 },
        verifyAndConsumeCompletionReceipt: expect.any(Function),
      })
    );
    expect(mocks.disposeSession).toHaveBeenCalledOnce();
  });

  it("fails closed when the completion receipt is rejected inside vault-core", async () => {
    mocks.grant.mockResolvedValue({
      grant: "signed-grant",
      requestId: "30000000-0000-4000-8000-000000000001",
      verifiedCredentialId: "credential-id",
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          encryptedVaultKey: {
            version: "enc-v1",
            alg: "AES-GCM",
            iv: "iv",
            ciphertext: "ciphertext",
            aad: mapping.opaqueScope,
          },
          sealedPuk: {},
          requestId: "30000000-0000-4000-8000-000000000001",
          completionReceipt: "rejected-receipt",
        })
      )
    );
    mocks.unlockResponse.mockResolvedValue({
      status: "completion_receipt_rejected",
      error: new Error("receipt rejected"),
    });

    await expect(
      unlockWithPortablePasskey({
        mapping,
        brokerUrl: "https://vault-broker-green.vercel.app",
        operation: { ownerId: "user-1", operationId: 1 },
      })
    ).rejects.toThrow("completion receipt was rejected");
    expect(mocks.finalize).not.toHaveBeenCalled();
    expect(mocks.disposeSession).toHaveBeenCalledOnce();
  });

  it("reconciles revoke through a fresh grant and signed receipt", async () => {
    mocks.grant.mockResolvedValue({
      grant: "signed-grant",
      requestId: "30000000-0000-4000-8000-000000000001",
      verifiedCredentialId: "credential-id",
    });
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          requestId: "30000000-0000-4000-8000-000000000001",
          completionReceipt: "signed-receipt",
        })
      )
    );
    mocks.finalize.mockResolvedValue({
      action: "revoke",
      requestId: "30000000-0000-4000-8000-000000000001",
      credentialId: "credential-id",
      envelopeId: mapping.brokerEnvelopeId,
    });

    await revokePortablePasskey({
      mapping,
      brokerUrl: "https://vault-broker-green.vercel.app",
    });

    expect(mocks.grant).toHaveBeenCalledWith({
      action: "revoke",
      credentialDbId: mapping.credentialDbId,
      envelopeId: mapping.brokerEnvelopeId,
    });
    expect(mocks.finalize).toHaveBeenCalledWith("signed-receipt");
  });
});
