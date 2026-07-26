import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFullyAuthenticatedUser } from "@/lib/auth/session";
import {
  passkeyService,
  StaleVaultDeviceBindingError,
} from "@/server/services/passkey-service";
import { unbindVaultPasskeyFromThisDevice } from "@/server/services/vault-passkey-device-binding-service";
import { apiError, parseJsonBody } from "@/lib/api-helpers";
import { getClientIp } from "@/lib/request-ip";
import {
  applyVaultDeviceBindingCookie,
  clearVaultDeviceBindingCookie,
  readVaultDeviceBindingIdFromCookies,
} from "@/lib/passkey/vault-device-binding-cookie";
import { rejectPasskeyVaultForbiddenFields } from "@/server/policies/passkey-vault-plaintext-rejection";

const authSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("options"),
    purpose: z.literal("vault_unlock"),
    credentialId: z.string().min(1).max(2048).optional(),
  }),
  z.object({
    action: z.literal("verify"),
    purpose: z.literal("vault_unlock"),
    response: z.unknown(),
  }),
  z.object({
    action: z.literal("bind"),
    purpose: z.literal("vault_unlock"),
    bindingProof: z.string().min(20).max(256),
    verifiedCredentialId: z.string().min(1).max(2048),
    selectedEnvelopeVariantId: z.string().uuid(),
    deviceLabel: z.string().max(80).optional(),
  }),
]);

export async function POST(request: Request) {
  try {
    const user = await requireFullyAuthenticatedUser();
    const body = await parseJsonBody(request);
    const plaintextError = rejectPasskeyVaultForbiddenFields(body);
    if (plaintextError) {
      return NextResponse.json({ error: plaintextError }, { status: 400 });
    }
    const parsed = authSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const deviceBindingId = await readVaultDeviceBindingIdFromCookies();

    if (parsed.data.action === "options") {
      const options = await passkeyService.getAuthenticationOptions(
        user.id,
        getClientIp(request),
        {
          purpose: parsed.data.purpose,
          deviceBindingId,
          credentialId: parsed.data.credentialId,
        }
      );
      return NextResponse.json(options);
    }

    if (parsed.data.action === "bind") {
      const result = await passkeyService.bindVerifiedCredentialToDevice(user.id, {
        bindingProof: parsed.data.bindingProof,
        verifiedCredentialId: parsed.data.verifiedCredentialId,
        selectedEnvelopeVariantId: parsed.data.selectedEnvelopeVariantId,
        existingDeviceBindingId: deviceBindingId,
        deviceLabel: parsed.data.deviceLabel,
      });
      const response = NextResponse.json(result);
      applyVaultDeviceBindingCookie(response, result.bindingId);
      return response;
    }

    const result = await passkeyService.verifyAuthentication(
      user.id,
      parsed.data.response as Parameters<typeof passkeyService.verifyAuthentication>[1],
      { purpose: parsed.data.purpose, deviceBindingId }
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof StaleVaultDeviceBindingError) {
      const response = NextResponse.json({ error: error.message }, { status: 409 });
      clearVaultDeviceBindingCookie(response);
      return response;
    }
    return apiError(error, "POST /api/passkeys/authenticate");
  }
}

export async function DELETE() {
  try {
    const user = await requireFullyAuthenticatedUser();
    const deviceBindingId = await readVaultDeviceBindingIdFromCookies();
    if (deviceBindingId) {
      await unbindVaultPasskeyFromThisDevice(user.id, deviceBindingId);
    }
    const response = NextResponse.json({ success: true });
    clearVaultDeviceBindingCookie(response);
    return response;
  } catch (error) {
    return apiError(error, "DELETE /api/passkeys/authenticate");
  }
}
