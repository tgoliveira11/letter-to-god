import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PortableVaultBrokerConflictError,
  PortableVaultBrokerDisabledError,
  portableVaultBrokerService,
} from "@/modules/vault/services/portable-vault-broker-service";

const mocks = vi.hoisted(() => ({
  enabled: true,
  list: vi.fn(),
  findCurrent: vi.fn(),
  createPending: vi.fn(),
  bind: vi.fn(),
  activate: vi.fn(),
  revoke: vi.fn(),
  cutover: vi.fn(),
  findVault: vi.fn(),
  lockCredential: vi.fn(),
  findCredential: vi.fn(),
  audit: vi.fn(),
}));

vi.mock("@/lib/db/transaction", () => ({
  runInTransaction: (callback: (tx: object) => unknown) => callback({ transaction: true }),
}));
vi.mock("@/lib/env/portable-vault-broker", () => ({
  resolvePortableVaultBrokerPublicConfig: () => ({ enabled: mocks.enabled, brokerUrl: "https://broker" }),
}));
vi.mock("@/server/repositories/portable-vault-broker-repository", () => ({
  portableVaultBrokerRepository: {
    listCurrentForUser: mocks.list,
    findCurrentByCredential: mocks.findCurrent,
    createPending: mocks.createPending,
    bindPendingBrokerEnvelope: mocks.bind,
    activateAfterReceipt: mocks.activate,
    revokeAfterReceipt: mocks.revoke,
    findLatestCutoverEpoch: mocks.cutover,
  },
}));
vi.mock("@/server/repositories/vault-repository", () => ({
  vaultRepository: { findVaultByUserId: mocks.findVault },
}));
vi.mock("@/server/repositories/passkey-repository", () => ({
  passkeyRepository: {
    lockForVaultMutation: mocks.lockCredential,
    findByIdForUser: mocks.findCredential,
  },
}));
vi.mock("@/server/repositories/audit-repository", () => ({
  auditRepository: { record: mocks.audit },
}));

const userId = "10000000-0000-4000-8000-000000000001";
const credentialDbId = "20000000-0000-4000-8000-000000000001";
const envelopeId = "30000000-0000-4000-8000-000000000001";
const requestId = "40000000-0000-4000-8000-000000000001";
const scope = {
  userId: "50000000-0000-4000-8000-000000000001",
  resourceId: "60000000-0000-4000-8000-000000000001",
};
const credential = {
  id: credentialDbId,
  credentialId: "credential-id",
  friendlyName: "Synced passkey",
  signInEnabled: true,
  createdAt: new Date("2026-07-29T12:00:00Z"),
};
const row = {
  id: "70000000-0000-4000-8000-000000000001",
  state: "active",
  brokerEnvelopeId: envelopeId,
  opaqueAadUserId: scope.userId,
  opaqueAadResourceId: scope.resourceId,
  enrollmentRequestId: requestId,
  createdAt: new Date("2026-07-29T12:01:00Z"),
  activatedAt: new Date("2026-07-29T12:02:00Z"),
  credentialDbId,
  credentialId: credential.credentialId,
  friendlyName: credential.friendlyName,
  signInEnabled: true,
};

