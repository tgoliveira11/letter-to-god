import { apiClient } from "./client";

export const passkeysApi = {
  removeAllVaultUnlock: () =>
    apiClient.delete<{
      success: boolean;
      removedVaultPasskeyCount: number;
      preservedSignInPasskeyCount: number;
    }>("/api/passkeys/vault-unlock"),
};
