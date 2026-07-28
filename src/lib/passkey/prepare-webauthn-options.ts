import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import {
  prepareVaultPasskeyPrfAuthenticationOptions,
  prepareVaultPasskeyPrfRegistrationOptions,
  prepareWebAuthnPrfExtensions,
  type PublicKeyCredentialCreationOptionsInput,
  type PublicKeyCredentialRequestOptionsInput,
} from "@tgoliveira/vault-core/browser";
import type { PasskeyCredentialSelection } from "@tgoliveira/vault-core";
import { SELAHKEEP_PRF_SALT_PREFIX } from "@/modules/vault/selahkeep-profile";

export { alignPrfExtensionsForCredential as alignPrfExtensionsForAllowCredentials } from "@tgoliveira/vault-core/browser";

type PrfExtensionInput = Parameters<typeof prepareWebAuthnPrfExtensions>[0];

/** Converts server JSON WebAuthn options so PRF salts are ArrayBuffers for the browser API. */
export function prepareWebAuthnExtensions<T extends PrfExtensionInput>(extensions: T): T {
  return prepareWebAuthnPrfExtensions(extensions) as T;
}

export function prepareRegistrationOptions(
  options: PublicKeyCredentialCreationOptionsJSON
): PublicKeyCredentialCreationOptionsJSON {
  if (!options.extensions) return options;
  return {
    ...options,
    extensions: prepareWebAuthnPrfExtensions(
      options.extensions as PrfExtensionInput
    ) as PublicKeyCredentialCreationOptionsJSON["extensions"],
  };
}

/** SimpleWebAuthn keeps JSON fields encoded and passes the core-prepared PRF extension through. */
export async function prepareVaultRegistrationOptions(
  options: PublicKeyCredentialCreationOptionsJSON,
  userId: string
): Promise<PublicKeyCredentialCreationOptionsJSON> {
  return prepareVaultPasskeyPrfRegistrationOptions({
    userId,
    prfSaltPrefix: SELAHKEEP_PRF_SALT_PREFIX,
    serverOptions: options as unknown as PublicKeyCredentialCreationOptionsInput,
  }) as unknown as PublicKeyCredentialCreationOptionsJSON;
}

/** Full vault-core PRF preparation for an authentication ceremony. */
export async function prepareVaultAuthenticationOptions(
  options: PublicKeyCredentialRequestOptionsJSON,
  userId: string,
  credentialSelection?: PasskeyCredentialSelection
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  return (await prepareVaultPasskeyPrfAuthenticationOptions({
    userId,
    prfSaltPrefix: SELAHKEEP_PRF_SALT_PREFIX,
    serverOptions: options as unknown as PublicKeyCredentialRequestOptionsInput,
    credentialSelection,
  })) as unknown as PublicKeyCredentialRequestOptionsJSON;
}

export function prepareAuthenticationOptions(
  options: PublicKeyCredentialRequestOptionsJSON
): PublicKeyCredentialRequestOptionsJSON {
  if (!options.extensions) return options;
  return {
    ...options,
    extensions: prepareWebAuthnPrfExtensions(
      options.extensions as PrfExtensionInput
    ) as PublicKeyCredentialRequestOptionsJSON["extensions"],
  };
}
