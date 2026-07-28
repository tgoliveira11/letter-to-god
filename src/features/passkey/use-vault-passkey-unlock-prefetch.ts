"use client";

import { useCallback, useEffect, useState } from "react";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import { apiClient } from "@/lib/api-client/client";
import { requestVaultUnlockAuthenticationOptions } from "@/lib/passkey/vault-unlock-authenticate";

export type VaultPasskeyUnlockPrefetch = {
  options: PublicKeyCredentialRequestOptionsJSON;
  credentialId?: string;
};

/**
 * Prefetch WebAuthn options so `startAuthentication` can run immediately on tap.
 * Mobile Safari requires the ceremony to start inside the user gesture — fetching
 * options over the network after the click breaks unlock.
 */
export function useVaultPasskeyUnlockPrefetch(
  enabled: boolean,
  intent: "explicit" | "quick" = "quick"
) {
  const [prefetch, setPrefetch] = useState<VaultPasskeyUnlockPrefetch | null>(null);

  const refresh = useCallback(async (): Promise<VaultPasskeyUnlockPrefetch | null> => {
    if (!enabled) {
      setPrefetch(null);
      return null;
    }
    try {
      let credentialId: string | undefined;
      if (intent === "quick") {
        const list = await apiClient.get<{
          currentDeviceCredentialId?: string | null;
        }>("/api/passkeys/vault-unlock");
        credentialId = list.currentDeviceCredentialId ?? undefined;
        if (!credentialId) {
          setPrefetch(null);
          return null;
        }
      }
      const options = await requestVaultUnlockAuthenticationOptions(credentialId, intent);
      const next = { options, credentialId };
      setPrefetch(next);
      return next;
    } catch {
      setPrefetch(null);
      return null;
    }
  }, [enabled, intent]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { prefetch, options: prefetch?.options ?? null, credentialId: prefetch?.credentialId, refresh };
}
