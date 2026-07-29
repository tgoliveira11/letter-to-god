import { clearNoteBodyCache } from "@/features/notes/eager-decrypt-notes";
import {
  assertUserVaultKeyNonExtractable,
  exportUserVaultKey,
  importUserVaultKey,
} from "@tgoliveira/vault-core";
import {
  assertVaultSessionLeaseCurrent,
  assertVaultSessionOperationCurrent,
  beginVaultSessionOperation as coreBeginVaultSessionOperation,
  captureVaultSessionLease,
  clearVaultAutoLockTimer,
  clearVaultSessionOwner as coreClearVaultSessionOwner,
  configureVaultSession,
  getSessionVaultKey,
  getVaultAutoLockMinutes,
  getVaultAutoLockRemainingMs,
  isVaultManuallyLocked,
  isVaultSessionLeaseCurrent,
  isVaultUnlocked,
  lockVaultSession as coreLockVaultSession,
  lockVaultSessionManually as coreLockVaultSessionManually,
  registerVaultUnloadGuard,
  resetVaultSessionLockState as coreResetVaultSessionLockState,
  scheduleVaultAutoLock as coreScheduleVaultAutoLock,
  subscribeVaultSession as coreSubscribeVaultSession,
  suppressVaultActivity as coreSuppressVaultActivity,
  touchVaultSession as coreTouchVaultSession,
  unlockVaultSession as coreUnlockVaultSession,
  type VaultSessionLease,
  type VaultSessionOperation,
} from "@tgoliveira/vault-core/browser";
import { getVaultAutoLockMinutesFromConfig } from "@/lib/env/vault-from-env";
import { VAULT_INACTIVITY_MS as LEGACY_VAULT_INACTIVITY_MS } from "@/lib/vault/vault-auto-lock-config";
import {
  cacheVaultInnerKeyMaterialFromEnvelopeDecrypt,
} from "@tgoliveira/vault-core/browser";

export { LEGACY_VAULT_INACTIVITY_MS as VAULT_INACTIVITY_MS };

export {
  configureVaultSession,
  getSessionVaultKey,
  getVaultAutoLockMinutes,
  getVaultAutoLockRemainingMs,
  isVaultManuallyLocked,
  isVaultUnlocked,
  registerVaultUnloadGuard,
  clearVaultAutoLockTimer,
  assertVaultSessionLeaseCurrent,
  assertVaultSessionOperationCurrent,
  coreSuppressVaultActivity as suppressVaultActivity,
};

export type VaultUnlockMethod =
  | "password"
  | "recovery_phrase"
  | "passkey_prf"
  | "portable_passkey";

export type VaultLockReason = "manual" | "auto_lock" | "logout" | "account_switch" | "error";

export type VaultSessionState = {
  status: "locked" | "unlocked";
  hasUserVaultKey: boolean;
  unlockedAt?: number;
  lastActivityAt?: number;
  unlockMethod?: VaultUnlockMethod;
  ownerId?: string;
  epoch?: number;
};

type BeforeAutoLockHandler = () => void | Promise<void>;

let unlockedAt = 0;
let unlockMethod: VaultUnlockMethod | undefined;
let lockedByInactivity = false;
let autoLockSuspendCount = 0;
let onAutoLockCallback: (() => void) | null = null;
let preLockTimer: ReturnType<typeof setTimeout> | null = null;
let lockInProgressFromApp = false;
let currentLease: VaultSessionLease | null = null;

const beforeAutoLockHandlers = new Set<BeforeAutoLockHandler>();
const sessionSnapshotListeners = new Set<(state: VaultSessionState) => void>();
const activityListeners = new Set<() => void>();

function buildVaultSessionSnapshot(): VaultSessionState {
  const hasUserVaultKey = getSessionVaultKey() !== null;
  const unlocked = hasUnlockedVaultSession();
  return {
    status: unlocked ? "unlocked" : "locked",
    hasUserVaultKey,
    unlockedAt: unlocked ? unlockedAt : undefined,
    lastActivityAt: unlocked ? Date.now() - (getVaultAutoLockRemainingMs() ?? 0) : undefined,
    unlockMethod: unlocked ? unlockMethod : undefined,
    ownerId: unlocked ? currentLease?.ownerId : undefined,
    epoch: unlocked ? currentLease?.epoch : undefined,
  };
}

function notifyVaultSessionChange(): void {
  const snapshot = buildVaultSessionSnapshot();
  if (process.env.NODE_ENV === "development") {
    console.info(`vault session status changed: ${snapshot.status}`);
  }
  for (const listener of sessionSnapshotListeners) {
    listener(snapshot);
  }
}

function notifyActivityChange(): void {
  for (const listener of activityListeners) {
    listener();
  }
}

