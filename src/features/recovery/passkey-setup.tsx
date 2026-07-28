"use client";

import { useState } from "react";
import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SuccessState } from "@/components/ui/success-state";
import { getSessionVaultKey } from "@/lib/crypto-client/vault";
import {
  unlockVaultFromPasskeyEnvelopeCandidates,
  wrapVaultKeyForPasskey,
} from "@/lib/crypto-client/passkey-vault";
import { apiClient } from "@/lib/api-client/client";
import { passkeysApi } from "@/lib/api-client/passkeys";
import { prepareVaultRegistrationOptions } from "@/lib/passkey/prepare-webauthn-options";
import { toPasskeyRegistrationErrorMessage } from "@/lib/passkey/webauthn-config";
import {
  getPasskeyPrfDiagnosticHeadline,
  getPasskeyPrfDiagnosticMessage,
  isCeremonyCancellation,
  probePasskeyPrfEnvironmentAsync,
  resolvePreCeremonyDiagnosticReason,
  shouldBlockPasskeyVaultSetupBeforeCeremony,
  type PasskeyPrfDiagnosticReason,
} from "@/lib/passkey/passkey-prf-diagnostics";
import { setPasskeyLoginHint } from "@/lib/passkey/login-hint";
import { currentDeviceLabel } from "@/lib/passkey/device-label";
import {
  PASSKEY_ORPHAN_CREDENTIAL_NOTE,
  PASSKEY_VAULT_CONFIRMATION_CANCELLED_MESSAGE,
  PASSKEY_VAULT_REGISTERED_MESSAGE,
  type PasskeySetupOutcome,
} from "@/lib/passkey/messages";
import { persistVaultPasskeyBinding } from "@/lib/passkey/vault-unlock-authenticate";
import { sanitizeWebAuthnResponseForServer } from "@/lib/crypto-client/vault-passkey-browser";
import type { EncryptedPayload as VaultCoreEncryptedPayload } from "@tgoliveira/vault-core";
import {
  assertVaultSessionLeaseCurrent,
  assertVaultSessionOperationCurrent,
  VaultSessionOperationCancelledError,
} from "@tgoliveira/vault-core/browser";
import {
  beginVaultOwnerOperation,
  getCurrentVaultSessionLease,
} from "@/lib/crypto-client/vault-session";
import {
  PasskeyAuthenticationPrfUnavailableError,
  runAuthenticationConfirmedPasskeyEnrollment,
} from "@/lib/passkey/authentication-confirmed-enrollment";

interface PasskeySetupProps {
  userId: string;
  hasPasskey: boolean;
  onStatusChange: () => void;
}

