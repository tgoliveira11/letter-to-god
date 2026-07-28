"use client";

import type { PasskeyLoginHooks } from "@tgoliveira/secure-auth/react/client";
import type { VaultPasskeyEnvelopeVariant } from "@tgoliveira/vault-core";
import { assertVaultSessionOperationCurrent } from "@tgoliveira/vault-core/browser";
import { apiClient } from "@/lib/api-client/client";
import { ApiError } from "@/lib/api-client/api-error";
import {
  extractPasskeyPrfOutput,
  unlockVaultFromPasskeyEnvelopeCandidates,
} from "@/lib/crypto-client/passkey-vault";
import { resolvePasskeyPrfCapability } from "@/lib/crypto-client/vault-passkey-browser";
import { prepareAuthenticationOptions } from "@/lib/passkey/prepare-webauthn-options";
import { persistVaultPasskeyBinding } from "@/lib/passkey/vault-unlock-authenticate";
import { currentDeviceLabel } from "@/lib/passkey/device-label";
import { beginVaultOwnerOperation } from "@/lib/crypto-client/vault-session";

const VAULT_UNLOCK_REDIRECT = "/vault/unlock";

function vaultActionRequired(code: "vault_prf_unavailable" | "vault_envelope_no_match") {
  return {
    status: "action_required" as const,
    code,
    redirectTo: VAULT_UNLOCK_REDIRECT,
    message: "Your account is signed in. Unlock your vault to continue.",
  };
}

/**
 * Optional composition: account login remains successful when vault PRF is absent or cannot
 * unwrap. With TOTP, secure-auth deliberately does not invoke this hook before final verification.
 */
export const accountPasskeyLoginVaultHooks: PasskeyLoginHooks = {
  prepareOptions: (serverOptions) => prepareAuthenticationOptions(serverOptions),
  onFullyAuthenticated: async ({ verifiedCredentialId, clientExtensionResults }) => {
    const results = clientExtensionResults as Record<string, unknown>;
    const capability = resolvePasskeyPrfCapability({
      ceremony: "authentication",
      verifiedCredentialId,
      clientExtensionResults: results,
    });
    const prfOutput = extractPasskeyPrfOutput(results, verifiedCredentialId);
    try {
      let verified: {
        userId: string;
        verifiedCredentialId: string;
        bindingProof: string;
        candidates: VaultPasskeyEnvelopeVariant[];
      };
      try {
        verified = await apiClient.post("/api/passkeys/account-login-vault-candidates", {
          verifiedCredentialId,
        });
      } catch (error) {
        // A sign-in-only credential has no vault integration to complete.
        if (error instanceof ApiError && error.status === 404) return { status: "completed" };
        throw error;
      }
      if (verified.verifiedCredentialId !== verifiedCredentialId) {
        throw new Error("Verified account and vault credential mismatch.");
      }

      const operation = beginVaultOwnerOperation(verified.userId);
      const match = await unlockVaultFromPasskeyEnvelopeCandidates({
        userId: verified.userId,
        verifiedCredentialId,
        candidates: verified.candidates,
        prfOutput,
        operation,
      });
      assertVaultSessionOperationCurrent(operation);
      if (
        capability.state !== "confirmed_authentication" ||
        !prfOutput ||
        match.status === "prf_unavailable"
      ) {
        return vaultActionRequired("vault_prf_unavailable");
      }
      if (match.status === "no_match") {
        return vaultActionRequired("vault_envelope_no_match");
      }
      if (match.status !== "matched") {
        throw new Error("Vault passkey bootstrap candidate validation failed.");
      }

      try {
        await persistVaultPasskeyBinding({
          bindingProof: verified.bindingProof,
          verifiedCredentialId,
          selectedEnvelopeVariantId: match.envelopeVariantId,
          deviceLabel: currentDeviceLabel(),
        });
        assertVaultSessionOperationCurrent(operation);
      } catch {
        // Login and local unlock remain valid; the opaque routing hint can be retried later.
      }
      return { status: "completed" };
    } finally {
      prfOutput?.fill(0);
    }
  },
};
