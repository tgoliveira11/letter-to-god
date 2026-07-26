import {
  getPasskeyPrfDiagnosticMessage,
  resolveCeremonyDiagnosticReason,
} from "@/lib/passkey/passkey-prf-diagnostics";
import { mapPasskeyCryptoError } from "@/lib/passkey/map-passkey-crypto-error";
import {
  PASSKEY_NOT_LINKED_TO_VAULT_UNLOCK_MESSAGE,
  PASSKEY_NOT_AVAILABLE_FOR_VAULT_UNLOCK_MESSAGE,
  PASSKEY_UNLOCK_IOS_PRF_TOO_OLD_MESSAGE,
  PASSKEY_UNLOCK_PRF_MISMATCH_MESSAGE,
  PASSKEY_UNLOCK_PRF_MISMATCH_APPLE_HINT_MESSAGE,
  PASSKEY_VAULT_UNLOCK_NOT_CONFIGURED_MESSAGE,
} from "@/lib/passkey/messages";
import {
  extractPasskeyPrfOutput,
  unlockVaultFromPasskeyEnvelopeCandidates,
} from "@/lib/crypto-client/passkey-vault";
import { resolvePasskeyPrfCapability } from "@/lib/crypto-client/vault-passkey-browser";
import { isAppleMobileBelowPrfMinimum, isAppleMobileUserAgent } from "@/lib/passkey/prf-support";
import { resolveActiveVaultUnlockCredentialId } from "@/lib/passkey/vault-unlock-credential";
import { logPasskeyVaultEvent } from "@/features/passkey/passkey-vault-audit";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import {
  runVaultUnlockAuthenticationCeremony,
  runVaultUnlockAuthenticationCeremonyWithOptions,
  persistVaultPasskeyBinding,
  verifyVaultUnlockAuthentication,
} from "@/lib/passkey/vault-unlock-authenticate";
import { currentDeviceLabel } from "@/lib/passkey/device-label";

export async function unlockVaultWithPasskey(
  userId: string,
  credentialId?: string,
  prefetchedOptions?: PublicKeyCredentialRequestOptionsJSON | null
): Promise<CryptoKey> {
  const effectiveCredentialId =
    credentialId ?? (await resolveActiveVaultUnlockCredentialId());

  let assertion;
  try {
    assertion = prefetchedOptions
      ? await runVaultUnlockAuthenticationCeremonyWithOptions(
          prefetchedOptions,
          effectiveCredentialId
        )
      : await runVaultUnlockAuthenticationCeremony(effectiveCredentialId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(PASSKEY_VAULT_UNLOCK_NOT_CONFIGURED_MESSAGE)) {
      throw new Error(PASSKEY_VAULT_UNLOCK_NOT_CONFIGURED_MESSAGE);
    }
    if (message.includes(PASSKEY_NOT_AVAILABLE_FOR_VAULT_UNLOCK_MESSAGE)) {
      throw new Error(PASSKEY_NOT_AVAILABLE_FOR_VAULT_UNLOCK_MESSAGE);
    }
    throw error;
  }

  const clientExtensionResults = assertion.clientExtensionResults as Record<string, unknown>;
  let result;
  try {
    result = await verifyVaultUnlockAuthentication(assertion);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes(PASSKEY_VAULT_UNLOCK_NOT_CONFIGURED_MESSAGE)) {
      throw new Error(PASSKEY_VAULT_UNLOCK_NOT_CONFIGURED_MESSAGE);
    }
    if (message.includes(PASSKEY_NOT_LINKED_TO_VAULT_UNLOCK_MESSAGE)) {
      throw new Error(PASSKEY_NOT_LINKED_TO_VAULT_UNLOCK_MESSAGE);
    }
    if (message.includes(PASSKEY_NOT_AVAILABLE_FOR_VAULT_UNLOCK_MESSAGE)) {
      throw new Error(PASSKEY_NOT_AVAILABLE_FOR_VAULT_UNLOCK_MESSAGE);
    }
    throw error;
  }

  if (!result.verified || result.verifiedCredentialId !== assertion.id) {
    throw new Error(PASSKEY_NOT_LINKED_TO_VAULT_UNLOCK_MESSAGE);
  }

  const capability = resolvePasskeyPrfCapability({
    ceremony: "authentication",
    verifiedCredentialId: result.verifiedCredentialId,
    clientExtensionResults,
  });
  const prfOutput = extractPasskeyPrfOutput(
    clientExtensionResults,
    result.verifiedCredentialId
  );
  if (capability.state !== "confirmed_authentication" || !prfOutput) {
    logPasskeyVaultEvent("passkey_vault_unlock_failed", {
      method: "passkey",
      errorCode: "prf_required",
    });
    throw new Error(
      getPasskeyPrfDiagnosticMessage(
        resolveCeremonyDiagnosticReason({ prfOutputPresent: false })
      )
    );
  }

  try {
    const unlockResult = await unlockVaultFromPasskeyEnvelopeCandidates({
      userId,
      verifiedCredentialId: result.verifiedCredentialId,
      candidates: result.candidates,
      prfOutput,
    });
    if (unlockResult.status !== "matched") {
      if (unlockResult.status === "prf_unavailable") {
        throw new Error(
          getPasskeyPrfDiagnosticMessage(
            resolveCeremonyDiagnosticReason({ prfOutputPresent: false })
          )
        );
      }
      if (unlockResult.status === "no_match") {
        throw new Error(resolvePasskeyVaultDecryptFailureMessage());
      }
      throw new Error(PASSKEY_NOT_LINKED_TO_VAULT_UNLOCK_MESSAGE);
    }

    try {
      await persistVaultPasskeyBinding({
        bindingProof: result.bindingProof,
        verifiedCredentialId: result.verifiedCredentialId,
        selectedEnvelopeVariantId: unlockResult.envelopeVariantId,
        deviceLabel: currentDeviceLabel(),
      });
    } catch {
      // The verified local unlock remains valid. Binding is routing-only and can be retried.
    }
    logPasskeyVaultEvent("passkey_vault_unlock_succeeded", { method: "passkey" });
    return unlockResult.vaultKey;
  } catch (error) {
    logPasskeyVaultEvent("passkey_vault_unlock_failed", {
      method: "passkey",
      errorCode:
        error instanceof Error && error.message.includes("PRF") ? "prf_required" : "unwrap_failed",
    });
    throw new Error(mapPasskeyCryptoError(error) ?? resolvePasskeyVaultDecryptFailureMessage());
  }
}

function resolvePasskeyVaultDecryptFailureMessage(): string {
  if (isAppleMobileBelowPrfMinimum()) {
    return PASSKEY_UNLOCK_IOS_PRF_TOO_OLD_MESSAGE;
  }
  if (isAppleMobileUserAgent()) {
    return PASSKEY_UNLOCK_PRF_MISMATCH_APPLE_HINT_MESSAGE;
  }
  return PASSKEY_UNLOCK_PRF_MISMATCH_MESSAGE;
}
