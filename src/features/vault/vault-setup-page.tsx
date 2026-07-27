"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import type { VaultAdminPasswordPolicy } from "@tgoliveira/vault-core";
import { PageLayout } from "@/components/layout/page-layout";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/ui/error-state";
import { isVaultUnlocked } from "@/lib/crypto-client/vault";
import { PRODUCT_NAME } from "@/lib/marketing/brand";
import { useLtgVaultSetup } from "@/features/vault/use-ltg-vault-setup";
import { VaultSetupWizard } from "@/features/vault/vault-setup-wizard";
import { useApplicationState } from "@/components/application-state-provider";

interface VaultSetupPageProps {
  vaultPasswordPolicy: VaultAdminPasswordPolicy;
}

export function VaultSetupPage({ vaultPasswordPolicy }: VaultSetupPageProps) {
  const { ownerId, vaultStatus } = useApplicationState();
  const router = useRouter();
  const setup = useLtgVaultSetup(vaultPasswordPolicy);

  useEffect(() => {
    if (!ownerId) {
      router.push("/login");
      return;
    }

    if (isVaultUnlocked()) {
      router.push("/notes");
      return;
    }

    if (vaultStatus !== "unavailable" && vaultStatus?.initialized && vaultStatus.setupComplete) {
      router.push("/vault/unlock");
    }
  }, [ownerId, router, vaultStatus]);

  async function handleComplete() {
    await setup.completeSetup();
    router.push("/notes");
  }

  if (vaultStatus === "unavailable") {
    return (
      <PageLayout width="narrow">
        <ErrorState
          message="We could not verify your vault setup status."
          onRetry={() => window.location.reload()}
        />
      </PageLayout>
    );
  }

  return (
    <PageLayout width="narrow">
      <PageHeader
        title={`${PRODUCT_NAME} setup`}
        description="Create your private vault with a vault password and recovery phrase."
      />
      <VaultSetupWizard
        step={setup.step}
        loading={setup.loading}
        error={setup.error}
        vaultPasswordPolicy={vaultPasswordPolicy}
        vaultPassword={setup.vaultPassword}
        vaultPasswordConfirm={setup.vaultPasswordConfirm}
        recoveryPhrase={setup.recoveryPhrase}
        challengeIndices={setup.challengeIndices}
        challengeAnswers={setup.challengeAnswers}
        onVaultPasswordChange={setup.setVaultPassword}
        onVaultPasswordConfirmChange={setup.setVaultPasswordConfirm}
        onChallengeAnswerChange={setup.setChallengeAnswer}
        onSetStep={setup.setStep}
        onGeneratePhrase={setup.generatePhrase}
        onBeginPhraseConfirmation={setup.beginPhraseConfirmation}
        onComplete={handleComplete}
      />
    </PageLayout>
  );
}
