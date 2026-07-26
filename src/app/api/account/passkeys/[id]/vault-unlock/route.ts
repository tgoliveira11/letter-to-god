import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFullyAuthenticatedUser } from "@/lib/auth/session";
import { passkeyVaultEnvelopeService } from "@/server/services/passkey-vault-envelope-service";
import { apiError, parseJsonBody } from "@/lib/api-helpers";
import { rejectPasskeyVaultForbiddenFields } from "@/server/policies/passkey-vault-plaintext-rejection";
import {
  clearVaultDeviceBindingCookie,
  readVaultDeviceBindingIdFromCookies,
} from "@/lib/passkey/vault-device-binding-cookie";

type RouteContext = { params: Promise<{ id: string }> };

const deleteBodySchema = z.object({
  bindingProof: z.string().min(20).max(256),
  verifiedCredentialId: z.string().min(1).max(2048),
  selectedEnvelopeVariantId: z.string().uuid(),
});

async function respondAfterDisable(result: { success: boolean; removedBindingIds: string[] }) {
  const response = NextResponse.json(result);
  const cookieBindingId = await readVaultDeviceBindingIdFromCookies();
  if (cookieBindingId && result.removedBindingIds.includes(cookieBindingId)) {
    clearVaultDeviceBindingCookie(response);
  }
  return response;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const user = await requireFullyAuthenticatedUser();
    const { id } = await context.params;
    const status = await passkeyVaultEnvelopeService.getVaultUnlockStatus(user.id, id);
    return NextResponse.json(status);
  } catch (error) {
    return apiError(error, "GET /api/account/passkeys/:id/vault-unlock");
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const user = await requireFullyAuthenticatedUser();
    const { id } = await context.params;
    const body = await parseJsonBody(request);
    const plaintextError = rejectPasskeyVaultForbiddenFields(body);
    if (plaintextError) {
      return NextResponse.json({ error: plaintextError }, { status: 400 });
    }
    const parsed = deleteBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "A verified local passkey envelope match is required to disable vault unlock." },
        { status: 400 }
      );
    }

    const result = await passkeyVaultEnvelopeService.disableVaultUnlockWithProof(
      user.id,
      id,
      parsed.data
    );
    return respondAfterDisable(result);
  } catch (error) {
    return apiError(error, "DELETE /api/account/passkeys/:id/vault-unlock");
  }
}