function clearPreLockTimer(): void {
  if (preLockTimer) {
    clearTimeout(preLockTimer);
    preLockTimer = null;
  }
}

async function runBeforeAutoLockHandlers(): Promise<void> {
  const handlers = [...beforeAutoLockHandlers];
  await Promise.all(handlers.map((handler) => handler()));
}

function schedulePreLockHandlers(): void {
  clearPreLockTimer();
  if (!hasUnlockedVaultSession() || autoLockSuspendCount > 0) return;
  const remaining = getVaultAutoLockRemainingMs();
  if (remaining === null) return;
  const fireIn = Math.max(0, remaining - 50);
  preLockTimer = setTimeout(() => {
    void runBeforeAutoLockHandlers();
  }, fireIn);
}

/** @internal tests and explicit timer refresh after unlock */
export function scheduleVaultAutoLock(): void {
  if (!hasUnlockedVaultSession() || autoLockSuspendCount > 0) return;
  coreScheduleVaultAutoLock(currentLease ?? undefined);
  notifyActivityChange();
  schedulePreLockHandlers();
}

export function getVaultSessionSnapshot(): VaultSessionState {
  return buildVaultSessionSnapshot();
}

export function getUserVaultKey(): CryptoKey | null {
  return getSessionVaultKey();
}

/** @deprecated Tests only — prefer unlockVaultSession / setUnlockedVaultSession. */
export async function setSessionVaultKey(key: CryptoKey | null): Promise<void> {
  if (key === null) {
    lockVaultSession();
    return;
  }
  await setUnlockedVaultSession({ userVaultKey: key, method: "password" });
}

export function lockVault(): void {
  unlockedAt = 0;
  unlockMethod = undefined;
}

export function hasUnlockedVaultSession(): boolean {
  return getSessionVaultKey() !== null && !isVaultManuallyLocked();
}

async function cacheRawVaultKeyMaterialForPasskeyEnroll(
  raw: Uint8Array,
  sessionKey: CryptoKey,
  operation?: VaultSessionOperation
): Promise<void> {
  const placeholderWrappingKey = await crypto.subtle.importKey(
    "raw",
    crypto.getRandomValues(new Uint8Array(32)),
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"]
  );
  await cacheVaultInnerKeyMaterialFromEnvelopeDecrypt(
    raw,
    placeholderWrappingKey,
    sessionKey,
    { operation }
  );
}

async function ensureNonExtractableSessionKey(
  key: CryptoKey,
  operation?: VaultSessionOperation
): Promise<CryptoKey> {
  try {
    await assertUserVaultKeyNonExtractable(key);
    return key;
  } catch {
    // Fresh setup / import provides an extractable UVK. Cache the raw inner material
    // (in memory only) before converting to a non-extractable session key, so passkey
    // enrollment can re-wrap it without the vault password.
    const raw = await exportUserVaultKey(key);
    await cacheRawVaultKeyMaterialForPasskeyEnroll(raw, key, operation);
    return importUserVaultKey(raw, { extractable: false });
  }
}

export async function setUnlockedVaultSession(args: {
  userVaultKey: CryptoKey;
  method: VaultUnlockMethod;
  operation?: VaultSessionOperation;
}): Promise<void> {
  lockedByInactivity = false;
  // Existing crypto unit tests intentionally exercise unscoped primitives. Once
  // one test opts into vault-core ownership, the package correctly fails closed
  // for subsequent unscoped mutations in that worker. Give those legacy test
  // calls a deterministic owner without weakening the production contract.
  const operation =
    args.operation ??
    (process.env.NODE_ENV === "test"
      ? coreBeginVaultSessionOperation("user-1")
      : undefined);
  const sessionKey = await ensureNonExtractableSessionKey(args.userVaultKey, operation);
  if (operation) assertVaultSessionOperationCurrent(operation);
  currentLease = await coreUnlockVaultSession(sessionKey, { operation });
  unlockedAt = Date.now();
  unlockMethod = args.method;
  if (process.env.NODE_ENV === "development") {
    console.info(`vault unlock method: ${args.method}`);
  }
  scheduleVaultAutoLock();
  notifyVaultSessionChange();
}

export async function unlockVaultSession(
  vaultKey: CryptoKey,
  method: VaultUnlockMethod = "password",
  operation?: VaultSessionOperation
): Promise<void> {
  await setUnlockedVaultSession({ userVaultKey: vaultKey, method, operation });
}

/** Starts one last-operation-wins browser mutation for an authenticated owner. */
export function beginVaultOwnerOperation(ownerId: string): VaultSessionOperation {
  return coreBeginVaultSessionOperation(ownerId);
}

