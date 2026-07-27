"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  VaultUnlockPanel,
  useVaultUnlockPageNavigation,
} from "@tgoliveira/vault-core/react";
import { Alert } from "@/components/ui/alert";
import { PageLayout } from "@/components/layout/page-layout";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";
import { PageHeader } from "@/components/ui/page-header";
import { useVault } from "@/features/vault/use-vault";
import { useVaultClientStatus } from "@/features/vault/use-vault-client-status";
import { useVaultPasskeyUnlockPrefetch } from "@/features/passkey/use-vault-passkey-unlock-prefetch";
import { useVaultDockPasskeyAvailable } from "@/features/vault/vault-dock-passkey-availability";
import { VaultStatusPrompt } from "@/features/vault/vault-status-prompt";
import { readSelahkeepVaultUnlockReturnPath } from "@/lib/notes/safe-return-to";
import { getVaultUnlockRateLimiter } from "@/lib/vault/vault-rate-limit";
import { toVaultServerStatusSnapshot } from "@/lib/vault/vault-server-snapshot";
import { PRODUCT_NAME } from "@/lib/marketing/brand";
import { LegacyVaultUnlockPanel } from "@/features/vault/legacy-vault-unlock-panel";
import { useBrowserCapabilities } from "@/components/browser-capabilities-provider";
import { useApplicationState } from "@/components/application-state-provider";

export default function VaultUnlockPage() {
  const application = useApplicationState();
  const router = useRouter();
  const searchParams = useSearchParams();
  const afterUnlockPath = readSelahkeepVaultUnlockReturnPath(searchParams);
  const vaultClient = useVaultClientStatus();
  const capabilities = useBrowserCapabilities();
  const {
    loading,
    error,
    unlockFromPasskey,
    unlockFromRecoveryCode,
    unlockFromVaultPassword,
    unlockFromRecoveryPhrase,
  } = useVault();
  const serverStatusForPasskey = vaultClient.status === "ready" ? vaultClient.serverStatus : null;
  const passkeyAvailability = useVaultDockPasskeyAvailable(serverStatusForPasskey);
  const { prefetch, refresh } = useVaultPasskeyUnlockPrefetch(
    Boolean(application.ownerId) && passkeyAvailability.showPasskey
  );
  const rateLimitScopeKey = application.ownerId ?? "vault";

  const configured =
    vaultClient.status === "ready"
      ? vaultClient.clientStatus !== "not_configured" &&
        vaultClient.clientStatus !== "setup_incomplete"
      : null;

  useVaultUnlockPageNavigation({
    configured,
    returnPath: afterUnlockPath,
    setupPath: "/vault/setup",
    onNavigate: (path) => router.replace(path),
  });

  if (
    !application.ownerId ||
    vaultClient.status === "loading" ||
    capabilities.passkeyPrf.status === "checking"
  ) {
    return (
      <PageLayout width="narrow">
        <LoadingState label="Loading your vault" />
      </PageLayout>
    );
  }

  if (vaultClient.status === "error") {
    return (
      <PageLayout width="narrow">
        <ErrorState message={vaultClient.message} />
      </PageLayout>
    );
  }

  const { clientStatus, serverStatus } = vaultClient;

  if (clientStatus === "not_configured" || clientStatus === "setup_incomplete") {
    return (
      <PageLayout width="narrow">
        <PageHeader title={PRODUCT_NAME} description="Your private notes stay encrypted. Only you can unlock them." />
        <VaultStatusPrompt clientStatus={clientStatus} context="unlock" />
      </PageLayout>
    );
  }

  const snapshot = toVaultServerStatusSnapshot(serverStatus);
  const showLtgUnlock = serverStatus.setupComplete && serverStatus.vaultVersion === "vault-v2";
  const rateLimiter = getVaultUnlockRateLimiter();

  return (
    <PageLayout width="narrow">
      <PageHeader
        title={PRODUCT_NAME}
        description="Your private notes stay encrypted. Only you can unlock them."
      />
      {showLtgUnlock ? (
        <VaultUnlockPanel
          loading={loading}
          error={error}
          serverStatus={snapshot}
          prfSupported={capabilities.passkeyPrf.status === "supported"}
          passkeyReady={passkeyAvailability.showPasskey}
          unlockRateLimiter={rateLimiter}
          rateLimitScopeKey={rateLimitScopeKey}
          onUnlockPassword={async (password) => {
            await unlockFromVaultPassword(password);
            router.push(afterUnlockPath);
          }}
          onUnlockRecoveryPhrase={async (phrase) => {
            await unlockFromRecoveryPhrase(phrase);
            router.push(afterUnlockPath);
          }}
          onUnlockPasskey={
            passkeyAvailability.showPasskey
              ? async () => {
                  const latest = (await refresh()) ?? prefetch;
                  await unlockFromPasskey(latest?.options, latest?.credentialId);
                  router.push(afterUnlockPath);
                }
              : undefined
          }
          renderError={(message) => (
            <Alert variant="danger" title="Unlock failed">
              {message}
            </Alert>
          )}
        />
      ) : (
        <LegacyVaultUnlockPanel
          loading={loading}
          error={error}
          vaultStatus={serverStatus}
          onUnlockPasskey={async () => {
            await unlockFromPasskey();
            router.push(afterUnlockPath);
          }}
          onUnlockRecovery={unlockFromRecoveryCode}
          afterUnlockPath={afterUnlockPath}
          onNavigateAfterUnlock={(path) => router.push(path)}
        />
      )}
    </PageLayout>
  );
}
