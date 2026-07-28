/**
 * Product-owned WebAuthn challenge audiences. Account registration/login audiences
 * remain exclusively owned by @tgoliveira/secure-auth.
 */
export const VAULT_PASSKEY_REGISTRATION_CHALLENGE =
  "selahkeep:vault:passkey:registration";

export const VAULT_PASSKEY_UNLOCK_CHALLENGE =
  "selahkeep:vault:passkey:unlock";

export function vaultPasskeyEnrollmentChallenge(credentialDbId: string): string {
  return `selahkeep:vault:passkey:enrollment:${credentialDbId}`;
}

export function vaultEnvelopeEnrollmentProofAudience(credentialDbId: string): string {
  return `selahkeep:vault:envelope:enrollment:${credentialDbId}`;
}

export function vaultBindingProofAudience(credentialDbId: string): string {
  return `selahkeep:vault:binding:${credentialDbId}`;
}
