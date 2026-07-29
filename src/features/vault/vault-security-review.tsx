"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import type { VaultStatus } from "@/lib/api-client/vault";
import { vaultApi } from "@/lib/api-client/vault";
import { verifyRecoveryPhraseDrill } from "@/lib/crypto-client/recovery-drill";
import { isVaultUnlocked } from "@/lib/crypto-client/vault";
import { validateRecoveryPhraseFormat } from "@/lib/crypto-client/recovery-phrase";
import type { KdfMetadata } from "@/lib/validation/encrypted-payload";
import {
  derivePasskeyVaultUnlockDisplayStatus,
  deriveVaultHealthSummary,
  formatAutoLockStatus,
  formatPasskeyVaultUnlockStatus,
} from "@/lib/vault/vault-health-summary";
import {
  probePasskeyPrfEnvironmentAsync,
  isPasskeyPrfManagementBlocked,
  type PasskeyPrfEnvironmentSnapshot,
} from "@/lib/passkey/passkey-prf-diagnostics";
import { deriveVaultPasskeyAvailability } from "@/lib/passkey/vault-passkey-availability";
import {
  getVaultPasskeyAvailabilityCopy,
  VAULT_PASSKEY_SECTION_INTRO,
} from "@/lib/passkey/vault-passkey-availability-messages";
import { recordVaultSecurityEvent } from "@/features/vault/record-vault-security-event";
import { cn } from "@/lib/ui/cn";

