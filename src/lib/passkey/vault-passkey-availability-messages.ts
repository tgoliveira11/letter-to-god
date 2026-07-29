import type { VaultPasskeyAvailability } from "@/lib/passkey/vault-passkey-availability";

export type VaultPasskeyAvailabilityCopy = {
  headline: string;
  explanation: string;
  cta?: string;
  variant: "success" | "warning" | "muted" | "info";
};

export const VAULT_PASSKEY_SECTION_INTRO =
  "Use one synced account passkey to authorize portable vault unlock after you sign in. Login and vault unlock remain separate security actions; password and recovery phrase stay available.";

export const VAULT_PASSKEY_INDEPENDENCE_NOTE =
  "Account authentication and vault unlock are independent security actions. The same eligible passkey may authorize both, but neither action unlocks the other.";

export function getVaultPasskeyAvailabilityCopy(
  availability: VaultPasskeyAvailability
): VaultPasskeyAvailabilityCopy | null {
  switch (availability.state) {
    case "vault_not_configured":
      return {
        headline: "Set up your vault first.",
        explanation: "Configure your vault before setting up passkey vault unlock.",
        variant: "muted",
      };
    case "vault_locked":
      return {
        headline: "Unlock your vault to set up passkey vault unlock.",
        explanation: "Passkey vault unlock can only be configured while your vault is open on this device.",
        variant: "warning",
      };
    case "browser_unsupported":
      return {
        headline: "Passkey vault unlock is unavailable in this browser.",
        explanation:
          "This browser does not provide the WebAuthn features SelahKeep needs for passkey vault unlock.",
        variant: "warning",
      };
    case "prf_unsupported":
      return {
        headline: "Passkey vault unlock is not supported by this browser or passkey provider.",
        explanation:
          "Account passkey sign-in may still work here, but vault passkey unlock requires WebAuthn PRF.",
        variant: "warning",
      };
    case "unknown":
      return {
        headline: "Passkey vault unlock support could not be confirmed yet.",
        explanation:
          "You can try passkey setup — SelahKeep only enables vault unlock when your passkey returns PRF output during the ceremony.",
        cta: "Try passkey setup",
        variant: "muted",
      };
    case "available":
      return {
        headline: "Passkey vault unlock is available on this device.",
        explanation: "Set up a vault passkey while your vault is unlocked.",
        cta: "Set up passkey vault unlock",
        variant: "info",
      };
    case "not_configured":
      return null;
    case "configured":
      if (availability.unavailableInThisBrowser) {
        return {
          headline: "Passkey vault unlock is configured, but unavailable in this browser.",
          explanation:
            "Use a PRF-compatible browser where vault unlock was configured, or unlock with your vault password or recovery phrase.",
          variant: "warning",
        };
      }
      return {
        headline: "Passkey vault unlock is configured.",
        explanation:
          "You can use a compatible passkey to unlock your vault on supported browsers.",
        variant: "success",
      };
  }
}