export function PasskeySetup({ userId, hasPasskey, onStatusChange }: PasskeySetupProps) {
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<PasskeySetupOutcome>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticReason, setDiagnosticReason] = useState<PasskeyPrfDiagnosticReason | null>(null);
  const [showOrphanNote, setShowOrphanNote] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);

  function showDiagnosticOutcome(reason: PasskeyPrfDiagnosticReason, options?: { attemptedRegistration?: boolean }) {
    setOutcome("prf-unavailable");
    setDiagnosticReason(reason);
    setError(null);
    setMessage(getPasskeyPrfDiagnosticMessage(reason));
    setShowOrphanNote(Boolean(options?.attemptedRegistration));
  }

  async function handleRegisterPasskey() {
    let ownedPrfOutput: Uint8Array | null = null;
    let registrationVerified = false;
    setLoading(true);
    setError(null);
    setMessage(null);
    setShowOrphanNote(false);
    setOutcome("idle");
    setDiagnosticReason(null);

    try {
      const vaultKey = getSessionVaultKey();
      if (!vaultKey) {
        throw new Error("Unlock your vault before setting up a passkey.");
      }
      const operation = beginVaultOwnerOperation(userId);

      const environment = await probePasskeyPrfEnvironmentAsync();
      assertVaultSessionOperationCurrent(operation);
      if (shouldBlockPasskeyVaultSetupBeforeCeremony(environment)) {
        const reason = resolvePreCeremonyDiagnosticReason(environment)!;
        showDiagnosticOutcome(reason);
        return;
      }

      // Step 1: register the vault-only credential WITHOUT an envelope.
      const options = (await apiClient.post("/api/passkeys/register", {
        action: "options",
        vaultOnly: true,
      })) as PublicKeyCredentialCreationOptionsJSON;
      assertVaultSessionOperationCurrent(operation);

      let attestation;
      try {
        const preparedOptions = await prepareVaultRegistrationOptions(options, userId);
        assertVaultSessionOperationCurrent(operation);
        attestation = await startRegistration({
          optionsJSON: preparedOptions,
        });
        assertVaultSessionOperationCurrent(operation);
      } catch (ceremonyError) {
        if (isCeremonyCancellation(ceremonyError)) {
          setOutcome("cancelled");
          setError(getPasskeyPrfDiagnosticMessage("ceremony_cancelled"));
          return;
        }
        throw ceremonyError;
      }

      const registration = await apiClient.post<{
        verified: boolean;
        credentialId?: string;
        verifiedCredentialId?: string;
        credentialDbId?: string;
      }>("/api/passkeys/register", {
        action: "verify",
        response: sanitizeWebAuthnResponseForServer(attestation),
        vaultOnly: true,
        friendlyName: currentDeviceLabel(),
      });

      const credentialDbId = registration.credentialDbId;
      if (
        !credentialDbId ||
        registration.verifiedCredentialId !== attestation.id
      ) {
        throw new Error("Passkey registration failed");
      }
      registrationVerified = true;
      const enablePath = `/api/account/passkeys/${credentialDbId}/enable-vault-unlock`;
      const authenticationEnrollment = await runAuthenticationConfirmedPasskeyEnrollment({
        userId,
        registrationCredentialId: attestation.id,
        verifiedRegistrationCredentialId: registration.verifiedCredentialId,
        registrationClientExtensionResults:
          attestation.clientExtensionResults as Record<string, unknown>,
        requestAuthenticationOptions: async () =>
          apiClient.post<PublicKeyCredentialRequestOptionsJSON>(enablePath, {
            action: "options",
          }),
        verifyAuthentication: async (_verifiedCredentialId, response) =>
          apiClient.post(enablePath, { action: "verify", response }),
      });
      assertVaultSessionOperationCurrent(operation);
      ownedPrfOutput = authenticationEnrollment.prfOutput;
      const prfOutput = authenticationEnrollment.prfOutput;
      const verifiedCredentialId = authenticationEnrollment.verifiedCredentialId;

      const encryptedVaultKey = await wrapVaultKeyForPasskey(
        vaultKey,
        prfOutput,
        userId,
        userId,
        operation
      );
      assertVaultSessionOperationCurrent(operation);

      const result = await apiClient.post<{
        success?: boolean;
        verifiedCredentialId: string;
        envelopeVariantId: string;
        bindingProof: string;
      }>(enablePath, {
        action: "persist",
        enrollmentProof: authenticationEnrollment.enrollmentProof,
        encryptedVaultKey,
        prfSupported: true,
      });
      assertVaultSessionOperationCurrent(operation);

      if (result.success) {
        const match = await unlockVaultFromPasskeyEnvelopeCandidates({
          userId,
          verifiedCredentialId,
          candidates: [{
            envelopeVariantId: result.envelopeVariantId,
            credentialId: result.verifiedCredentialId,
            envelope: {
              method: "passkey_prf",
              encryptedVaultKey: encryptedVaultKey as VaultCoreEncryptedPayload,
              kdfMetadata: null,
              publicMetadata: {
                credentialId: result.verifiedCredentialId,
                prfRequired: true,
                prfCeremony: "authentication",
              },
            },
          }],
          prfOutput,
          applySession: false,
          operation,
          cacheInnerKey: false,
        });
        assertVaultSessionOperationCurrent(operation);
        if (match.status !== "matched") {
          throw new Error("The new passkey envelope could not be verified locally.");
        }
        await persistVaultPasskeyBinding({
          bindingProof: result.bindingProof,
          verifiedCredentialId: result.verifiedCredentialId,
          selectedEnvelopeVariantId: match.envelopeVariantId,
          deviceLabel: currentDeviceLabel(),
        });
        setPasskeyLoginHint({
          userId,
          credentialId: registration.credentialId,
        });
        setOutcome("vault-registered");
        setMessage(PASSKEY_VAULT_REGISTERED_MESSAGE);
        onStatusChange();
      }
    } catch (e) {
      if (e instanceof VaultSessionOperationCancelledError) return;
      if (e instanceof PasskeyAuthenticationPrfUnavailableError) {
        showDiagnosticOutcome("prf_not_returned", { attemptedRegistration: true });
        return;
      }
      if (isCeremonyCancellation(e)) {
        setOutcome("cancelled");
        setError(
          registrationVerified
            ? PASSKEY_VAULT_CONFIRMATION_CANCELLED_MESSAGE
            : getPasskeyPrfDiagnosticMessage("ceremony_cancelled")
        );
        return;
      }
      if (e instanceof Error && e.name === "NotSupportedError") {
        showDiagnosticOutcome("webauthn_unavailable");
        return;
      }
      setOutcome("failed");
      const registrationMessage = toPasskeyRegistrationErrorMessage(e);
      setError(registrationMessage ?? (e instanceof Error ? e.message : "Passkey registration failed"));
    } finally {
      ownedPrfOutput?.fill(0);
      setLoading(false);
    }
  }

  async function handleRemovePasskey() {
    setLoading(true);
    setError(null);
    setMessage(null);
    setShowOrphanNote(false);
    setOutcome("idle");

    try {
      const lease = getCurrentVaultSessionLease(userId);
      if (!lease) throw new Error("Unlock your vault before removing vault passkeys.");
      await passkeysApi.removeAllVaultUnlock();
      assertVaultSessionLeaseCurrent(lease);
      setMessage("Passkey vault unlock was removed. Account sign-in passkeys were preserved.");
      onStatusChange();
    } catch (e) {
      setOutcome("failed");
      setError(e instanceof Error ? e.message : "Failed to remove passkey");
    } finally {
      setLoading(false);
      setRemoveOpen(false);
    }
  }

  if (hasPasskey) {
    return (
      <div className="space-y-4">
        <SuccessState message="Passkey is set up. You can unlock your vault on a new device with your passkey." />
        <Button
          onClick={() => setRemoveOpen(true)}
          disabled={loading}
          variant="danger"
          className="w-full sm:w-auto"
        >
          Remove all vault passkeys
        </Button>
        {message && <SuccessState message={message} />}
        {error && (
          <Alert variant="danger" role="alert">
            {error}
          </Alert>
        )}
        <ConfirmDialog
          open={removeOpen}
          title="Remove all vault passkeys?"
          description="You will no longer be able to unlock your vault with any passkey. Account sign-in passkeys will not be changed."
          confirmLabel="Remove all vault passkeys"
          loading={loading}
          onConfirm={handleRemovePasskey}
          onCancel={() => setRemoveOpen(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-[var(--muted)]">
        When supported by your browser, a passkey lets you unlock your vault with your device PIN,
        fingerprint, or face recognition on a new device.
      </p>
      <Button onClick={handleRegisterPasskey} disabled={loading} variant="secondary" className="w-full sm:w-auto">
        {loading ? "Working…" : "Set up passkey"}
      </Button>
      {outcome === "vault-registered" && message && <SuccessState message={message} />}
      {outcome === "prf-unavailable" && message && diagnosticReason && (
        <Alert variant="warning" title={getPasskeyPrfDiagnosticHeadline(diagnosticReason)}>
          {message}
          {showOrphanNote && (
            <span className="mt-2 block text-[var(--muted)]">{PASSKEY_ORPHAN_CREDENTIAL_NOTE}</span>
          )}
        </Alert>
      )}
      {outcome === "cancelled" && error && (
        <Alert variant="muted">{error}</Alert>
      )}
      {outcome === "failed" && error && (
        <Alert variant="danger" role="alert">
          {error}
        </Alert>
      )}
    </div>
  );
}
