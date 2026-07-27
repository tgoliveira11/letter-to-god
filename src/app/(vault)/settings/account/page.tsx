"use client";

import Link from "next/link";
import { AccountSettingsPage, SecuritySettingsPage } from "@tgoliveira/secure-auth/react";
import { defaultSignOutAccount, signOutWithRedirect } from "@tgoliveira/secure-auth/react/client";
import { Button } from "@/components/ui/button";
import { AuthenticatedPage } from "@/components/layout/authenticated-page";
import { PageHeader } from "@/components/ui/page-header";
import { SettingsSection } from "@/components/ui/settings-section";
import { APP_PASSKEY_SLUG } from "@/lib/passkey/app-slug";
import { clearVaultClientState } from "@/lib/crypto-client/vault";
import { ACCOUNT_DELETION_VAULT_NOTE } from "@/lib/account-auth-messages";
import { Alert } from "@/components/ui/alert";
import { useApplicationState } from "@/components/application-state-provider";

export default function AccountSettingsPageWrapper() {
  const { ownerId } = useApplicationState();

  return (
    <AuthenticatedPage width="settings">
      <PageHeader
        title="Account settings"
        description="Manage sign-in, security, and account lifecycle for SelahKeep."
      />

      <div className="authenticated-page__sections space-y-5">
        <SettingsSection
          title="Account"
          description="Your sign-in email and account lifecycle."
          suppressPackageHeading
          className="scroll-mt-8"
        >
          <Alert variant="warning" title="Before you delete your account" className="mb-4">
            {ACCOUNT_DELETION_VAULT_NOTE}
          </Alert>
          <AccountSettingsPage
            appSlug={APP_PASSKEY_SLUG}
            afterDeletePath="/account-deleted"
            onSignOut={async () => {
              if (ownerId) {
                try {
                  await clearVaultClientState(ownerId);
                } catch {
                  // Continue sign-out even if local vault cleanup fails.
                }
              }
              await defaultSignOutAccount();
              signOutWithRedirect("/");
            }}
          />
        </SettingsSection>

        <SettingsSection
          id="security"
          title="Security"
          description="Password, two-factor authentication, and account passkeys for sign-in."
        >
          <SecuritySettingsPage appSlug={APP_PASSKEY_SLUG} />
        </SettingsSection>

        <SettingsSection>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h2 className="font-medium text-[var(--foreground)]">AI integrations</h2>
              <p className="text-sm text-[var(--muted)]">
                Connect Cursor, Claude Desktop, or Codex to selected notes and boards via MCP.
              </p>
            </div>
            <Link href="/settings/integrations" className="shrink-0">
              <Button variant="secondary" className="w-full sm:w-auto">
                Manage integrations
              </Button>
            </Link>
          </div>
        </SettingsSection>

        <SettingsSection>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <h2 className="font-medium text-[var(--foreground)]">Vault protection</h2>
              <p className="text-sm text-[var(--muted)]">
                Passkey vault unlock, recovery phrase, and unlock behavior are managed separately
                from account sign-in.
              </p>
            </div>
            <Link href="/vault/settings" className="shrink-0">
              <Button variant="secondary" className="w-full sm:w-auto">
                Open vault settings
              </Button>
            </Link>
          </div>
        </SettingsSection>
      </div>
    </AuthenticatedPage>
  );
}
