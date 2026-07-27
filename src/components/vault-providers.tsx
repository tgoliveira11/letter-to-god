"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  VaultSessionProvider,
  useVaultAutoLockPreference,
  type UseVaultAutoLockPreferenceResult,
} from "@tgoliveira/vault-core/react";
import { VAULT_USER_AUTO_LOCK_MIN_MINUTES, type VaultSessionLease } from "@tgoliveira/vault-core/browser";
import { configureSelahkeepVaultSession } from "@/lib/crypto-client/vault-session";
import { registerSelahkeepVaultLockCleanup } from "@/lib/vault/register-selahkeep-vault-lock-cleanup";
import { getVaultAutoLockMinutesFromConfig } from "@/lib/env/vault-from-env";
import {
  getCurrentVaultSessionLease,
  subscribeVaultSession,
} from "@/lib/crypto-client/vault-session";
import { useApplicationState } from "@/components/application-state-provider";
import {
  SELAHKEEP_PREFERENCES_NAMESPACE,
  VAULT_AUTO_LOCK_MINUTES_PREFERENCE,
} from "@/lib/application-state/preference-keys";

configureSelahkeepVaultSession();
registerSelahkeepVaultLockCleanup();

type SelahkeepAutoLockPreference = UseVaultAutoLockPreferenceResult & {
  resolutionStatus: "ready" | "unavailable";
  retryResolution: () => void;
};

const AutoLockPreferenceContext = createContext<SelahkeepAutoLockPreference | null>(null);

async function persistAutoLockPreference(value: number | null): Promise<void> {
  const response = await fetch(
    `/api/account/preferences/${encodeURIComponent(VAULT_AUTO_LOCK_MINUTES_PREFERENCE)}?namespace=${encodeURIComponent(SELAHKEEP_PREFERENCES_NAMESPACE)}`,
    {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    }
  );
  if (!response.ok) throw new Error("Could not persist the vault auto-lock preference");
}

function resolveFailClosedPreference(input: {
  initialUserMinutes: number | null | "unavailable";
  adminMinutes: number;
}) {
  if (input.initialUserMinutes === "unavailable") {
    return {
      adminMinutes: VAULT_USER_AUTO_LOCK_MIN_MINUTES,
      initialUserMinutes: VAULT_USER_AUTO_LOCK_MIN_MINUTES,
      resolutionStatus: "unavailable" as const,
    };
  }
  return {
    adminMinutes: input.adminMinutes,
    initialUserMinutes: input.initialUserMinutes,
    resolutionStatus: "ready" as const,
  };
}

export function VaultProviders({ children }: { children: ReactNode }) {
  const application = useApplicationState();
  const adminMinutes = getVaultAutoLockMinutesFromConfig();
  const [lease, setLease] = useState<VaultSessionLease | null>(() =>
    application.ownerId ? getCurrentVaultSessionLease(application.ownerId) : null
  );
  const resolved = resolveFailClosedPreference({
    initialUserMinutes: application.vaultAutoLockUserMinutes,
    adminMinutes,
  });
  const preference = useVaultAutoLockPreference(resolved.adminMinutes, {
    initialUserMinutes: resolved.initialUserMinutes,
    sessionLease: lease,
  });

  useEffect(
    () =>
      subscribeVaultSession(() => {
        setLease(
          application.ownerId ? getCurrentVaultSessionLease(application.ownerId) : null
        );
      }),
    [application.ownerId]
  );

  const setMinutes = useCallback(
    (minutes: number) => {
      preference.setMinutes(minutes);
      if (application.ownerId && application.features.preferences) {
        void persistAutoLockPreference(minutes).catch(() => undefined);
      }
    },
    [application.features.preferences, application.ownerId, preference]
  );

  const resetToAdminDefault = useCallback(() => {
    preference.resetToAdminDefault();
    if (application.ownerId && application.features.preferences) {
      void persistAutoLockPreference(null).catch(() => undefined);
    }
  }, [application.features.preferences, application.ownerId, preference]);

  const value = useMemo<SelahkeepAutoLockPreference>(
    () => ({
      ...preference,
      setMinutes,
      resetToAdminDefault,
      resolutionStatus: resolved.resolutionStatus,
      retryResolution: () => window.location.reload(),
    }),
    [preference, resetToAdminDefault, resolved.resolutionStatus, setMinutes]
  );

  return (
    <VaultSessionProvider
      sessionConfig={{
        autoLockMinutes: resolved.adminMinutes,
      }}
      registerUnloadGuard
      registerActivityGuard={false}
      lease={lease ?? undefined}
    >
      <AutoLockPreferenceContext.Provider value={value}>
        {children}
      </AutoLockPreferenceContext.Provider>
    </VaultSessionProvider>
  );
}

export function useSelahkeepVaultAutoLockPreference(): SelahkeepAutoLockPreference {
  const value = useContext(AutoLockPreferenceContext);
  if (!value) throw new Error("VaultProviders is missing");
  return value;
}
