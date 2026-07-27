"use client";

import Link from "next/link";
import { useState } from "react";
import { AuthenticatedPage } from "@/components/layout/authenticated-page";
import { PageLayout } from "@/components/layout/page-layout";
import { PageHeader } from "@/components/ui/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { LoadingState } from "@/components/ui/loading-state";
import { ErrorState } from "@/components/ui/error-state";
import { useRequireVault } from "@/features/vault/use-require-vault";
import { useVaultClientStatus } from "@/features/vault/use-vault-client-status";
import { VaultAutoLockPreferenceField } from "@tgoliveira/vault-core/react";
import { getVaultAdminConfig, getVaultAutoLockMinutesFromConfig } from "@/lib/env/vault-from-env";
import { useSelahkeepVaultAutoLockPreference } from "@/components/vault-providers";
import { VaultStatusPrompt } from "@/features/vault/vault-status-prompt";
import { useVaultSettings } from "@/features/notes/use-vault-settings";
import type { VaultUnlockBehavior } from "@/lib/crypto-client/vault-settings";
import { applyUnlockBehavior } from "@/features/notes/eager-decrypt-notes";
import { PasskeyVaultUnlockSetup } from "@/features/passkey/passkey-vault-unlock-setup";
import { VAULT_PASSKEY_SECTION_INTRO } from "@/lib/passkey/vault-passkey-availability-messages";
import { StorageUsageDisplay } from "@/components/notes/storage-usage-display";
import { useStorageUsage } from "@/features/notes/use-storage-usage";

const OPTIONS: Array<{
  value: VaultUnlockBehavior;
  title: string;
  description: string;
}> = [
  {
    value: "metadata_only",
    title: "Metadata only (recommended)",
    description:
      "After unlock, decrypt note titles and organization data for search and filters. Note bodies decrypt only when you open a note. Lower memory use and faster unlock.",
  },
  {
    value: "decrypt_all",
    title: "Decrypt all note bodies",
    description:
      "After unlock, eagerly decrypt every note body in memory. Faster browsing when opening notes, but higher memory exposure on this device until you lock the vault.",
  },
];

function VaultAutoLockSettings() {
  const adminMinutes = getVaultAutoLockMinutesFromConfig();
  const preference = useSelahkeepVaultAutoLockPreference();

  if (preference.resolutionStatus === "unavailable") {
    return (
      <ErrorState
        message="Auto-lock preferences are temporarily unavailable. The vault is using the safest timeout."
      />
    );
  }

  return (
    <VaultAutoLockPreferenceField
      value={preference.minutes}
      onChange={preference.setMinutes}
      adminMaxMinutes={preference.adminMaxMinutes}
      minMinutes={preference.minMinutes}
      adminDefaultMinutes={adminMinutes}
      usingUserPreference={preference.usingUserPreference}
    />
  );
}

