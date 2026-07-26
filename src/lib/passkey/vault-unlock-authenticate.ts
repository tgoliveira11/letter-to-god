import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import {
  prepareVaultUnlockAuthenticationOptions as prepareVaultUnlockAuthenticationOptionsCore,
  sanitizeWebAuthnResponseForServer,
} from "@tgoliveira/vault-core/browser";
import type { VaultPasskeyEnvelopeVariant } from "@tgoliveira/vault-core";
import { apiClient } from "@/lib/api-client/client";
import { prepareAuthenticationOptions } from "@/lib/passkey/prepare-webauthn-options";
import { PASSKEY_NOT_AVAILABLE_FOR_VAULT_UNLOCK_MESSAGE } from "@/lib/passkey/messages";
import { logVaultUnlockAuthDiagnostic } from "@/lib/passkey/vault-unlock-auth-diagnostics";

/** Purpose sent to POST /api/passkeys/authenticate for vault PRF unlock only. */
export const VAULT_UNLOCK_AUTHENTICATE_PURPOSE = "vault_unlock" as const;

export type VaultUnlockAuthenticatePurpose = typeof VAULT_UNLOCK_AUTHENTICATE_PURPOSE;

export function filterAuthenticationOptionsForCredential(
  options: PublicKeyCredentialRequestOptionsJSON,
  credentialId?: string
): PublicKeyCredentialRequestOptionsJSON {
  const envelopeCredentialId =
    credentialId ??
    (options.allowCredentials?.length === 1 ? options.allowCredentials?.[0]?.id : undefined);

  try {
    return prepareVaultUnlockAuthenticationOptionsCore(
      options as unknown as Parameters<typeof prepareVaultUnlockAuthenticationOptionsCore>[0],
      {
        credentialSelection: envelopeCredentialId
          ? { mode: "exact", credentialId: envelopeCredentialId }
          : { mode: "allow-list" },
        transportPolicy: "preserve",
      }
    ) as unknown as PublicKeyCredentialRequestOptionsJSON;
  } catch {
    throw new Error(PASSKEY_NOT_AVAILABLE_FOR_VAULT_UNLOCK_MESSAGE);
  }
}

/** Shared client prep for vault unlock auth ceremonies (setup, test, unlock). */
export function prepareVaultUnlockAuthenticationOptions(
  options: PublicKeyCredentialRequestOptionsJSON,
  credentialId?: string
): PublicKeyCredentialRequestOptionsJSON {
  const effectiveCredentialId =
    credentialId ??
    (options.allowCredentials?.length === 1 ? options.allowCredentials?.[0]?.id : undefined);
  return prepareAuthenticationOptions(
    filterAuthenticationOptionsForCredential(options, effectiveCredentialId)
  );
}

export async function requestVaultUnlockAuthenticationOptions(
  credentialId?: string
): Promise<PublicKeyCredentialRequestOptionsJSON> {
  const options = (await apiClient.post("/api/passkeys/authenticate", {
    action: "options",
    purpose: VAULT_UNLOCK_AUTHENTICATE_PURPOSE,
    ...(credentialId ? { credentialId } : {}),
  })) as PublicKeyCredentialRequestOptionsJSON;

  const filtered = filterAuthenticationOptionsForCredential(options, credentialId);
  logVaultUnlockAuthDiagnostic(filtered);
  return filtered;
}

export async function runVaultUnlockAuthenticationCeremonyWithOptions(
  options: PublicKeyCredentialRequestOptionsJSON,
  credentialId?: string
): Promise<Awaited<ReturnType<typeof startAuthentication>>> {
  return startAuthentication({
    optionsJSON: prepareVaultUnlockAuthenticationOptions(options, credentialId),
  });
}

export async function runVaultUnlockAuthenticationCeremony(
  credentialId?: string
): Promise<Awaited<ReturnType<typeof startAuthentication>>> {
  const options = await requestVaultUnlockAuthenticationOptions(credentialId);
  return runVaultUnlockAuthenticationCeremonyWithOptions(options, credentialId);
}

export async function verifyVaultUnlockAuthentication(
  response: Awaited<ReturnType<typeof startAuthentication>>
): Promise<{
  verified: true;
  verifiedCredentialId: string;
  bindingProof: string;
  candidates: VaultPasskeyEnvelopeVariant[];
}> {
  return apiClient.post("/api/passkeys/authenticate", {
    action: "verify",
    purpose: VAULT_UNLOCK_AUTHENTICATE_PURPOSE,
    response: sanitizeWebAuthnResponseForServer(response),
  });
}

export async function persistVaultPasskeyBinding(input: {
  bindingProof: string;
  verifiedCredentialId: string;
  selectedEnvelopeVariantId: string;
  deviceLabel?: string;
}): Promise<{ bindingId: string }> {
  return apiClient.post("/api/passkeys/authenticate", {
    action: "bind",
    purpose: VAULT_UNLOCK_AUTHENTICATE_PURPOSE,
    ...input,
  });
}

export async function unbindVaultPasskeyFromThisBrowser(): Promise<{ success: boolean }> {
  return apiClient.delete("/api/passkeys/authenticate");
}
