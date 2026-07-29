import type { AuthenticationExtensionsClientInputs } from "@simplewebauthn/server";
import { buildPasskeyPrfAuthenticationExtensionsJson } from "@tgoliveira/vault-core";
import { SELAHKEEP_PRF_SALT_PREFIX } from "@/modules/vault/selahkeep-profile";

/**
 * PRF inputs for WebAuthn ceremonies. Always `prf.eval` with the stable per-user
 * salt (SHA-256 of `SELAHKEEP_PRF_SALT_PREFIX + userId`) — the vault-core canonical
 * contract. Vault unlock scopes to a single credential server-side, so
 * `evalByCredential` is never used: iOS/Safari can return divergent PRF bytes for it.
 */
export async function passkeyPrfExtensions(
  userId: string
): Promise<AuthenticationExtensionsClientInputs> {
  // SimpleWebAuthn's server DOM shim does not yet declare WebAuthn PRF, although it accepts and
  // serializes the package-built extension object at runtime.
  return (await buildPasskeyPrfAuthenticationExtensionsJson(
    SELAHKEEP_PRF_SALT_PREFIX,
    userId
  )) as AuthenticationExtensionsClientInputs;
}