export default function VaultSettingsPage() {
  const vault = useRequireVault();
  const vaultClient = useVaultClientStatus();
  const userId = vault.status === "ready" ? vault.userId : null;
  const vaultUnlocked = vault.status === "ready" ? vault.vaultUnlocked : false;
  const clientStatus =
    vaultClient.status === "ready" ? vaultClient.clientStatus : null;
  const { settings, loading, error, updateUnlockBehavior } = useVaultSettings(userId, vaultUnlocked);
  const { usage: storageUsage, loading: storageLoading } = useStorageUsage(
    Boolean(vaultUnlocked && clientStatus === "unlocked")
  );
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSelect(behavior: VaultUnlockBehavior) {
    if (!settings || settings.unlockBehavior === behavior) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await updateUnlockBehavior(behavior);
      if (userId) {
        await applyUnlockBehavior(userId);
      }
      setSaved(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  if (vault.status === "loading" || vault.status === "redirecting" || vaultClient.status === "loading") {
    return (
      <PageLayout>
        <LoadingState label="Loading vault settings" />
      </PageLayout>
    );
  }

  if (vault.status === "error" || vaultClient.status === "error") {
    return (
      <PageLayout>
        <ErrorState
          message={
            vault.status === "error"
              ? vault.message
              : vaultClient.status === "error"
                ? vaultClient.message
                : "Failed to load vault settings"
          }
        />
      </PageLayout>
    );
  }

  if (clientStatus && clientStatus !== "unlocked") {
    return (
      <PageLayout>
        <PageHeader
          title="Vault settings"
          description="Control how your vault behaves after unlock on this device."
        />
        {clientStatus !== "locked" ? (
          <VaultStatusPrompt
            clientStatus={clientStatus}
            context="settings"
            returnTo="/vault/settings"
          />
        ) : null}
      </PageLayout>
    );
  }

  return (
    <AuthenticatedPage width="settings">
      <PageHeader
        title="Vault settings"
        description="Control how your vault behaves after unlock on this device."
      />

      {loading ? (
        <LoadingState label="Loading settings" />
      ) : (
        <div className="space-y-4">
          <Card className="space-y-3 border-dashed p-5" data-testid="vault-storage-usage-card">
            <h2 className="font-medium">Encrypted storage</h2>
            <StorageUsageDisplay usage={storageUsage} loading={storageLoading} />
          </Card>

          <Card className="space-y-3 border-dashed p-5">
            <h2 className="font-medium">Vault security review</h2>
            <p className="text-sm text-[var(--muted)]">
              Review your vault protection, recovery readiness, passkey compatibility, and recent vault
              security events.
            </p>
            <Link href="/vault/security">
              <Button variant="secondary" className="w-full sm:w-auto">
                Open security review
              </Button>
            </Link>
          </Card>

          {error && <ErrorState message={error} />}
          {saveError && (
            <Alert variant="danger" role="alert">
              {saveError}
            </Alert>
          )}
          {saved && (
            <Alert variant="success" title="Saved">
              Unlock behavior updated for this vault.
            </Alert>
          )}

          <Card className="space-y-3 border-dashed p-5">
            <VaultAutoLockSettings />
          </Card>

          <Card className="space-y-3 border-dashed">
            <h2 className="font-medium">Passkey vault unlock</h2>
            <p className="text-sm text-[var(--muted)]">{VAULT_PASSKEY_SECTION_INTRO}</p>
            {userId && (
              <PasskeyVaultUnlockSetup userId={userId} vaultUnlocked={vaultUnlocked} />
            )}
          </Card>

          <Card className="space-y-3 border-dashed">
            <h2 className="font-medium">Recovery phrase</h2>
            <p className="text-sm text-[var(--muted)]">
              Your recovery phrase is created during vault setup. Replace it from the recovery page
              while your vault is unlocked.
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Link href="/vault/recovery">
                <Button variant="secondary" className="w-full sm:w-auto">
                  Recovery options
                </Button>
              </Link>
            </div>
          </Card>

          <Card className="space-y-2 border-dashed">
            <h2 className="font-medium">Import and export</h2>
            <p className="text-sm text-[var(--muted)]">
              Bulk import and export of decrypted notes are not available in this MVP. Your notes
              stay encrypted on our servers and can only be read after you unlock your vault in the
              browser.
            </p>
          </Card>

          {OPTIONS.map((option) => {
            const selected = settings?.unlockBehavior === option.value;
            return (
              <Card
                key={option.value}
                className={`space-y-2 ${selected ? "ring-2 ring-[var(--primary)]" : ""}`}
              >
                <h2 className="font-medium">{option.title}</h2>
                <p className="text-sm text-[var(--muted)]">{option.description}</p>
                <Button
                  variant={selected ? undefined : "secondary"}
                  disabled={saving || selected}
                  onClick={() => handleSelect(option.value)}
                >
                  {selected ? "Current setting" : "Use this setting"}
                </Button>
              </Card>
            );
          })}
        </div>
      )}
    </AuthenticatedPage>
  );
}
