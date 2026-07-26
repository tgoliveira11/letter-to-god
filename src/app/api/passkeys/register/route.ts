import { NextResponse } from "next/server";
import { requireFullyAuthenticatedUser } from "@/lib/auth/session";
import { passkeyService } from "@/server/services/passkey-service";
import { apiError, parseJsonBody } from "@/lib/api-helpers";
import { getClientIp } from "@/lib/request-ip";
import { z } from "zod";
import { rejectPasskeyVaultForbiddenFields } from "@/server/policies/passkey-vault-plaintext-rejection";

const verifySchema = z.object({
  action: z.enum(["options", "verify"]),
  response: z.unknown().optional(),
  vaultOnly: z.literal(true).optional(),
  friendlyName: z.string().max(60).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireFullyAuthenticatedUser();
    const body = await parseJsonBody(request);
    const plaintextError = rejectPasskeyVaultForbiddenFields(body);
    if (plaintextError) {
      return NextResponse.json({ error: plaintextError }, { status: 400 });
    }
    const parsed = verifySchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const ip = getClientIp(request);

    if (parsed.data.action === "options") {
      const options = await passkeyService.getRegistrationOptions(
        user.id,
        user.email,
        ip,
        parsed.data.vaultOnly ? { vaultOnly: true } : undefined
      );
      return NextResponse.json(options);
    }

    if (!parsed.data.response) {
      return NextResponse.json({ error: "Missing registration response" }, { status: 400 });
    }

    const result = await passkeyService.verifyRegistration(
      user.id,
      parsed.data.response as Parameters<typeof passkeyService.verifyRegistration>[1],
      {
        vaultOnly: parsed.data.vaultOnly,
        friendlyName: parsed.data.friendlyName,
      }
    );
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error, "POST /api/passkeys/register");
  }
}
