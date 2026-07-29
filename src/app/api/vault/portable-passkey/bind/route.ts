import { NextResponse } from "next/server";
import { requireFullyAuthenticatedUser } from "@/lib/auth/session";
import { apiError, parseJsonBody } from "@/lib/api-helpers";
import { portableVaultBindSchema } from "@/lib/validation/portable-vault-broker";
import { portableVaultBrokerService } from "@/server/services/portable-vault-broker-service";

export async function POST(request: Request) {
  try {
    const user = await requireFullyAuthenticatedUser();
    const parsed = portableVaultBindSchema.safeParse(await parseJsonBody(request));
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }
    const input = parsed.data;
    return NextResponse.json(await portableVaultBrokerService.bindPendingEnrollment(user.id, input));
  } catch (error) {
    return apiError(error, "POST /api/vault/portable-passkey/bind");
  }
}
