import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFullyAuthenticatedUser } from "@/lib/auth/session";
import { passkeyVaultEnvelopeService } from "@/server/services/passkey-vault-envelope-service";
import { encryptedPayloadSchema } from "@/lib/validation/encrypted-payload";
import { apiError, parseJsonBody } from "@/lib/api-helpers";
import { getClientIp } from "@/lib/request-ip";
import { rejectPasskeyVaultForbiddenFields } from "@/server/policies/passkey-vault-plaintext-rejection";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("options") }),
  z.object({ action: z.literal("verify"), response: z.unknown() }),
  z.object({
    action: z.literal("persist"),
    enrollmentProof: z.string().min(20).max(256),
    encryptedVaultKey: encryptedPayloadSchema,
    prfSupported: z.literal(true),
  }),
]);

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const user = await requireFullyAuthenticatedUser();
    const { id } = await context.params;
    const body = await parseJsonBody(request);
    const plaintextError = rejectPasskeyVaultForbiddenFields(body);
    if (plaintextError) {
      return NextResponse.json({ error: plaintextError }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    if (parsed.data.action === "options") {
      const options = await passkeyVaultEnvelopeService.getVaultUnlockAuthOptions(
        user.id,
        id,
        getClientIp(request)
      );
      return NextResponse.json(options);
    }

    if (parsed.data.action === "verify") {
      const result = await passkeyVaultEnvelopeService.verifyVaultUnlockEnrollment(
        user.id,
        id,
        parsed.data.response as Parameters<
          typeof passkeyVaultEnvelopeService.verifyVaultUnlockEnrollment
        >[2]
      );
      return NextResponse.json(result);
    }

    const result = await passkeyVaultEnvelopeService.persistVaultUnlockEnvelope(
      user.id,
      id,
      parsed.data.enrollmentProof,
      parsed.data.encryptedVaultKey,
      { prfSupported: parsed.data.prfSupported }
    );
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "POST /api/account/passkeys/:id/enable-vault-unlock");
  }
}
