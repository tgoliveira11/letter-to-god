import { NextResponse } from "next/server";
import { requireFullyAuthenticatedUser } from "@/lib/auth/session";
import { apiError } from "@/lib/api-helpers";
import { portableVaultBrokerService } from "@/server/services/portable-vault-broker-service";

export async function GET() {
  try {
    const user = await requireFullyAuthenticatedUser();
    return NextResponse.json(await portableVaultBrokerService.list(user.id));
  } catch (error) {
    return apiError(error, "GET /api/vault/portable-passkey");
  }
}
