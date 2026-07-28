import { NextResponse } from "next/server";
import { secureAuth } from "@/lib/secure-auth";
import { requireFullyAuthenticatedUser } from "@/lib/auth/session";
import { passkeyVaultEnvelopeService } from "@/server/services/passkey-vault-envelope-service";
import { applyVaultRegistrationProofCookie } from "@/lib/passkey/vault-registration-proof-cookie";

/**
 * Delegates account registration verification to secure-auth. After a successful exact
 * verification, an app-owned HttpOnly receipt permits the browser-only hook to append the vault
 * envelope produced by the same create() ceremony. Account registration still succeeds if this
 * optional receipt cannot be issued.
 */
export async function POST(request: Request) {
  const bodyPromise = request
    .clone()
    .json()
    .catch(() => null) as Promise<{ action?: unknown } | null>;
  const response = await secureAuth.routes.passkeyRegister.POST(request);
  const requestBody = await bodyPromise;
  if (!response.ok || requestBody?.action !== "verify") return response;

  try {
    const payload = (await response.clone().json()) as { credentialId?: unknown };
    if (typeof payload.credentialId !== "string") return response;
    const user = await requireFullyAuthenticatedUser();
    const enrollment = await passkeyVaultEnvelopeService.issueRegistrationEnrollmentProof(
      user.id,
      payload.credentialId
    );
    const enhanced = new NextResponse(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
    applyVaultRegistrationProofCookie(enhanced, enrollment.enrollmentProof);
    return enhanced;
  } catch {
    return response;
  }
}
