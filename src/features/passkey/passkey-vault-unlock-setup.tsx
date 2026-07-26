"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { SuccessState } from "@/components/ui/success-state";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { apiClient } from "@/lib/api-client/client";
import { passkeysApi } from "@/lib/api-client/passkeys";
import { vaultApi } from "@/lib/api-client/vault";
import { getSessionVaultKey } from "@/lib/crypto-client/vault";
import {
  extractPasskeyPrfOutput,
  unlockVaultFromPasskeyEnvelopeCandidates,
  wrapVaultKeyForPasskey,
} from "@/lib/crypto-client/passkey-vault";
import {
  persistVaultPasskeyBinding,
  runVaultUnlockAuthenticationCeremony,
  unbindVaultPasskeyFromThisBrowser,
  verifyVaultUnlockAuthentication,
} from "@/lib/passkey/vault-unlock-authenticate";
import { currentDeviceLabel } from "@/lib/passkey/device-label";
import {
  prepareAuthenticationOptions,
  prepareRegistrationOptions,
} from "@/lib/passkey/prepare-webauthn-options";
import {
  getPasskeyPrfDiagnosticHeadline,
  getPasskeyPrfDiagnosticMessage,
  isCeremonyCancellation,
  probePasskeyPrfEnvironmentAsync,
  resolveCeremonyDiagnosticReason,
  resolvePreCeremonyDiagnosticReason,
  shouldBlockPasskeyVaultSetupBeforeCeremony,
  isPasskeyPrfManagementBlocked,
  type PasskeyPrfDiagnosticReason,
  type PasskeyPrfEnvironmentSnapshot,
} from "@/lib/passkey/passkey-prf-diagnostics";
import { toPasskeyRegistrationErrorMessage } from "@/lib/passkey/webauthn-config";
import {
  PASSKEY_VAULT_UNLOCK_CONFIGURED_ON_ANOTHER_DEVICE_MESSAGE,
  PASSKEY_VAULT_UNLOCK_DISABLED_MESSAGE,
  PASSKEY_VAULT_UNLOCK_ENABLED_MESSAGE,
  PASSKEY_VAULT_UNLOCK_ENABLED_REFRESH_WARNING,
  PASSKEY_VAULT_UNLOCK_TEST_SUCCEEDED_MESSAGE,
} from "@/lib/passkey/messages";
import {
  canAttemptVaultPasskeySetup,
  deriveVaultPasskeyAvailability,
  shouldShowVaultPasskeyDestructiveActions,
  type VaultPasskeyAvailability,
} from "@/lib/passkey/vault-passkey-availability";
import {
  getVaultPasskeyAvailabilityCopy,
  VAULT_PASSKEY_INDEPENDENCE_NOTE,
} from "@/lib/passkey/vault-passkey-availability-messages";
import type { EncryptedPayload } from "@/lib/validation/encrypted-payload";
import {
  resolvePasskeyPrfCapability,
  sanitizeWebAuthnResponseForServer,
} from "@/lib/crypto-client/vault-passkey-browser";
import type { EncryptedPayload as VaultCoreEncryptedPayload } from "@tgoliveira/vault-core";

type VaultUnlockPasskey = {
  id: string;
  friendlyName: string;
  signInEnabled: boolean;
  vaultUnlockEnabled: boolean;
  prfSupported: boolean | null;
  credentialId: string;
  credentialDeviceType?: "singleDevice" | "multiDevice" | null;
  backupEligible?: boolean | null;
  credentialBackedUp?: boolean | null;
  activeEnvelopeVariantCount?: number;
};

type VaultDeviceBinding = {
  id: string;
  credentialId: string;
  deviceLabel: string;
  isCurrentDevice: boolean;
  selectedEnvelopeVariantId?: string | null;
};

