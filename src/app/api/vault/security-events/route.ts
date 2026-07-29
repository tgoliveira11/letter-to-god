import { NextResponse } from "next/server";
import { z } from "zod";
import { requireFullyAuthenticatedUser } from "@/lib/auth/session";
import { apiError } from "@/lib/api-helpers";
import { vaultSecurityService } from "@/server/services/vault-security-service";
import { CLIENT_RECORDABLE_VAULT_SECURITY_EVENTS } from "@/lib/vault/vault-security-event-types";

const recordSchema = z.object({
  eventType: z.enum(CLIENT_RECORDABLE_VAULT_SECURITY_EVENTS),
  metadata: z
    .object({
      method: z
        .enum(["password", "recovery_phrase", "passkey", "passkey_prf", "portable_passkey"])
        .optional(),
    })
    .optional(),
});

export async function GET() {
  try {
    const user = await requireFullyAuthenticatedUser();
    const events = await vaultSecurityService.listEvents(user.id);
    return NextResponse.json({ events });
  } catch (error) {
    return apiError(error, "GET /api/vault/security-events");
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireFullyAuthenticatedUser();
    const body = await request.json();
    const parsed = recordSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    await vaultSecurityService.recordClientEvent(
      user.id,
      parsed.data.eventType,
      parsed.data.metadata
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error, "POST /api/vault/security-events");
  }
}
