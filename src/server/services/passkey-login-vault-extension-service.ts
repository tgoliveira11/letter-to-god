import type {
  PasskeyLoginAuthenticationExtensions,
  PasskeyLoginAuthenticationExtensionsContext,
} from "@tgoliveira/secure-auth";
import { buildPasskeyPrfAuthenticationExtensionsJson } from "@tgoliveira/vault-core";
import { SELAHKEEP_PRF_SALT_PREFIX } from "@/modules/vault/selahkeep-profile";
import { passkeyRepository } from "@/server/repositories/passkey-repository";

/**
 * Server-only secure-auth composition. It returns only the public PRF salt when the resolved
 * account allow-list contains a credential that the same user explicitly enabled for vault unlock.
 */
export async function getVaultPasskeyLoginAuthenticationExtensions({
  userId,
  credentialIds,
}: Readonly<PasskeyLoginAuthenticationExtensionsContext>): Promise<
  PasskeyLoginAuthenticationExtensions | undefined
> {
  const allowedCredentialIds = new Set(credentialIds);
  const credentials = await passkeyRepository.findByUserId(userId);
  const hasDualCapabilityCredential = credentials.some(
    (credential) =>
      credential.vaultUnlockEnabled && allowedCredentialIds.has(credential.credentialId)
  );
  if (!hasDualCapabilityCredential) return undefined;

  return buildPasskeyPrfAuthenticationExtensionsJson(SELAHKEEP_PRF_SALT_PREFIX, userId);
}