function formatVaultDate(iso: string | undefined): string {
  if (!iso) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

type SecurityEvent = {
  id: string;
  label: string;
  createdAt: string;
};

interface VaultSecurityReviewProps {
  serverStatus: VaultStatus;
}

export function VaultSecurityReview({ serverStatus }: VaultSecurityReviewProps) {
  const [prfEnvironment, setPrfEnvironment] = useState<PasskeyPrfEnvironmentSnapshot | null>(null);
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [drillLoading, setDrillLoading] = useState(false);
  const [drillMessage, setDrillMessage] = useState<string | null>(null);
  const [drillError, setDrillError] = useState<string | null>(null);

  const hasPortablePasskey =
    serverStatus.availableUnlockMethods?.portablePasskey === true ||
    serverStatus.hasPortablePasskey === true;
  const hasPasskeyEnvelope =
    serverStatus.availableUnlockMethods?.passkey === true || serverStatus.hasPasskey === true;
  const passkeyDisplayStatus = derivePasskeyVaultUnlockDisplayStatus(
    hasPasskeyEnvelope,
    hasPortablePasskey ? "supported" : (prfEnvironment?.capabilityProbe ?? null),
    {
      managementBlocked: Boolean(
        !hasPortablePasskey &&
          prfEnvironment &&
          hasPasskeyEnvelope &&
          isPasskeyPrfManagementBlocked(prfEnvironment)
      ),
    }
  );

  const passkeyAvailability = deriveVaultPasskeyAvailability({
    vaultEnvelopeConfigured: hasPasskeyEnvelope,
    vaultConfigured: serverStatus.setupComplete === true || serverStatus.hasVault === true,
    vaultUnlocked: isVaultUnlocked(),
    environment: prfEnvironment,
  });
  const passkeyAvailabilityCopy = getVaultPasskeyAvailabilityCopy(passkeyAvailability);

  const health = useMemo(
    () =>
      deriveVaultHealthSummary({
        setupPhase: "complete",
        serverStatus,
        passkeyDisplayStatus,
      }),
    [serverStatus, passkeyDisplayStatus]
  );

  useEffect(() => {
    let cancelled = false;
    if (hasPortablePasskey) {
      return;
    }
    void probePasskeyPrfEnvironmentAsync().then((snapshot) => {
      if (!cancelled) setPrfEnvironment(snapshot);
    });
    return () => {
      cancelled = true;
    };
  }, [hasPortablePasskey]);

  useEffect(() => {
    let cancelled = false;
    void vaultApi
      .listSecurityEvents()
      .then((response) => {
        if (!cancelled) setEvents(response.events);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setEventsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const runRecoveryDrill = useCallback(async () => {
    setDrillLoading(true);
    setDrillMessage(null);
    setDrillError(null);

    try {
      if (!serverStatus.availableUnlockMethods?.recoveryPhrase) {
        setDrillError("Recovery phrase is not configured for this vault.");
        return;
      }

      if (!validateRecoveryPhraseFormat(recoveryPhrase)) {
        setDrillError("Enter a valid 12- or 24-word recovery phrase.");
        await recordVaultSecurityEvent("recovery_phrase_test_failed");
        return;
      }

      const { encryptedVaultKey, kdfMetadata } = await vaultApi.unlockEnvelope("recovery_phrase");
      if (!encryptedVaultKey || !kdfMetadata) {
        setDrillError("Recovery phrase is not configured for this vault.");
        return;
      }

      const result = await verifyRecoveryPhraseDrill(
        recoveryPhrase,
        encryptedVaultKey,
        kdfMetadata as KdfMetadata,
        { vaultCurrentlyUnlocked: isVaultUnlocked() }
      );

      if (result.status === "verified") {
        setDrillMessage("Recovery phrase verified. Your recovery phrase can unlock your vault.");
        setRecoveryPhrase("");
        await recordVaultSecurityEvent("recovery_phrase_test_succeeded");
      } else {
        setDrillError(
          "Recovery phrase did not work. Check the words and order, then try again. No changes were made."
        );
        await recordVaultSecurityEvent("recovery_phrase_test_failed");
      }
    } catch {
      setDrillError(
        "Recovery phrase did not work. Check the words and order, then try again. No changes were made."
      );
      await recordVaultSecurityEvent("recovery_phrase_test_failed");
    } finally {
      setDrillLoading(false);
    }
  }, [recoveryPhrase, serverStatus]);

  return (
    <div className="space-y-4">
      <Card className="space-y-3 border-dashed p-5">
        <h2 className="font-medium">Vault health summary</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-[var(--muted)]">Protection</dt>
            <dd className="font-medium">{health.protection}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Recovery</dt>
            <dd className="font-medium">{health.recovery}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Passkey vault unlock</dt>
            <dd className="font-medium">{health.passkeyVaultUnlock}</dd>
          </div>
          <div>
            <dt className="text-[var(--muted)]">Auto-lock</dt>
            <dd className="font-medium">{health.autoLock}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-[var(--muted)]">Export/import</dt>
            <dd className="font-medium">{health.exportImport}</dd>
          </div>
        </dl>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-medium">Protection status</h2>
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="font-medium">Vault password</dt>
            <dd className="text-[var(--muted)]">
              {serverStatus.hasVaultPassword || serverStatus.availableUnlockMethods?.password
                ? "Configured"
                : "Unknown"}
            </dd>
          </div>
          <div>
            <dt className="font-medium">Recovery phrase</dt>
            <dd className="text-[var(--muted)]">
              {serverStatus.hasRecoveryPhrase || serverStatus.availableUnlockMethods?.recoveryPhrase
                ? "Recovery phrase configured"
                : serverStatus.hasRecoveryPhrase === false
                  ? "Missing"
                  : "Unknown"}
            </dd>
            {serverStatus.recoveryPhrase && (
              <dd className="mt-1 text-[var(--muted)]">
                {serverStatus.recoveryPhrase.replacedAt
                  ? `Last replaced on ${formatVaultDate(serverStatus.recoveryPhrase.replacedAt)}`
                  : `Created on ${formatVaultDate(serverStatus.recoveryPhrase.createdAt)}`}
              </dd>
            )}
          </div>
          <div>
            <dt className="font-medium">Passkey vault unlock</dt>
            <dd className="text-[var(--muted)]">{formatPasskeyVaultUnlockStatus(passkeyDisplayStatus)}</dd>
          </div>
          <div>
            <dt className="font-medium">Auto-lock</dt>
            <dd className="text-[var(--muted)]">{formatAutoLockStatus()}</dd>
          </div>
          <div>
            <dt className="font-medium">Last vault unlock method</dt>
            <dd className="text-[var(--muted)]">Not tracked yet</dd>
          </div>
        </dl>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-medium">Test your recovery phrase</h2>
        <p className="text-sm text-[var(--muted)]">
          Confirm that your recovery phrase can still unlock your vault before you need it. This test
          happens on this device. Your recovery phrase is never sent to the server, and testing it does
          not replace or invalidate it.
        </p>
        <FormField label="Recovery phrase" id="security-recovery-phrase">
          <Textarea
            id="security-recovery-phrase"
            rows={3}
            value={recoveryPhrase}
            onChange={(e) => setRecoveryPhrase(e.target.value)}
            placeholder="Enter your 12- or 24-word phrase"
          />
        </FormField>
        <Button
          className="w-full sm:w-auto"
          disabled={drillLoading || !recoveryPhrase.trim()}
          onClick={() => void runRecoveryDrill()}
        >
          {drillLoading ? "Testing…" : "Test recovery phrase"}
        </Button>
        {drillMessage && (
          <Alert variant="success" role="status">
            {drillMessage}
          </Alert>
        )}
        {drillError && (
          <Alert variant="danger" role="alert">
            {drillError}
          </Alert>
        )}
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-medium">Passkey vault unlock compatibility</h2>
        <p className="text-sm text-[var(--muted)]">{VAULT_PASSKEY_SECTION_INTRO}</p>
        <p className="text-sm text-[var(--muted)]">
          Portable unlock uses an explicit passkey authorization and a direct connection to the
          trusted vault broker. WebAuthn PRF is required only for legacy pre-cutover envelopes.
        </p>
        {hasPortablePasskey && (
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="font-medium">Portable passkey vault unlock</dt>
              <dd className="text-[var(--muted)]">Configured</dd>
            </div>
          </dl>
        )}
        {!hasPortablePasskey && prfEnvironment && (
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="font-medium">Passkeys for sign-in</dt>
              <dd className="text-[var(--muted)]">
                {prfEnvironment.webauthnAvailable ? "Available" : "Unavailable in this browser"}
              </dd>
            </div>
            <div>
              <dt className="font-medium">Passkey vault unlock</dt>
              <dd className="text-[var(--muted)]">
                {formatPasskeyVaultUnlockStatus(passkeyDisplayStatus)}
              </dd>
            </div>
            {passkeyAvailabilityCopy &&
              passkeyAvailability.state !== "not_configured" &&
              passkeyAvailability.state !== "available" && (
                <div>
                  <dt className="font-medium">Compatibility note</dt>
                  <dd className="text-[var(--muted)]">
                    {passkeyAvailabilityCopy.headline} {passkeyAvailabilityCopy.explanation}
                  </dd>
                </div>
              )}
          </dl>
        )}
        <Link href="/vault/settings">
          <Button variant="secondary" className="w-full sm:w-auto">
            Manage passkey vault unlock
          </Button>
        </Link>
      </Card>

      <Card className="space-y-3 p-5">
        <h2 className="font-medium">Recent vault security events</h2>
        {eventsLoading ? (
          <p className="text-sm text-[var(--muted)]">Loading events…</p>
        ) : events.length === 0 ? (
          <p className="text-sm text-[var(--muted)]">No vault security events yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {events.map((event) => (
              <li
                key={event.id}
                className="flex flex-col gap-0.5 border-b border-[var(--border)] pb-2 last:border-0"
              >
                <span className="font-medium">{event.label}</span>
                <span className="text-[var(--muted)]">{formatVaultDate(event.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-2 border-dashed p-5">
        <h2 className="font-medium">Your account and vault are separate</h2>
        <p className="text-sm text-[var(--muted)]">
          Your account lets you sign in to SelahKeep. Your vault protects your private notes. Signing
          in does not decrypt your vault, and changing your account password does not reset your vault
          password.
        </p>
        <p className="text-sm text-[var(--muted)]">
          Keep your recovery phrase safe. SelahKeep cannot recover your vault without it.
        </p>
      </Card>

      <Card className="space-y-2 border-dashed p-5">
        <h2 className="font-medium">Export and import</h2>
        <p className={cn("text-sm font-medium text-[var(--foreground)]")}>Not available yet</p>
        <p className="text-sm text-[var(--muted)]">
          Encrypted export and import are planned for a future phase. Until then, keep your recovery
          phrase safe and do not rely on export for backup.
        </p>
      </Card>
    </div>
  );
}
