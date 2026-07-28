"use client";

import { useMemo, useState } from "react";
import { SecuritySettingsPage } from "@tgoliveira/secure-auth/react";
import type { AccountPasskeyRegistrationHooks } from "@tgoliveira/secure-auth/react/client";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import type { EncryptedPayload as VaultCoreEncryptedPayload } from "@tgoliveira/vault-core";
import { APP_PASSKEY_SLUG } from "@/lib/passkey/app-slug";
import { getSessionVaultKey } from "@/lib/crypto-client/vault";
import { wrapVaultKeyForPasskey } from "@/lib/crypto-client/passkey-vault";
import { unlockVaultFromPasskeyEnvelopeCandidates } from "@/lib/crypto-client/passkey-vault";
import { apiClient } from "@/lib/api-client/client";
import { persistVaultPasskeyBinding } from "@/lib/passkey/vault-unlock-authenticate";
import { currentDeviceLabel } from "@/lib/passkey/device-label";
import {
  beginVaultOwnerOperation,
} from "@/lib/crypto-client/vault-session";
import { assertVaultSessionOperationCurrent } from "@tgoliveira/vault-core/browser";
import { useVaultSessionUnlocked } from "@/features/vault/use-vault-session-unlocked";
import type { EncryptedPayload } from "@/lib/validation/encrypted-payload";
import { prepareVaultRegistrationOptions } from "@/lib/passkey/prepare-webauthn-options";
import { runAuthenticationConfirmedPasskeyEnrollment } from "@/lib/passkey/authentication-confirmed-enrollment";
import { isCeremonyCancellation } from "@/lib/passkey/passkey-prf-diagnostics";
import { PASSKEY_VAULT_CONFIRMATION_CANCELLED_MESSAGE } from "@/lib/passkey/messages";

export function AccountPasskeySecuritySettings({ userId }: { userId: string }) {
  const vaultUnlocked = useVaultSessionUnlocked();
  const [shareNewPasskeyWithVault, setShareNewPasskeyWithVault] = useState(false);

  const registrationHooks = useMemo<AccountPasskeyRegistrationHooks | undefined>(() => {
    if (!shareNewPasskeyWithVault || !vaultUnlocked) return undefined;

    return {
      prepareOptions: (serverOptions) => prepareVaultRegistrationOptions(serverOptions, userId),
      onVerified: async ({
        registrationCredentialId,
        verifiedCredentialId,
        clientExtensionResults,
      }) => {
        const vaultKey = getSessionVaultKey();
        if (!vaultKey) throw new Error("Unlock the vault before sharing this passkey.");

        const operation = beginVaultOwnerOperation(userId);
        let enrollment;
        try {
          enrollment = await runAuthenticationConfirmedPasskeyEnrollment({
            userId,
            registrationCredentialId,
            verifiedRegistrationCredentialId: verifiedCredentialId,
            registrationClientExtensionResults:
              clientExtensionResults as Record<string, unknown>,
            requestAuthenticationOptions: async (credentialId) =>
              apiClient.post<PublicKeyCredentialRequestOptionsJSON>(
                "/api/passkeys/account-registration-vault",
                { action: "options", verifiedCredentialId: credentialId }
              ),
            verifyAuthentication: async (credentialId, response) =>
              apiClient.post("/api/passkeys/account-registration-vault", {
                action: "verify",
                verifiedCredentialId: credentialId,
                response,
              }),
          });
        } catch (error) {
          if (isCeremonyCancellation(error)) {
            throw new Error(PASSKEY_VAULT_CONFIRMATION_CANCELLED_MESSAGE);
          }
          throw error;
        }
        assertVaultSessionOperationCurrent(operation);
        try {
          const encryptedVaultKey: EncryptedPayload = await wrapVaultKeyForPasskey(
            vaultKey,
            enrollment.prfOutput,
            userId,
            userId,
            operation
          );
          assertVaultSessionOperationCurrent(operation);
          const persisted = await apiClient.post<{
            verifiedCredentialId: string;
            envelopeVariantId: string;
            bindingProof: string;
          }>("/api/passkeys/account-registration-vault", {
            action: "persist",
            verifiedCredentialId: enrollment.verifiedCredentialId,
            enrollmentProof: enrollment.enrollmentProof,
            encryptedVaultKey,
            prfSupported: true,
          });
          assertVaultSessionOperationCurrent(operation);
          if (persisted.verifiedCredentialId !== enrollment.verifiedCredentialId) {
            throw new Error("Persisted passkey credential mismatch.");
          }

          const match = await unlockVaultFromPasskeyEnvelopeCandidates({
            userId,
            verifiedCredentialId: persisted.verifiedCredentialId,
            candidates: [
              {
                envelopeVariantId: persisted.envelopeVariantId,
                credentialId: persisted.verifiedCredentialId,
                envelope: {
                  method: "passkey_prf",
                  encryptedVaultKey: encryptedVaultKey as VaultCoreEncryptedPayload,
                  kdfMetadata: null,
                  publicMetadata: {
                    credentialId: persisted.verifiedCredentialId,
                    prfRequired: true,
                    prfCeremony: "authentication",
                  },
                },
              },
            ],
            prfOutput: enrollment.prfOutput,
            applySession: false,
            cacheInnerKey: false,
            operation,
          });
          assertVaultSessionOperationCurrent(operation);
          if (match.status !== "matched") {
            throw new Error("The new passkey vault envelope could not be verified locally.");
          }
          await persistVaultPasskeyBinding({
            bindingProof: persisted.bindingProof,
            verifiedCredentialId: persisted.verifiedCredentialId,
            selectedEnvelopeVariantId: match.envelopeVariantId,
            deviceLabel: currentDeviceLabel(),
          });
          assertVaultSessionOperationCurrent(operation);
        } finally {
          enrollment.prfOutput.fill(0);
        }
      },
    };
  }, [shareNewPasskeyWithVault, userId, vaultUnlocked]);

  return (
    <div className="space-y-4">
      <label className="flex items-start gap-3 rounded-[var(--radius)] border border-[var(--border)] p-3 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={shareNewPasskeyWithVault}
          disabled={!vaultUnlocked}
          onChange={(event) => setShareNewPasskeyWithVault(event.target.checked)}
        />
        <span>
          <span className="block font-medium text-[var(--foreground)]">
            Also use the next passkey for vault unlock
          </span>
          <span className="text-[var(--muted)]">
            Optional. Creates an account sign-in passkey, then asks you to authenticate with that
            exact passkey once before vault unlock is enabled. The capabilities remain independent,
            and your vault must already be unlocked.
          </span>
        </span>
      </label>
      <SecuritySettingsPage
        appSlug={APP_PASSKEY_SLUG}
        userId={userId}
        passkeyRegistrationHooks={registrationHooks}
        allowPasskeySignInCapabilityPromotion
      />
    </div>
  );
}
