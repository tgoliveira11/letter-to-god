import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFullyAuthenticatedUser } from "@/lib/auth/session";
import { apiError, parseJsonBody } from "@/lib/api-helpers";
import { readVaultDeviceBindingIdFromCookies } from "@/lib/passkey/vault-device-binding-cookie";
import { vaultPasskeyDeviceBindingRepository } from "@/server/repositories/vault-passkey-device-binding-repository";
import { passkeyVaultEnvelopeService } from "@/server/services/passkey-vault-envelope-service";
import { rejectPasskeyVaultForbiddenFields } from "@/server/policies/passkey-vault-plaintext-rejection";
import { passkeyRepository } from "@/server/repositories/passkey-repository";

const bodySchema = z.object({
  verifiedCredentialId: z.string().min(1).max(2048),
});

/**
 * Loads ciphertext candidates after secure-auth has created the final account session. It never
 * verifies the login assertion again and never receives browser extension results.
 */
export async function POST(request: Request) {
  try {
    const user = await requireFullyAuthenticatedUser();
    const body = await parseJsonBody(request);
    const privacyError = rejectPasskeyVaultForbiddenFields(body);
    if (privacyError) return NextResponse.json({ error: privacyError }, { status: 400 });
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

    const bindingId = await readVaultDeviceBindingIdFromCookies();
    const binding = bindingId
      ? await vaultPasskeyDeviceBindingRepository.findByIdForUser(bindingId, user.id)
      : null;
    const credential = await passkeyRepository.findByCredentialId(
      parsed.data.verifiedCredentialId
    );
    const selectedEnvelopeVariantId =
      binding && credential && binding.passkeyCredentialId === credential.id
        ? binding.selectedEnvelopeVariantId
        : null;
    return NextResponse.json(
      await passkeyVaultEnvelopeService.getCandidatesAfterAccountPasskeyLogin(
        user.id,
        parsed.data.verifiedCredentialId,
        selectedEnvelopeVariantId
      )
    );
  } catch (error) {
    return apiError(error, "POST /api/passkeys/account-login-vault-candidates");
  }
}
