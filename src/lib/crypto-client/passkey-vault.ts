export {
  wrapVaultKeyForPasskey,
  unwrapVaultKeyFromPasskey,
  unlockVaultFromPasskeyEnvelope,
  unlockVaultFromPasskeyEnvelopeCandidates,
  PasskeyPrfRequiredError,
  PasskeyUnlockError,
} from "@/modules/vault/core/envelopes/passkey-prf-envelope";

export {
  isPasskeySupported,
  isPrfExtensionSupported,
  extractPasskeyPrfOutput,
} from "@/modules/vault/client/passkey-prf";
