"use client";

import { useCallback, useState } from "react";
import {
  VAULT_VERSION_V2,
  generateUserVaultKey,
  createEncryptedVaultSettings,
  createEmptyEncryptedVaultIndex,
} from "@/lib/crypto-client/vault";
import {
  wrapVaultKeyForPassword,
  wrapVaultKeyForRecoveryPhrase,
} from "@/lib/crypto-client/vault-envelope";
import {
  generateRecoveryPhrase,
  type RecoveryPhraseLength,
} from "@/lib/crypto-client/recovery-phrase";
import {
  assertRecoveryPhraseChallengeAnswers,
  pickRecoveryPhraseChallengeIndices,
} from "@/lib/crypto-client/recovery-phrase-challenge";
import {
  beginVaultOwnerOperation,
  setUnlockedVaultSession,
} from "@/lib/crypto-client/vault-session";
import {
  assertVaultSessionOperationCurrent,
  isVaultSessionOperationCurrent,
  VaultSessionOperationCancelledError,
} from "@tgoliveira/vault-core/browser";
import { vaultApi } from "@/lib/api-client/vault";
import { validatePasswordSetup } from "@tgoliveira/secure-auth/client/password-policy";
import type { VaultAdminPasswordPolicy } from "@tgoliveira/vault-core";
import { useApplicationState } from "@/components/application-state-provider";

export type VaultSetupStep =
  | "intro"
  | "password"
  | "phrase-length"
  | "phrase-display"
  | "phrase-confirm"
  | "saving";

export function useLtgVaultSetup(vaultPasswordPolicy: VaultAdminPasswordPolicy) {
  const { ownerId } = useApplicationState();
  const [step, setStep] = useState<VaultSetupStep>("intro");
  const [vaultPassword, setVaultPassword] = useState("");
  const [vaultPasswordConfirm, setVaultPasswordConfirm] = useState("");
  const [phraseLength, setPhraseLength] = useState<RecoveryPhraseLength>(12);
  const [recoveryPhrase, setRecoveryPhrase] = useState("");
  const [challengeIndices, setChallengeIndices] = useState<number[]>([]);
  const [challengeAnswers, setChallengeAnswers] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regenerateChallenge = useCallback((length: RecoveryPhraseLength) => {
    setChallengeIndices(pickRecoveryPhraseChallengeIndices(length));
    setChallengeAnswers({});
    setError(null);
  }, []);

  const generatePhrase = useCallback(
    (length: RecoveryPhraseLength) => {
      setPhraseLength(length);
      setRecoveryPhrase(generateRecoveryPhrase(length));
      regenerateChallenge(length);
      setStep("phrase-display");
    },
    [regenerateChallenge]
  );

  const beginPhraseConfirmation = useCallback(() => {
    regenerateChallenge(phraseLength);
    setStep("phrase-confirm");
  }, [phraseLength, regenerateChallenge]);

  const setChallengeAnswer = useCallback((index: number, value: string) => {
    setChallengeAnswers((current) => ({ ...current, [index]: value }));
    setError(null);
  }, []);

  const completeSetup = useCallback(async () => {
    if (!ownerId) throw new Error("Not authenticated");
    const userId = ownerId;
    const operation = beginVaultOwnerOperation(userId);
    setLoading(true);
    setError(null);
    try {
      assertRecoveryPhraseChallengeAnswers(recoveryPhrase, challengeAnswers, challengeIndices);

      const passwordValidation = validatePasswordSetup({
        password: vaultPassword,
        confirmation: vaultPasswordConfirm,
        policy: vaultPasswordPolicy,
      });
      if (!passwordValidation.valid) {
        throw new Error("Vault password does not meet the required policy.");
      }

      const vaultKey = await generateUserVaultKey();
      assertVaultSessionOperationCurrent(operation);

      const [passwordEnvelope, recoveryEnvelope, encryptedVaultSettings, encryptedVaultIndex] =
        await Promise.all([
          wrapVaultKeyForPassword(vaultKey, vaultPassword, { userId, resourceId: userId }),
          wrapVaultKeyForRecoveryPhrase(vaultKey, recoveryPhrase, { userId, resourceId: userId }),
          createEncryptedVaultSettings(vaultKey, userId, {
            setupVersion: 1,
            recoveryPhraseLength: phraseLength,
            unlockBehavior: "metadata_only",
          }),
          createEmptyEncryptedVaultIndex(vaultKey, userId),
        ]);
      assertVaultSessionOperationCurrent(operation);

      await vaultApi.setup({
        vaultVersion: VAULT_VERSION_V2,
        encryptedVaultSettings,
        encryptedVaultIndex,
        envelopes: [
          {
            method: "password",
            encryptedVaultKey: passwordEnvelope.encryptedVaultKey,
            kdfMetadata: passwordEnvelope.kdfMetadata,
          },
          {
            method: "recovery_phrase",
            encryptedVaultKey: recoveryEnvelope.encryptedVaultKey,
            kdfMetadata: recoveryEnvelope.kdfMetadata,
            publicMetadata: { phraseLength },
          },
        ],
      });
      assertVaultSessionOperationCurrent(operation);

      await setUnlockedVaultSession({
        userVaultKey: vaultKey,
        method: "password",
        operation,
      });
      setStep("saving");
      return vaultKey;
    } catch (e) {
      if (!(e instanceof VaultSessionOperationCancelledError)) {
        setError(e instanceof Error ? e.message : "Vault setup failed");
      }
      throw e;
    } finally {
      if (isVaultSessionOperationCurrent(operation)) setLoading(false);
    }
  }, [
    ownerId,
    vaultPassword,
    vaultPasswordConfirm,
    vaultPasswordPolicy,
    recoveryPhrase,
    challengeAnswers,
    challengeIndices,
    phraseLength,
  ]);

  return {
    step,
    setStep,
    vaultPassword,
    setVaultPassword,
    vaultPasswordConfirm,
    setVaultPasswordConfirm,
    phraseLength,
    recoveryPhrase,
    challengeIndices,
    challengeAnswers,
    setChallengeAnswer,
    generatePhrase,
    beginPhraseConfirmation,
    completeSetup,
    loading,
    error,
    setError,
  };
}