/** Returns a key-bearing capability only while this owner still owns the installed epoch. */
export function getCurrentVaultSessionLease(ownerId: string): VaultSessionLease | null {
  if (currentLease && currentLease.ownerId === ownerId && isVaultSessionLeaseCurrent(currentLease)) {
    return currentLease;
  }
  try {
    currentLease = captureVaultSessionLease(ownerId);
    return currentLease;
  } catch {
    currentLease = null;
    return null;
  }
}

/** Logout/account replacement boundary. Synchronously invalidates every operation and lease. */
export function clearVaultSessionOwnerState(): void {
  currentLease = null;
  unlockedAt = 0;
  unlockMethod = undefined;
  lockedByInactivity = false;
  clearPreLockTimer();
  clearVaultAutoLockTimer();
  clearNoteBodyCache();
  coreClearVaultSessionOwner();
  notifyActivityChange();
  notifyVaultSessionChange();
}

export function clearVaultCoreClientState(): void {
  lockVault();
}

export function wasVaultLockedByInactivity(): boolean {
  return lockedByInactivity;
}

function handleCoreSessionChange(): void {
  if (
    !lockInProgressFromApp &&
    !isVaultUnlocked() &&
    unlockMethod !== undefined &&
    !lockedByInactivity
  ) {
    lockedByInactivity = true;
    clearNoteBodyCache();
    void onAutoLockCallback?.();
  }
  notifyVaultSessionChange();
}

coreSubscribeVaultSession(handleCoreSessionChange);

export function subscribeVaultSession(
  listener: (state: VaultSessionState) => void
): () => void {
  sessionSnapshotListeners.add(listener);
  listener(buildVaultSessionSnapshot());
  return () => {
    sessionSnapshotListeners.delete(listener);
  };
}

export function configureVaultAutoLock(callback?: () => void): void {
  onAutoLockCallback = callback ?? null;
}

export function registerVaultBeforeAutoLock(handler: BeforeAutoLockHandler): () => void {
  beforeAutoLockHandlers.add(handler);
  return () => beforeAutoLockHandlers.delete(handler);
}

export function subscribeVaultActivityTimer(listener: () => void): () => void {
  activityListeners.add(listener);
  return () => activityListeners.delete(listener);
}

export function suspendVaultAutoLock(): () => void {
  autoLockSuspendCount += 1;
  clearVaultAutoLockTimer();
  clearPreLockTimer();
  if (hasUnlockedVaultSession()) {
    notifyActivityChange();
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    autoLockSuspendCount = Math.max(0, autoLockSuspendCount - 1);
    if (autoLockSuspendCount === 0 && hasUnlockedVaultSession()) {
      scheduleVaultAutoLock();
    }
  };
}

export function touchVaultSession(): void {
  if (!hasUnlockedVaultSession() || autoLockSuspendCount > 0) return;
  coreTouchVaultSession(currentLease ?? undefined);
  notifyActivityChange();
  schedulePreLockHandlers();
}

export function lockVaultSession(reason: VaultLockReason = "manual"): void {
  lockInProgressFromApp = true;
  try {
    if (reason === "auto_lock") {
      lockedByInactivity = true;
      void onAutoLockCallback?.();
    } else if (reason === "manual" || reason === "error") {
      lockedByInactivity = false;
    } else if (reason === "logout" || reason === "account_switch") {
      lockedByInactivity = false;
    }

    clearPreLockTimer();
    clearVaultAutoLockTimer();
    notifyActivityChange();
    clearNoteBodyCache();
    unlockedAt = 0;
    unlockMethod = undefined;
    currentLease = null;
    if (reason === "logout" || reason === "account_switch") {
      coreClearVaultSessionOwner();
    } else {
      coreLockVaultSession();
    }
    notifyVaultSessionChange();
  } finally {
    lockInProgressFromApp = false;
  }
}

export function lockVaultSessionManually(): void {
  lockVaultSession("manual");
}

export function resetVaultSessionLockState(): void {
  lockedByInactivity = false;
  coreResetVaultSessionLockState();
  clearPreLockTimer();
  notifyActivityChange();
  notifyVaultSessionChange();
}

/** Configure the server-resolved admin baseline; the React preference provider applies user state. */
export function configureSelahkeepVaultSession(): void {
  const adminMinutes = getVaultAutoLockMinutesFromConfig();
  configureVaultSession({
    autoLockMinutes: adminMinutes,
  });
}

/** @internal tests */
export function resetVaultSessionStoreForTests(): void {
  lockedByInactivity = false;
  unlockedAt = 0;
  unlockMethod = undefined;
  currentLease = null;
  autoLockSuspendCount = 0;
  onAutoLockCallback = null;
  beforeAutoLockHandlers.clear();
  sessionSnapshotListeners.clear();
  activityListeners.clear();
  clearPreLockTimer();
  lockVault();
  coreClearVaultSessionOwner();
  coreResetVaultSessionLockState();
  configureSelahkeepVaultSession();
}
