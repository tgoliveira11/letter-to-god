"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Session } from "next-auth";
import type { VaultStatus } from "@/lib/api-client/vault";

export type ApplicationState = {
  ownerId: string | null;
  session: Session | null;
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

const ApplicationStateContext = createContext<ApplicationState | null>(null);

export function ApplicationStateProvider({
  value,
  children,
}: {
  value: ApplicationState;
  children: ReactNode;
}) {
  return (
    <ApplicationStateContext.Provider value={value}>
      {children}
    </ApplicationStateContext.Provider>
  );
}

export function useApplicationState(): ApplicationState {
  const state = useContext(ApplicationStateContext);
  if (!state) throw new Error("ApplicationStateProvider is missing");
  return state;
}
