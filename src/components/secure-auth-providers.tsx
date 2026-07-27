"use client";

import { SecureAuthUIProvider } from "@tgoliveira/secure-auth/react";
import { SessionProvider } from "next-auth/react";
import { VaultProviders } from "@/components/vault-providers";
import { AppBootstrapBoundary } from "@/components/app-bootstrap-boundary";
import { ApplicationStateProvider } from "@/components/application-state-provider";
import { BrowserCapabilitiesProvider } from "@/components/browser-capabilities-provider";
import type { AppBootstrapSnapshot } from "@/lib/app-bootstrap";

export function SecureAuthProviders({
  bootstrap,
  children,
}: {
  bootstrap: AppBootstrapSnapshot;
  children: React.ReactNode;
}) {
  const pollSeconds = bootstrap.uiConfig.sessionPolicy.revocationPollIntervalSeconds;
  const refetchInterval = pollSeconds > 0 ? pollSeconds : undefined;

  return (
    <SessionProvider session={bootstrap.session} refetchInterval={refetchInterval}>
      <AppBootstrapBoundary initialOwnerId={bootstrap.ownerId}>
        <ApplicationStateProvider
          value={{
            ownerId: bootstrap.ownerId,
            session: bootstrap.session,
            vaultStatus: bootstrap.vaultStatus,
            vaultAutoLockUserMinutes: bootstrap.vaultAutoLockUserMinutes,
            adminAccess: bootstrap.adminAccess,
            features: bootstrap.features,
          }}
        >
          <SecureAuthUIProvider config={bootstrap.uiConfig}>
            <BrowserCapabilitiesProvider>
              <VaultProviders>{children}</VaultProviders>
            </BrowserCapabilitiesProvider>
          </SecureAuthUIProvider>
        </ApplicationStateProvider>
      </AppBootstrapBoundary>
    </SessionProvider>
  );
}
