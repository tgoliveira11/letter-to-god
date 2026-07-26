import { NextResponse } from "next/server";
import { requireFullyAuthenticatedUser } from "@/lib/auth/session";
import { passkeyService } from "@/server/services/passkey-service";
import { apiError } from "@/lib/api-helpers";
import { clearVaultDeviceBindingCookie } from "@/lib/passkey/vault-device-binding-cookie";

export async function DELETE() {
  try {
    const user = await requireFullyAuthenticatedUser();
    const result = await passkeyService.removeAllVaultUnlockCredentials(user.id);
    const response = NextResponse.json(result);
    clearVaultDeviceBindingCookie(response);
    return response;
  } catch (error) {
    return apiError(error, "DELETE /api/passkeys");
  }
}