async function fetchVaultPasskeyData(): Promise<{
  passkeys: VaultUnlockPasskey[];
  deviceBindings: VaultDeviceBinding[];
  currentDeviceCredentialId?: string;
  passkeyUnlockAvailableOnThisDevice: boolean;
  serverPasskeyEnvelope: boolean;
  vaultConfigured: boolean;
}> {
  const [vaultUnlock, vaultStatus] = await Promise.all([
    apiClient.get<{
      passkeys: VaultUnlockPasskey[];
      deviceBindings?: VaultDeviceBinding[];
      currentDeviceCredentialId?: string | null;
      passkeyUnlockAvailableOnThisDevice?: boolean;
      serverEnvelopeConfigured: boolean;
    }>("/api/passkeys/vault-unlock"),
    vaultApi.status().catch(() => null),
  ]);

  const serverPasskeyEnvelope =
    vaultUnlock.serverEnvelopeConfigured ||
    vaultStatus?.availableUnlockMethods?.passkey === true ||
    vaultStatus?.hasPasskey === true;

  const passkeyUnlockAvailableOnThisDevice =
    vaultUnlock.passkeyUnlockAvailableOnThisDevice ??
    vaultStatus?.passkeyUnlockAvailableOnThisDevice ??
    false;

  return {
    passkeys: vaultUnlock.passkeys,
    deviceBindings: vaultUnlock.deviceBindings ?? [],
    currentDeviceCredentialId: vaultUnlock.currentDeviceCredentialId ?? undefined,
    passkeyUnlockAvailableOnThisDevice,
    serverPasskeyEnvelope,
    vaultConfigured: vaultStatus?.setupComplete === true || vaultStatus?.hasVault === true,
  };
}

interface PasskeyVaultUnlockSetupProps {
  userId: string;
  vaultUnlocked: boolean;
  vaultConfigured?: boolean;
}

