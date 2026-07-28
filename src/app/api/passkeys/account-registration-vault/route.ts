import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFullyAuthenticatedUser } from "@/lib/auth/session";
import { apiError, parseJsonBody } from "@/lib/api-helpers";
import { encryptedPayloadSchema } from "@/lib/validation/encrypted-payload";
import { passkeyRepository } from "@/server/repositories/passkey-repository";
import { passkeyVaultEnvelopeService } from "@/server/services/passkey-vault-envelope-service";
import { rejectPasskeyVaultForbiddenFields } from "@/server/policies/passkey-vault-plaintext-rejection";
import {
  clearVaultRegistrationProofCookie,
  readVaultRegistrationProofCookie,
} from "@/lib/passkey/vault-registration-proof-cookie";

const bodySchema = z.object({
  verifiedCredentialId: z.string().min(1).max(2048),
  encryptedVaultKey: encryptedPayloadSchema,
  prfSupported: z.literal(true),
});

export async function POST(request: Request) {
  try {
    const user = await requireFullyAuthenticatedUser();
    const body = await parseJsonBody(request);
    const privacyError = rejectPasskeyVaultForbiddenFields(body);
    if (privacyError) return NextResponse.json({ error: privacyError }, { status: 400 });
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const enrollmentProof = await readVaultRegistrationProofCookie();
    if (!enrollmentProof) {
      return NextResponse.json({ error: "Vault registration proof is missing or expired" }, { status: 409 });
    }
    const credential = await passkeyRepository.findByCredentialId(
      parsed.data.verifiedCredentialId
    );
    if (!credential || credential.userId !== user.id) {
      return NextResponse.json({ error: "Passkey not found" }, { status: 404 });
    }

    const result = await passkeyVaultEnvelopeService.persistVaultUnlockEnvelope(
      user.id,
      credential.id,
      enrollmentProof,
      parsed.data.encryptedVaultKey,
      { prfSupported: true }
    );
    const response = NextResponse.json(result);
    clearVaultRegistrationProofCookie(response);
    return response;
  } catch (error) {
    const response = apiError(error, "POST /api/passkeys/account-registration-vault");
    clearVaultRegistrationProofCookie(response as NextResponse);
    return response;
  }
}
