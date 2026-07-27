import {
  assertVaultSessionLeaseCurrent,
  type VaultSessionLease,
} from "@tgoliveira/vault-core/browser";
import { getCurrentVaultSessionLease } from "@/lib/crypto-client/vault-session";
import {
  AsyncOwnershipCancelledError,
  AsyncOwnershipController,
  type AsyncOwnershipToken,
} from "@/lib/application-state/async-ownership";

export type VaultAsyncOwnership = Readonly<{
  lease: VaultSessionLease;
  token: AsyncOwnershipToken;
}>;

export function captureVaultAsyncOwnership(
  controller: AsyncOwnershipController,
  input: {
    ownerId: string;
    resourceId: string;
    encryptedKeyFingerprint?: string | null;
  }
): VaultAsyncOwnership {
  const lease = getCurrentVaultSessionLease(input.ownerId);
  if (!lease) throw new AsyncOwnershipCancelledError();
  assertVaultSessionLeaseCurrent(lease);
  const token = controller.capture({
    ownerId: input.ownerId,
    leaseEpoch: lease.epoch,
    resourceId: input.resourceId,
    encryptedKeyFingerprint: input.encryptedKeyFingerprint,
  });
  return Object.freeze({ lease, token });
}

export function assertVaultAsyncOwnershipCurrent(
  controller: AsyncOwnershipController,
  ownership: VaultAsyncOwnership
): void {
  controller.assertCurrent(ownership.token);
  assertVaultSessionLeaseCurrent(ownership.lease);
}