describe("portableVaultBrokerService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enabled = true;
    mocks.list.mockResolvedValue([row]);
    mocks.findVault.mockResolvedValue({ vaultVersion: "vault-v2" });
    mocks.findCredential.mockResolvedValue(credential);
    mocks.cutover.mockResolvedValue(null);
    mocks.findCurrent.mockResolvedValue(null);
    mocks.createPending.mockResolvedValue({ id: row.id, createdAt: row.createdAt });
  });

  it("fails closed while disabled", async () => {
    mocks.enabled = false;
    await expect(portableVaultBrokerService.list(userId)).rejects.toBeInstanceOf(
      PortableVaultBrokerDisabledError
    );
  });

  it("lists active and pending mapping views without identity in the opaque scope", async () => {
    const pending = { ...row, id: "70000000-0000-4000-8000-000000000002", state: "pending" };
    mocks.list.mockResolvedValue([row, pending]);

    await expect(portableVaultBrokerService.list(userId)).resolves.toMatchObject({
      active: [{ credentialDbId, opaqueScope: scope }],
      pending: [{ state: "pending" }],
    });
  });

  it("prepares a new mapping only for a sign-in credential on a v2 vault", async () => {
    await expect(
      portableVaultBrokerService.prepareEnrollment(userId, { credentialDbId, opaqueScope: scope })
    ).resolves.toMatchObject({
      state: "pending",
      credentialDbId,
      opaqueScope: scope,
    });
    expect(mocks.lockCredential).toHaveBeenCalled();
    expect(mocks.createPending).toHaveBeenCalledWith(
      expect.objectContaining({ passkeyCredentialId: credentialDbId }),
      expect.anything()
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      "portable_vault_enrollment_pending",
      userId,
      { method: "portable_passkey" },
      expect.anything()
    );
  });

  it("rejects setup without a v2 vault, eligible credential, or post-cutover passkey", async () => {
    mocks.findVault.mockResolvedValueOnce(null);
    await expect(
      portableVaultBrokerService.prepareEnrollment(userId, { credentialDbId, opaqueScope: scope })
    ).rejects.toBeInstanceOf(PortableVaultBrokerConflictError);

    mocks.findCredential.mockResolvedValueOnce({ ...credential, signInEnabled: false });
    await expect(
      portableVaultBrokerService.prepareEnrollment(userId, { credentialDbId, opaqueScope: scope })
    ).rejects.toThrow("active account sign-in passkey");

    mocks.cutover.mockResolvedValueOnce({ cutoffAt: new Date("2026-07-29T13:00:00Z") });
    await expect(
      portableVaultBrokerService.prepareEnrollment(userId, { credentialDbId, opaqueScope: scope })
    ).rejects.toThrow("after the portable-vault cutover");
  });

  it("reuses a pending mapping and rejects an already active mapping", async () => {
    mocks.findCurrent.mockResolvedValueOnce({ id: row.id, state: "pending" });
    await expect(
      portableVaultBrokerService.prepareEnrollment(userId, { credentialDbId, opaqueScope: scope })
    ).resolves.toMatchObject({ id: row.id });

    mocks.findCurrent.mockResolvedValueOnce({ id: row.id, state: "active" });
    await expect(
      portableVaultBrokerService.prepareEnrollment(userId, { credentialDbId, opaqueScope: scope })
    ).rejects.toThrow("already has portable vault unlock");
  });

  it("binds only a current pending mapping", async () => {
    mocks.bind.mockResolvedValueOnce({ id: row.id });
    await expect(
      portableVaultBrokerService.bindPendingEnrollment(userId, {
        mappingId: row.id,
        brokerEnvelopeId: envelopeId,
        requestId,
      })
    ).resolves.toEqual({ bound: true });

    mocks.bind.mockResolvedValueOnce(null);
    await expect(
      portableVaultBrokerService.bindPendingEnrollment(userId, {
        mappingId: row.id,
        brokerEnvelopeId: envelopeId,
        requestId,
      })
    ).rejects.toThrow("state changed");
  });

  it("validates unlock mappings and finalizes enroll/revoke only after a verified receipt", async () => {
    await expect(
      portableVaultBrokerService.completeVerifiedReceipt(userId, {
        action: "unlock",
        requestId,
        credentialId: credential.credentialId,
        envelopeId,
      })
    ).resolves.toEqual({ completed: true });

    mocks.activate.mockResolvedValueOnce({ id: row.id });
    await portableVaultBrokerService.completeVerifiedReceipt(userId, {
      action: "enroll",
      requestId,
      credentialId: credential.credentialId,
      envelopeId,
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      "portable_vault_enabled",
      userId,
      { method: "portable_passkey" },
      expect.anything()
    );

    mocks.revoke.mockResolvedValueOnce({ id: row.id });
    await portableVaultBrokerService.completeVerifiedReceipt(userId, {
      action: "revoke",
      requestId,
      credentialId: credential.credentialId,
      envelopeId,
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      "portable_vault_revoked",
      userId,
      { method: "portable_passkey" },
      expect.anything()
    );
  });

  it("rejects receipt completion when no exact mapping can be changed", async () => {
    mocks.list.mockResolvedValueOnce([]);
    await expect(
      portableVaultBrokerService.completeVerifiedReceipt(userId, {
        action: "unlock",
        requestId,
        credentialId: credential.credentialId,
        envelopeId,
      })
    ).rejects.toThrow("mapping is not active");

    mocks.activate.mockResolvedValueOnce(null);
    await expect(
      portableVaultBrokerService.completeVerifiedReceipt(userId, {
        action: "enroll",
        requestId,
        credentialId: credential.credentialId,
        envelopeId,
      })
    ).rejects.toThrow("could not be finalized");
  });
});
