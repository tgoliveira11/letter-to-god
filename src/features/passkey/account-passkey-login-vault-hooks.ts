"use client";

import type { PasskeyLoginHooks } from "@tgoliveira/secure-auth/react/client";
import type { VaultPasskeyEnvelopeVariant } from "@tgoliveira/vault-core";
import { assertVaultSessionOperationCurrent } from "@tgoliveira/vault-core/browser";
import { apiClient } from "@/lib/api-client/client";
import {
  extractPasskeyPrfOutput,
  unlockVaultFromPasskeyEnvelopeCandidates,
} from "@/lib/crypto-client/passkey-vault";
import { resolvePasskeyPrfCapability } from "@/lib/crypto-client/vault-passkey-browser";
import { prepareAuthenticationOptions } from "@/lib/passkey/prepare-webauthn-options";
import {
  persistVaultPasskeyBinding,
} from "@/lib/passkey/vault-unlock-authenticate";
import { currentDeviceLabel } from "@/lib/passkey/device-label";
import { beginVaultOwnerOperation } from "@/lib/crypto-client/vault-session";

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
    if (capability.state !== "confirmed_authentication" || !prfOutput) return;

    try {
      const verified = await apiClient.post<{
        userId: string;
        verifiedCredentialId: string;
        bindingProof: string;
        candidates: VaultPasskeyEnvelopeVariant[];
      }>("/api/passkeys/account-login-vault-candidates", { verifiedCredentialId });
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
      if (match.status !== "matched") return;

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
    } finally {
      prfOutput.fill(0);
    }
  },
};
