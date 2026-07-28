import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFullyAuthenticatedUser } from "@/lib/auth/session";
import { apiError, parseJsonBody } from "@/lib/api-helpers";
import { getClientIp } from "@/lib/request-ip";
import { encryptedPayloadSchema } from "@/lib/validation/encrypted-payload";
import { passkeyVaultEnvelopeService } from "@/server/services/passkey-vault-envelope-service";
import { rejectPasskeyVaultForbiddenFields } from "@/server/policies/passkey-vault-plaintext-rejection";

const credentialIdSchema = z.string().min(1).max(2048);
const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("options"),
    verifiedCredentialId: credentialIdSchema,
  }),
  z.object({
    action: z.literal("verify"),
    verifiedCredentialId: credentialIdSchema,
    response: z.unknown(),
  }),
  z.object({
    action: z.literal("persist"),
    verifiedCredentialId: credentialIdSchema,
    enrollmentProof: z.string().min(20).max(256),
    encryptedVaultKey: encryptedPayloadSchema,
    prfSupported: z.literal(true),
  }),
]);

/**
 * Optional account/vault composition. Registration itself never authorizes persistence: this route
 * mints the single-use proof only after an exact post-registration authentication assertion.
 */
export async function POST(request: Request) {
  try {
    const user = await requireFullyAuthenticatedUser();
    const body = await parseJsonBody(request);
    const privacyError = rejectPasskeyVaultForbiddenFields(body);
    if (privacyError) return NextResponse.json({ error: privacyError }, { status: 400 });
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const credentialDbId = await passkeyVaultEnvelopeService.resolveCredentialDbId(
      user.id,
      parsed.data.verifiedCredentialId
    );

    if (parsed.data.action === "options") {
      return NextResponse.json(
        await passkeyVaultEnvelopeService.getVaultUnlockAuthOptions(
          user.id,
          credentialDbId,
          getClientIp(request)
        )
      );
    }

    if (parsed.data.action === "verify") {
      const verified = await passkeyVaultEnvelopeService.verifyVaultUnlockEnrollment(
        user.id,
        credentialDbId,
        parsed.data.response as Parameters<
          typeof passkeyVaultEnvelopeService.verifyVaultUnlockEnrollment
        >[2]
      );
      if (verified.verifiedCredentialId !== parsed.data.verifiedCredentialId) {
        return NextResponse.json({ error: "Passkey mismatch" }, { status: 409 });
      }
      return NextResponse.json(verified);
    }

    return NextResponse.json(
      await passkeyVaultEnvelopeService.persistVaultUnlockEnvelope(
        user.id,
        credentialDbId,
        parsed.data.enrollmentProof,
        parsed.data.encryptedVaultKey,
        { prfSupported: true }
      )
    );
  } catch (error) {
    return apiError(error, "POST /api/passkeys/account-registration-vault");
  }
}