export function PasskeyVaultUnlockSetup({
  userId,
  vaultUnlocked,
  vaultConfigured = true,
}: PasskeyVaultUnlockSetupProps) {
  const [passkeys, setPasskeys] = useState<VaultUnlockPasskey[]>([]);
  const [deviceBindings, setDeviceBindings] = useState<VaultDeviceBinding[]>([]);
  const [currentDeviceCredentialId, setCurrentDeviceCredentialId] = useState<string | undefined>();
  const [passkeyUnlockAvailableOnThisDevice, setPasskeyUnlockAvailableOnThisDevice] =
    useState(false);
  const [serverPasskeyEnvelope, setServerPasskeyEnvelope] = useState(false);
  const [environment, setEnvironment] = useState<PasskeyPrfEnvironmentSnapshot | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [removeAllOpen, setRemoveAllOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [diagnosticReason, setDiagnosticReason] = useState<PasskeyPrfDiagnosticReason | null>(null);

  const loadPasskeys = useCallback(async () => {
    const data = await fetchVaultPasskeyData();
    setPasskeys(data.passkeys);
    setDeviceBindings(data.deviceBindings);
    setCurrentDeviceCredentialId(data.currentDeviceCredentialId);
    setPasskeyUnlockAvailableOnThisDevice(data.passkeyUnlockAvailableOnThisDevice);
    setServerPasskeyEnvelope(data.serverPasskeyEnvelope);
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchVaultPasskeyData(), probePasskeyPrfEnvironmentAsync()])
      .then(([data, env]) => {
        if (!cancelled) {
          setPasskeys(data.passkeys);
          setDeviceBindings(data.deviceBindings);
          setCurrentDeviceCredentialId(data.currentDeviceCredentialId);
          setPasskeyUnlockAvailableOnThisDevice(data.passkeyUnlockAvailableOnThisDevice);
          setServerPasskeyEnvelope(data.serverPasskeyEnvelope);
          setEnvironment(env);
        }
      })
      .catch(() => {
        if (!cancelled) setPasskeys([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const availability = useMemo(
    (): VaultPasskeyAvailability =>
      deriveVaultPasskeyAvailability({
        vaultEnvelopeConfigured:
          serverPasskeyEnvelope || passkeys.some((passkey) => passkey.vaultUnlockEnabled),
        vaultConfigured,
        vaultUnlocked,
        environment,
      }),
    [passkeys, serverPasskeyEnvelope, vaultConfigured, vaultUnlocked, environment]
  );

  const availabilityCopy = useMemo(
    () => getVaultPasskeyAvailabilityCopy(availability),
    [availability]
  );

  const managementBlocked = isPasskeyPrfManagementBlocked(environment);
  const setupAllowed = canAttemptVaultPasskeySetup(availability);
  const hasVaultPasskey = passkeys.some((passkey) => passkey.vaultUnlockEnabled);
  const passkeyConfiguredOnAnotherDevice =
    serverPasskeyEnvelope && !passkeyUnlockAvailableOnThisDevice;
  // Synced passkeys remain one logical credential. A browser binding only remembers
  // the locally matched variant and never authorizes envelope mutation.
  const showPrimarySetup =
    setupAllowed &&
    vaultUnlocked &&
    !managementBlocked &&
    availability.state !== "browser_unsupported" &&
    availability.state !== "prf_unsupported";

  async function runCeremonyWithOptions(options: PublicKeyCredentialRequestOptionsJSON) {
    const assertion = await startAuthentication({
      optionsJSON: prepareAuthenticationOptions(options),
    });
    return assertion;
  }

  /** Append one compatibility variant for an already verified logical credential. */
  async function appendAndBindEnvelopeVariant(
    credentialDbId: string,
    expectedCredentialId: string,
    vaultKey: CryptoKey
  ) {
    const enablePath = `/api/account/passkeys/${credentialDbId}/enable-vault-unlock`;
    const enableOptions = (await apiClient.post(enablePath, {
      action: "options",
    })) as PublicKeyCredentialRequestOptionsJSON;
    const assertion = await runCeremonyWithOptions(enableOptions);
    const clientExtensionResults = assertion.clientExtensionResults as Record<string, unknown>;
    const enrollment = await apiClient.post<{
      verified: true;
      verifiedCredentialId: string;
      enrollmentProof: string;
    }>(enablePath, {
      action: "verify",
      response: sanitizeWebAuthnResponseForServer(assertion),
    });
    if (
      enrollment.verifiedCredentialId !== assertion.id ||
      enrollment.verifiedCredentialId !== expectedCredentialId
    ) {
      throw new Error("Verified passkey credential mismatch.");
    }
    const capability = resolvePasskeyPrfCapability({
      ceremony: "authentication",
      verifiedCredentialId: enrollment.verifiedCredentialId,
      clientExtensionResults,
    });
    const prfOutput = extractPasskeyPrfOutput(
      clientExtensionResults,
      enrollment.verifiedCredentialId
    );
    if (capability.state !== "confirmed_authentication" || !prfOutput) {
      throw new Error(
        getPasskeyPrfDiagnosticMessage(
          resolveCeremonyDiagnosticReason({ prfOutputPresent: false })
        )
      );
    }

    const encryptedVaultKey: EncryptedPayload = await wrapVaultKeyForPasskey(
      vaultKey,
      prfOutput,
      userId,
      userId
    );
    const persisted = await apiClient.post<{
      verifiedCredentialId: string;
      envelopeVariantId: string;
      bindingProof: string;
    }>(enablePath, {
      action: "persist",
      enrollmentProof: enrollment.enrollmentProof,
      encryptedVaultKey,
      prfSupported: true,
    });
    if (persisted.verifiedCredentialId !== expectedCredentialId) {
      throw new Error("Persisted passkey credential mismatch.");
    }
    const localMatch = await unlockVaultFromPasskeyEnvelopeCandidates({
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
            },
          },
        },
      ],
      prfOutput,
      applySession: false,
      cacheInnerKey: false,
    });
    if (localMatch.status !== "matched") {
      throw new Error("The new passkey envelope could not be verified locally.");
    }
    await persistVaultPasskeyBinding({
      bindingProof: persisted.bindingProof,
      verifiedCredentialId: persisted.verifiedCredentialId,
      selectedEnvelopeVariantId: localMatch.envelopeVariantId,
      deviceLabel: currentDeviceLabel(),
    });
    return localMatch.envelopeVariantId;
  }

  async function verifyAndMatchCandidate(
    assertion: Awaited<ReturnType<typeof startAuthentication>>,
    persistBinding: boolean
  ) {
    const clientExtensionResults = assertion.clientExtensionResults as Record<string, unknown>;
    const verification = await verifyVaultUnlockAuthentication(assertion);
    if (verification.verifiedCredentialId !== assertion.id) {
      throw new Error("Verified passkey credential mismatch.");
    }
    const capability = resolvePasskeyPrfCapability({
      ceremony: "authentication",
      verifiedCredentialId: verification.verifiedCredentialId,
      clientExtensionResults,
    });
    const prfOutput = extractPasskeyPrfOutput(
      clientExtensionResults,
      verification.verifiedCredentialId
    );
    if (capability.state !== "confirmed_authentication" || !prfOutput) {
      throw new Error(
        getPasskeyPrfDiagnosticMessage(
          resolveCeremonyDiagnosticReason({ prfOutputPresent: false })
        )
      );
    }

    const match = await unlockVaultFromPasskeyEnvelopeCandidates({
      userId,
      verifiedCredentialId: verification.verifiedCredentialId,
      candidates: verification.candidates,
      prfOutput,
      applySession: false,
      cacheInnerKey: false,
    });
    if (match.status !== "matched") {
      throw new Error(
        match.status === "no_match"
          ? "This passkey did not match any saved vault envelope. Unlock with your vault password or recovery phrase before adding a compatibility variant."
          : "The saved passkey envelope candidates could not be validated."
      );
    }

    if (persistBinding) {
      await persistVaultPasskeyBinding({
        bindingProof: verification.bindingProof,
        verifiedCredentialId: verification.verifiedCredentialId,
        selectedEnvelopeVariantId: match.envelopeVariantId,
        deviceLabel: currentDeviceLabel(),
      });
    }
    return { verification, match };
  }

  async function handleRegisterVaultPasskey() {
    setLoadingId("register");
    setError(null);
    setMessage(null);
    setDiagnosticReason(null);

    try {
      const vaultKey = getSessionVaultKey();
      if (!vaultKey) {
        throw new Error("Unlock your vault before setting up passkey vault unlock.");
      }

      const env = environment ?? (await probePasskeyPrfEnvironmentAsync());
      setEnvironment(env);

      if (shouldBlockPasskeyVaultSetupBeforeCeremony(env)) {
        const reason = resolvePreCeremonyDiagnosticReason(env)!;
        setDiagnosticReason(reason);
        setError(getPasskeyPrfDiagnosticMessage(reason));
        return;
      }

      // Step 1: register the vault-only credential WITHOUT an envelope.
      const options = (await apiClient.post("/api/passkeys/register", {
        action: "options",
        vaultOnly: true,
      })) as PublicKeyCredentialCreationOptionsJSON;

      const attestation = await startRegistration({
        optionsJSON: prepareRegistrationOptions(options),
      });

      const registration = (await apiClient.post("/api/passkeys/register", {
        action: "verify",
        response: sanitizeWebAuthnResponseForServer(attestation),
        vaultOnly: true,
        friendlyName: currentDeviceLabel(),
      })) as { credentialDbId?: string; verifiedCredentialId?: string };

      const credentialDbId = registration.credentialDbId;
      if (!credentialDbId || registration.verifiedCredentialId !== attestation.id) {
        throw new Error("Could not set up passkey vault unlock.");
      }
      // Registration confirmation is informative; the following authentication
      // ceremony is authoritative for usable PRF output.
      resolvePasskeyPrfCapability({
        ceremony: "registration",
        credentialId: registration.verifiedCredentialId,
        clientExtensionResults: attestation.clientExtensionResults as Record<string, unknown>,
      });

      // Step 2 appends a variant derived from an authentication (`get`) PRF.
      await appendAndBindEnvelopeVariant(
        credentialDbId,
        registration.verifiedCredentialId,
        vaultKey
      );

      setMessage(PASSKEY_VAULT_UNLOCK_ENABLED_MESSAGE);
      try {
        await loadPasskeys();
      } catch {
        // Registration and envelope persistence already succeeded. A secondary
        // status refresh must not turn that success into a registration error.
        setMessage(PASSKEY_VAULT_UNLOCK_ENABLED_REFRESH_WARNING);
      }
    } catch (e) {
      if (isCeremonyCancellation(e)) {
        setDiagnosticReason("ceremony_cancelled");
        setError(getPasskeyPrfDiagnosticMessage("ceremony_cancelled"));
        return;
      }
      const registrationMessage = toPasskeyRegistrationErrorMessage(e);
      setError(registrationMessage ?? (e instanceof Error ? e.message : "Could not set up passkey vault unlock."));
    } finally {
      setLoadingId(null);
    }
  }

  async function handleTest(passkeyId: string) {
    setLoadingId(passkeyId);
    setError(null);
    setMessage(null);
    setDiagnosticReason(null);

    try {
      const passkey = passkeys.find((item) => item.id === passkeyId);
      const env = environment ?? (await probePasskeyPrfEnvironmentAsync());
      setEnvironment(env);

      if (shouldBlockPasskeyVaultSetupBeforeCeremony(env)) {
        const reason = resolvePreCeremonyDiagnosticReason(env)!;
        setDiagnosticReason(reason);
        setError(getPasskeyPrfDiagnosticMessage(reason));
        return;
      }

      const assertion = await runVaultUnlockAuthenticationCeremony(
        passkey?.credentialId ?? currentDeviceCredentialId
      );
      await verifyAndMatchCandidate(assertion, false);

      setMessage(PASSKEY_VAULT_UNLOCK_TEST_SUCCEEDED_MESSAGE);
      setDiagnosticReason("supported");
    } catch (e) {
      if (isCeremonyCancellation(e)) {
        setDiagnosticReason("ceremony_cancelled");
        setError(getPasskeyPrfDiagnosticMessage("ceremony_cancelled"));
        return;
      }
      setError(e instanceof Error ? e.message : "Passkey test failed.");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleRebind(passkeyId: string) {
    setLoadingId(passkeyId);
    setError(null);
    setMessage(null);
    setDiagnosticReason(null);
    try {
      const passkey = passkeys.find((item) => item.id === passkeyId);
      if (!passkey) throw new Error("Passkey not found.");
      const assertion = await runVaultUnlockAuthenticationCeremony(passkey.credentialId);
      await verifyAndMatchCandidate(assertion, true);
      setMessage("This browser now uses the verified passkey envelope variant.");
      setDiagnosticReason("supported");
      await loadPasskeys();
    } catch (e) {
      if (isCeremonyCancellation(e)) {
        setDiagnosticReason("ceremony_cancelled");
        setError(getPasskeyPrfDiagnosticMessage("ceremony_cancelled"));
        return;
      }
      setError(e instanceof Error ? e.message : "Could not bind this browser.");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleAddCompatibilityVariant(passkeyId: string) {
    setLoadingId(passkeyId);
    setError(null);
    setMessage(null);
    setDiagnosticReason(null);
    try {
      const passkey = passkeys.find((item) => item.id === passkeyId);
      const vaultKey = getSessionVaultKey();
      if (!passkey || !vaultKey) {
        throw new Error("Unlock your vault before adding a compatibility variant.");
      }
      await appendAndBindEnvelopeVariant(passkey.id, passkey.credentialId, vaultKey);
      setMessage("A compatibility envelope variant was added and verified on this browser.");
      setDiagnosticReason("supported");
      await loadPasskeys();
    } catch (e) {
      if (isCeremonyCancellation(e)) {
        setDiagnosticReason("ceremony_cancelled");
        setError(getPasskeyPrfDiagnosticMessage("ceremony_cancelled"));
        return;
      }
      setError(e instanceof Error ? e.message : "Could not add a compatibility variant.");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDisable(passkeyId: string) {
    setLoadingId(passkeyId);
    setError(null);
    setMessage(null);
    setDiagnosticReason(null);

    try {
      if (isPasskeyPrfManagementBlocked(environment)) {
        setError(
          getVaultPasskeyAvailabilityCopy({
            state: "configured",
            unavailableInThisBrowser: true,
          })!.explanation
        );
        return;
      }

      const passkey = passkeys.find((item) => item.id === passkeyId);
      if (!passkey) throw new Error("Passkey not found.");
      const assertion = await runVaultUnlockAuthenticationCeremony(passkey.credentialId);
      const { verification, match } = await verifyAndMatchCandidate(assertion, false);

      await apiClient.delete(`/api/account/passkeys/${passkeyId}/vault-unlock`, {
        bindingProof: verification.bindingProof,
        verifiedCredentialId: verification.verifiedCredentialId,
        selectedEnvelopeVariantId: match.envelopeVariantId,
      });

      setMessage(PASSKEY_VAULT_UNLOCK_DISABLED_MESSAGE);
      await loadPasskeys();
    } catch (e) {
      if (isCeremonyCancellation(e)) {
        setDiagnosticReason("ceremony_cancelled");
        setError(getPasskeyPrfDiagnosticMessage("ceremony_cancelled"));
        return;
      }
      setError(e instanceof Error ? e.message : "Could not disable passkey vault unlock.");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleUnbindThisBrowser() {
    setLoadingId("unbind");
    setError(null);
    setMessage(null);
    try {
      await unbindVaultPasskeyFromThisBrowser();
      setMessage("This browser binding was removed. Your passkey and envelope variants remain active.");
      await loadPasskeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not unbind this browser.");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleRemoveAllVaultPasskeys() {
    setLoadingId("remove-all");
    setError(null);
    setMessage(null);
    setDiagnosticReason(null);

    try {
      if (!getSessionVaultKey()) {
        throw new Error("Unlock your vault before removing all vault passkeys.");
      }
      await passkeysApi.removeAllVaultUnlock();
      setMessage(
        "Passkey vault unlock was removed from every passkey and browser. Account sign-in passkeys were preserved."
      );
      await loadPasskeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove all vault passkeys.");
    } finally {
      setLoadingId(null);
      setRemoveAllOpen(false);
    }
  }

  const alertVariant =
    availabilityCopy?.variant === "success"
      ? "success"
      : availabilityCopy?.variant === "warning"
        ? "warning"
        : availabilityCopy?.variant === "info"
          ? "info"
          : "muted";

  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-[var(--muted)]">{VAULT_PASSKEY_INDEPENDENCE_NOTE}</p>

      {availabilityCopy && !passkeyConfiguredOnAnotherDevice && (
        <Alert variant={alertVariant} title={availabilityCopy.headline}>
          {availabilityCopy.explanation}
        </Alert>
      )}

      {passkeyConfiguredOnAnotherDevice && (
        <Alert variant="info" title="Passkey vault unlock on another device">
          {PASSKEY_VAULT_UNLOCK_CONFIGURED_ON_ANOTHER_DEVICE_MESSAGE}
        </Alert>
      )}

      {showPrimarySetup && (
        <Button
          variant="secondary"
          className="w-full sm:w-auto"
          disabled={loadingId === "register"}
          onClick={() => void handleRegisterVaultPasskey()}
        >
          {loadingId === "register"
            ? "Working…"
            : hasVaultPasskey || passkeyConfiguredOnAnotherDevice
              ? "Add an independent passkey"
              : "Set up passkey vault unlock"}
        </Button>
      )}

      {(hasVaultPasskey || passkeyConfiguredOnAnotherDevice) && showPrimarySetup && (
        <p className="text-sm text-[var(--muted)]">
          First try an existing synced passkey below. Register an independent passkey only for a
          separate provider, security key, or single-device credential.
        </p>
      )}

      {passkeys.length > 0 && (
        <ul className="space-y-3">
          {passkeys.map((passkey) => {
            const readOnlyConfigured =
              passkey.vaultUnlockEnabled &&
              !shouldShowVaultPasskeyDestructiveActions(availability, passkey.vaultUnlockEnabled);
            const canManage =
              vaultUnlocked &&
              !managementBlocked &&
              setupAllowed &&
              availability.state !== "browser_unsupported" &&
              availability.state !== "prf_unsupported";
            return (
              <li
                key={passkey.id}
                className="flex flex-col gap-3 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] p-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <p className="font-medium text-[var(--foreground)]">{passkey.friendlyName}</p>
                  <p className="text-sm text-[var(--muted)]">
                    {passkey.signInEnabled
                      ? "Also used for account passkey sign-in."
                      : "Vault unlock passkey only — not used for account sign-in."}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="success">Vault unlock: configured</Badge>
                    {passkey.credentialId === currentDeviceCredentialId ? (
                      <Badge variant="info">This browser</Badge>
                    ) : null}
                    {passkey.credentialDeviceType === "multiDevice" ? (
                      <Badge variant="info">Synced credential</Badge>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {readOnlyConfigured ? null : (
                    <>
                      <Button
                        variant="secondary"
                        disabled={loadingId === passkey.id}
                        onClick={() => void handleTest(passkey.id)}
                      >
                        {loadingId === passkey.id ? "Working…" : "Test"}
                      </Button>
                      {passkey.credentialId !== currentDeviceCredentialId ? (
                        <Button
                          variant="secondary"
                          disabled={!canManage || loadingId === passkey.id}
                          onClick={() => void handleRebind(passkey.id)}
                        >
                          Use on this browser
                        </Button>
                      ) : null}
                      <Button
                        variant="secondary"
                        disabled={!canManage || loadingId === passkey.id}
                        onClick={() => void handleAddCompatibilityVariant(passkey.id)}
                      >
                        Add compatibility variant
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={!canManage || loadingId === passkey.id}
                        onClick={() => void handleDisable(passkey.id)}
                      >
                        Disable
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {deviceBindings.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-[var(--foreground)]">Bound devices</p>
          <ul className="space-y-2 text-sm text-[var(--muted)]">
            {deviceBindings.map((binding) => (
              <li key={binding.id}>
                {binding.deviceLabel}
                {binding.isCurrentDevice ? " · this browser" : ""}
              </li>
            ))}
          </ul>
          {deviceBindings.some((binding) => binding.isCurrentDevice) ? (
            <Button
              variant="secondary"
              disabled={loadingId === "unbind"}
              onClick={() => void handleUnbindThisBrowser()}
            >
              {loadingId === "unbind" ? "Working…" : "Unbind this browser"}
            </Button>
          ) : null}
        </div>
      )}

      {(hasVaultPasskey || serverPasskeyEnvelope) && vaultUnlocked && (
        <div className="space-y-3 border-t border-[var(--border)] pt-4">
          <div className="space-y-1">
            <p className="text-sm font-medium text-[var(--foreground)]">
              Remove passkey vault unlock everywhere
            </p>
            <p className="text-sm leading-relaxed text-[var(--muted)]">
              Removes every vault-only passkey, vault envelope variant, and browser binding. A
              passkey that is also used to sign in to your account will keep its sign-in access.
            </p>
          </div>
          <Button
            variant="danger"
            disabled={loadingId !== null}
            onClick={() => setRemoveAllOpen(true)}
          >
            Remove all vault passkeys
          </Button>
        </div>
      )}

      {passkeys.length === 0 && serverPasskeyEnvelope && !passkeyConfiguredOnAnotherDevice && (
        <p className="text-sm text-[var(--muted)]">
          A passkey vault unlock envelope exists on your account. Use a PRF-compatible browser where
          it was configured, or unlock with your vault password or recovery phrase.
        </p>
      )}

      {message && <SuccessState message={message} />}
      {error && (
        <Alert
          variant="danger"
          role="alert"
          title={diagnosticReason ? getPasskeyPrfDiagnosticHeadline(diagnosticReason) : undefined}
        >
          {error}
        </Alert>
      )}

      <ConfirmDialog
        open={removeAllOpen}
        title="Remove all vault passkeys?"
        description="You will no longer be able to unlock the vault with any passkey on any browser. Your vault password, recovery phrase, and account sign-in passkeys will not be changed."
        confirmLabel="Remove all vault passkeys"
        loading={loadingId === "remove-all"}
        onConfirm={handleRemoveAllVaultPasskeys}
        onCancel={() => setRemoveAllOpen(false)}
      />
    </div>
  );
}
