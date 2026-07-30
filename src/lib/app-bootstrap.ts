import "server-only";

import type { Session } from "next-auth";
import type { SecureAuthUIPublicConfig } from "@tgoliveira/secure-auth/react";
import { getAppSession } from "@/lib/auth/session";
import { isFullyAuthenticatedSession } from "@/lib/auth/session-state";
import { isPlatformAdminUser } from "@/lib/auth/require-platform-admin";
import { readVaultDeviceBindingIdFromCookies } from "@/lib/passkey/vault-device-binding-cookie";
import { secureAuth } from "@/lib/secure-auth";
import { userRepository } from "@/server/repositories/user-repository";
import { vaultService } from "@/server/services/vault-service";
import type { VaultStatus } from "@/lib/api-client/vault";
import {
  SELAHKEEP_PREFERENCES_NAMESPACE,
  VAULT_AUTO_LOCK_MINUTES_PREFERENCE,
} from "@/lib/application-state/preference-keys";
import { resolvePortableVaultBrokerPublicConfig } from "@/lib/env/portable-vault-broker";

export type AppBootstrapSnapshot = {
  state: "ready";
  session: Session | null;
  ownerId: string | null;
  uiConfig: SecureAuthUIPublicConfig;
  vaultStatus: VaultStatus | null | "unavailable";
  vaultAutoLockUserMinutes: number | null | "unavailable";
  adminAccess: boolean;
  features: {
    preferences: boolean;
    portableVaultBroker: {
      enabled: boolean;
      brokerUrl: string;
    };
  };
};

function parsePositiveMinutes(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

async function resolveAutoLockPreference(userId: string): Promise<number | null> {
  const services = await secureAuth.getServices();
  if (!services.userPreferencesService.isEnabled()) return null;
  const snapshot = await services.userPreferencesService.list(
    userId,
    SELAHKEEP_PREFERENCES_NAMESPACE
  );
  return parsePositiveMinutes(snapshot.entries[VAULT_AUTO_LOCK_MINUTES_PREFERENCE]);
}

/**
 * Resolves the complete non-secret first-frame state on the server. Decrypted notes,
 * vault keys, wrapped resource keys, drafts, attachments, and private indexes are
 * deliberately outside this module and may never be added to this snapshot.
 */
export async function resolveAppBootstrap(): Promise<AppBootstrapSnapshot> {
  const session = await getAppSession();
  // A 2FA-pending account session is deliberately not an application owner yet.
  // This prevents vault metadata from entering the bootstrap before the account
  // authentication boundary is complete.
  const ownerId = isFullyAuthenticatedSession(session) ? (session?.user?.id ?? null) : null;
  // Resolved (not static) so admin panel overrides such as `ui.login.twoStep` reach the client.
  const uiConfig = await secureAuth.getResolvedUIConfig();
  const portableVaultBroker = resolvePortableVaultBrokerPublicConfig();

  if (!ownerId) {
    return {
      state: "ready",
      session,
      ownerId: null,
      uiConfig,
      vaultStatus: null,
      vaultAutoLockUserMinutes: null,
      adminAccess: false,
      features: {
        preferences: uiConfig.preferences?.enabled === true,
        portableVaultBroker,
      },
    };
  }

  const deviceBindingId = await readVaultDeviceBindingIdFromCookies();
  const [accountResult, vaultResult, preferenceResult] = await Promise.allSettled([
    userRepository.findById(ownerId),
    vaultService.getStatus(ownerId, deviceBindingId),
    resolveAutoLockPreference(ownerId),
  ]);

  // Identity is the ownership root. Never render an authenticated tree when it
  // cannot be tied to the same durable account row.
  if (accountResult.status === "rejected" || !accountResult.value) {
    throw new Error("Account bootstrap is temporarily unavailable", {
      cause: accountResult.status === "rejected" ? accountResult.reason : undefined,
    });
  }

  return {
    state: "ready",
    session,
    ownerId,
    uiConfig,
    vaultStatus: vaultResult.status === "fulfilled" ? vaultResult.value : "unavailable",
    vaultAutoLockUserMinutes:
      preferenceResult.status === "fulfilled" ? preferenceResult.value : "unavailable",
    adminAccess: isPlatformAdminUser(accountResult.value, process.env),
    features: {
      preferences: uiConfig.preferences?.enabled === true,
      portableVaultBroker,
    },
  };
}
