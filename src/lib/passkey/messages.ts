import {
  getPasskeyPrfDiagnosticMessage,
  type PasskeyPrfDiagnosticReason,
} from "@/lib/passkey/passkey-prf-diagnostics";

export const PASSKEY_PRF_UNAVAILABLE_HEADLINE =
  "This browser or passkey provider does not support vault unlock with passkey. Your vault was not linked to this passkey. Use your vault password or recovery phrase to unlock.";

export function passkeyPrfDiagnosticMessage(reason: PasskeyPrfDiagnosticReason): string {
  return getPasskeyPrfDiagnosticMessage(reason);
}

export const PASSKEY_ORPHAN_CREDENTIAL_NOTE =
  "The passkey was registered, but no vault envelope was created. You can confirm it later from Vault settings or remove the unused credential.";

export const PASSKEY_VAULT_REGISTERED_MESSAGE =
  "Passkey registered and authentication-confirmed. You can unlock your vault with this passkey.";

export const PASSKEY_VAULT_CONFIRMATION_CANCELLED_MESSAGE =
  "The passkey was created, but vault unlock was not enabled because its confirmation was cancelled. You can finish from Vault settings.";

export type PasskeySetupOutcome =
  | "idle"
  | "vault-registered"
  | "prf-unavailable"
  | "cancelled"
  | "failed";

export const PASSKEY_LOGIN_CANCELLED_MESSAGE = "Passkey sign-in was cancelled.";

export const PASSKEY_LOGIN_UNSUPPORTED_MESSAGE =
  "This browser does not support passkey sign-in.";

export const PASSKEY_VAULT_UNLOCK_ENABLED_MESSAGE =
  "Passkey vault unlock is now enabled for this passkey.";

export const PASSKEY_VAULT_UNLOCK_ENABLED_REFRESH_WARNING =
  "Passkey vault unlock is enabled, but the updated status could not be loaded. Refresh this page to update it.";

export const PASSKEY_VAULT_UNLOCK_DISABLED_MESSAGE =
  "Passkey vault unlock was disabled. This passkey can still sign you in.";

export const PASSKEY_VAULT_UNLOCK_NOT_CONFIGURED_MESSAGE =
  "Passkey vault unlock is not configured yet.";

export const PASSKEY_VAULT_UNLOCK_CONFIGURED_ON_ANOTHER_DEVICE_MESSAGE =
  "Passkey vault unlock is configured but this browser has not selected a working variant yet. Try the same synced passkey; if it does not match, Vault settings will guide you through compatibility confirmation.";

export const PASSKEY_ACCOUNT_ONLY_FOR_SIGN_IN_MESSAGE =
  "This passkey is for account sign-in, not vault unlock.";

export const PASSKEY_NOT_LINKED_TO_VAULT_UNLOCK_MESSAGE =
  "This passkey is not linked to vault unlock.";

export const PASSKEY_NOT_AVAILABLE_FOR_VAULT_UNLOCK_MESSAGE =
  "This passkey is not available for vault unlock.";

export const PASSKEY_UNLOCK_NO_ENVELOPE_MESSAGE =
  "You are signed in, but this passkey is not set up to unlock your vault.";

export const PASSKEY_UNLOCK_PRF_UNAVAILABLE_MESSAGE =
  "Passkey vault unlock is not supported by this browser or passkey provider.";

export const PASSKEY_UNLOCK_DECRYPT_FAILED_MESSAGE =
  "We could not unlock your vault with this passkey. Use your vault password or recovery phrase.";

/** Shown when WebAuthn succeeds but PRF bytes do not match the stored vault envelope. */
export const PASSKEY_UNLOCK_PRF_MISMATCH_MESSAGE =
  "This passkey authenticated, but its PRF output did not match a saved vault variant. Use your vault password or recovery phrase, then confirm compatibility for this same passkey in Vault settings.";

/** iPhone/iPad decrypt failure — synced-credential compatibility guidance. */
export const PASSKEY_UNLOCK_PRF_MISMATCH_APPLE_HINT_MESSAGE =
  "This passkey authenticated, but it did not match a saved vault variant on this iPhone or iPad. Unlock with your vault password or recovery phrase, then confirm compatibility for the same synced passkey in Vault settings. If your password manager does not support WebAuthn PRF here, try a PRF-compatible provider such as iCloud Keychain.";

/** Shown when the OS is too old for mobile WebAuthn PRF (iOS/iPadOS before 18). */
export const PASSKEY_UNLOCK_IOS_PRF_TOO_OLD_MESSAGE =
  "Vault passkey unlock is not available on this iPhone or iPad version. It requires iOS or iPadOS 18 or later. Use your vault password or recovery phrase, or unlock from a desktop browser where vault passkey unlock is configured.";

export const PASSKEY_VAULT_UNLOCK_TEST_SUCCEEDED_MESSAGE =
  "Passkey test succeeded. This browser returned PRF output for your vault unlock passkey.";

export const PASSKEY_VAULT_UNLOCK_ACCOUNT_LOGIN_NOTE =
  "Use a compatible passkey to unlock your vault after you sign in. This is separate from account passkey sign-in and requires WebAuthn PRF support from your browser and passkey provider.";

/** Shown when passkey envelope wrap needs re-unlock to cache inner key material. */
export const PASSKEY_VAULT_UNLOCK_REWRAP_REQUIRES_UNLOCK_MESSAGE =
  "Lock your vault, unlock it again with your vault password or recovery phrase on this device, then set up passkey vault unlock.";

export const PASSKEY_VAULT_UNLOCK_READONLY_HEADLINE =
  "Passkey vault unlock is enabled, but cannot be managed in this browser.";

export const PASSKEY_VAULT_UNLOCK_READONLY_MESSAGE =
  "This browser supports passkeys for sign-in, but it does not report PRF support. PRF is required to test, replace, or disable passkey vault unlock. Use a PRF-compatible browser where vault unlock was configured, or unlock with your vault password or recovery phrase.";

export const PASSKEY_PLATFORM_AUTHENTICATOR_CONFLICT_MESSAGE =
  "This passkey already exists on this device. Remove it from your password manager or use a different passkey.";
