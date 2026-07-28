import { NextResponse } from "next/server";
import { secureAuth } from "@/lib/secure-auth";
import { passkeyRepository } from "@/server/repositories/passkey-repository";
import { passkeyPrfExtensions } from "@/lib/passkey/prf";

/**
 * secure-auth owns login options/challenge generation. For an already opt-in dual-capability
 * credential, SelahKeep adds only the public PRF salt input; secure-auth still verifies the one
 * sanitized assertion and owns the authoritative counter CAS.
 */
export async function POST(request: Request) {
  const response = await secureAuth.routes.passkeyLoginOptions.POST(request);
  if (!response.ok) return response;

  try {
    const payload = (await response.clone().json()) as {
      options?: {
        allowCredentials?: Array<{ id?: unknown }>;
        extensions?: Record<string, unknown>;
      };
    };
    const credentialIds = (payload.options?.allowCredentials ?? [])
      .map((item) => item.id)
      .filter((id): id is string => typeof id === "string");
    if (credentialIds.length === 0 || !payload.options) return response;
    const credential = (
      await Promise.all(
        credentialIds.map((credentialId) =>
          passkeyRepository.findByCredentialId(credentialId)
        )
      )
    ).find((candidate) => candidate?.vaultUnlockEnabled);
    if (!credential) return response;

    payload.options.extensions = {
      ...payload.options.extensions,
      ...passkeyPrfExtensions(credential.userId),
    };
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return NextResponse.json(payload, { status: response.status, headers });
  } catch {
    return response;
  }
}
