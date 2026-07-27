"use client";

import { useCallback, useState } from "react";
import { getSessionVaultKey } from "@/lib/crypto-client/vault";
import { wrapVaultKeyForRecoveryPhrase } from "@/lib/crypto-client/vault-envelope";
import {
  assertRecoveryPhraseConfirmation,
  generateRecoveryPhrase,
  type RecoveryPhraseLength,
} from "@/lib/crypto-client/recovery-phrase";
import { vaultApi } from "@/lib/api-client/vault";
import {
  getCurrentVaultSessionLease,
} from "@/lib/crypto-client/vault-session";
import {
  assertVaultSessionLeaseCurrent,
  isVaultSessionLeaseCurrent,
  VaultSessionOperationCancelledError,
} from "@tgoliveira/vault-core/browser";
import { useApplicationState } from "@/components/application-state-provider";

export type ReplaceRecoveryPhraseStep =
  | "idle"
  | "phrase-length"
  | "phrase-display"
  | "phrase-confirm"
  | "saving"
  | "done";

export function useReplaceRecoveryPhrase(onReplaced: () => void) {
  const { ownerId } = useApplicationState();
  const [step, setStep] = useState<ReplaceRecoveryPhraseStep>("idle");
  const [phraseLength, setPhraseLength] = useState<RecoveryPhraseLength>(12);
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [phraseConfirmation, setPhraseConfirmation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setStep("idle");
    setRecoveryPhrase("");
    setPhraseConfirmation("");
    setError(null);
  }, []);

  const startReplace = useCallback(() => {
    setError(null);
    setStep("phrase-length");
  }, []);

  const generatePhrase = useCallback((length: RecoveryPhraseLength) => {
    setPhraseLength(length);
    setRecoveryPhrase(generateRecoveryPhrase(length));
    setPhraseConfirmation("");
    setStep("phrase-display");
  }, []);

  const replacePhrase = useCallback(async () => {
    if (!ownerId) {
      setError("Not authenticated");
      return;
    }

    const vaultKey = getSessionVaultKey();
    if (!vaultKey) {
      setError("Unlock your vault before replacing your recovery phrase.");
      return;
    }
    const userId = ownerId;
    const lease = getCurrentVaultSessionLease(userId);
    if (!lease) {
      setError("Unlock your vault before replacing your recovery phrase.");
      return;
    }

    setLoading(true);
    setError(null);
    setStep("saving");

    try {
      assertRecoveryPhraseConfirmation(recoveryPhrase, phraseConfirmation);

      const recoveryEnvelope = await wrapVaultKeyForRecoveryPhrase(vaultKey, recoveryPhrase, {
        userId,
        resourceId: userId,
      });
      assertVaultSessionLeaseCurrent(lease);

      await vaultApi.replaceRecoveryPhrase({
        encryptedVaultKey: recoveryEnvelope.encryptedVaultKey,
        kdfMetadata: recoveryEnvelope.kdfMetadata,
        publicMetadata: { phraseLength },
      });
      assertVaultSessionLeaseCurrent(lease);

      setRecoveryPhrase("");
      setPhraseConfirmation("");
      setStep("done");
      onReplaced();
    } catch (e) {
      if (!(e instanceof VaultSessionOperationCancelledError)) {
        setStep("phrase-confirm");
        setError(e instanceof Error ? e.message : "Failed to replace recovery phrase");
      }
    } finally {
      if (isVaultSessionLeaseCurrent(lease)) setLoading(false);
    }
  }, [ownerId, recoveryPhrase, phraseConfirmation, phraseLength, onReplaced]);

  return {
    step,
    setStep,
    phraseLength,
    recoveryPhrase,
    phraseConfirmation,
    setPhraseConfirmation,
    loading,
    error,
    reset,
    startReplace,
    generatePhrase,
    replacePhrase,
  };
}
