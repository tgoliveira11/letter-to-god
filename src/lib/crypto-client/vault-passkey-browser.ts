import type { AuthenticationExtensionsClientInputs } from "@simplewebauthn/browser";
import type { AuthenticationExtensionsClientOutputs } from "@simplewebauthn/browser";
import { SELAHKEEP_PRF_SALT_PREFIX } from "@/modules/vault/selahkeep-profile";
import {
  buildPrfSaltBytes,
  extractPasskeyPrfOutput as extractPasskeyPrfOutputCore,
  isPasskeySupported as isPasskeySupportedCore,
  isPrfExtensionSupported as isPrfExtensionSupportedCore,
} from "@tgoliveira/vault-core/browser";

export async function passkeyPrfSaltBytes(userId: string): Promise<ArrayBuffer> {
  return buildPrfSaltBytes(SELAHKEEP_PRF_SALT_PREFIX, userId);
}

export async function buildPasskeyPrfAuthExtensions(
  userId: string
): Promise<AuthenticationExtensionsClientInputs> {
  const salt = await passkeyPrfSaltBytes(userId);
  return {
    prf: {
      eval: {
        first: new Uint8Array(salt),
      },
    },
  } as AuthenticationExtensionsClientInputs;
}

/** WebAuthn availability — checks globalThis and window for test/runtime compatibility. */
export function isPasskeySupported(): boolean {
  if (isPasskeySupportedCore()) return true;
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined"
  );
}

export function isPrfExtensionSupported(): boolean {
  if (!isPasskeySupported()) return false;
  return isPrfExtensionSupportedCore();
}

export function extractPasskeyPrfOutput(
  clientExtensionResults: AuthenticationExtensionsClientOutputs | Record<string, unknown>,
  credentialId?: string
): Uint8Array | null {
  return extractPasskeyPrfOutputCore(
    clientExtensionResults as Record<string, unknown>,
    { credentialId }
  );
}

export {
  resolvePasskeyPrfCapability,
  sanitizeWebAuthnResponseForServer,
} from "@tgoliveira/vault-core/browser";
