import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELETE as DELETE_LEGACY } from "@/app/api/passkeys/route";
import { DELETE as DELETE_VAULT_UNLOCK } from "@/app/api/passkeys/vault-unlock/route";
import { USER_ID } from "@/test/helpers/fixtures";

const mocks = vi.hoisted(() => ({
  requireFullyAuthenticatedUser: vi.fn(),
  removeAllVaultUnlockCredentials: vi.fn(),
  clearVaultDeviceBindingCookie: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireFullyAuthenticatedUser: mocks.requireFullyAuthenticatedUser,
  UnauthorizedError: class UnauthorizedError extends Error {
    name = "UnauthorizedError";
  },
}));

vi.mock("@/server/services/passkey-service", () => ({
  passkeyService: {
    removeAllVaultUnlockCredentials: mocks.removeAllVaultUnlockCredentials,
  },
  NotFoundError: class NotFoundError extends Error {
    name = "NotFoundError";
  },
}));

vi.mock("@/lib/passkey/vault-device-binding-cookie", () => ({
  clearVaultDeviceBindingCookie: mocks.clearVaultDeviceBindingCookie,
  readVaultDeviceBindingIdFromCookies: vi.fn(),
}));

describe("DELETE /api/passkeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireFullyAuthenticatedUser.mockResolvedValue({ id: USER_ID, email: "user@example.com" });
  });

  it("removes vault unlock passkeys without delegating account passkey deletion", async () => {
    mocks.removeAllVaultUnlockCredentials.mockResolvedValue({
      success: true,
      removedBindingIds: ["binding-1"],
      removedVaultPasskeyCount: 2,
      preservedSignInPasskeyCount: 1,
    });
    const res = await DELETE_LEGACY();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      success: true,
      removedBindingIds: ["binding-1"],
      removedVaultPasskeyCount: 2,
      preservedSignInPasskeyCount: 1,
    });
    expect(mocks.removeAllVaultUnlockCredentials).toHaveBeenCalledWith(USER_ID);
    expect(mocks.clearVaultDeviceBindingCookie).toHaveBeenCalledWith(res);
  });

  it("exposes the scoped bulk removal on the vault-unlock collection route", async () => {
    mocks.removeAllVaultUnlockCredentials.mockResolvedValue({
      success: true,
      removedBindingIds: [],
      removedVaultPasskeyCount: 1,
      preservedSignInPasskeyCount: 0,
    });

    const res = await DELETE_VAULT_UNLOCK();

    expect(res.status).toBe(200);
    expect(mocks.removeAllVaultUnlockCredentials).toHaveBeenCalledWith(USER_ID);
    expect(mocks.clearVaultDeviceBindingCookie).toHaveBeenCalledWith(res);
  });
});
