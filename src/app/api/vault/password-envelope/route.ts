import { NextResponse } from "next/server";
import { requireFullyAuthenticatedUser } from "@/lib/auth/session";
import {
  assertNoVaultPlaintextFields,
  passwordEnvelopeReplaceSchema,
  VaultPlaintextRejectionError,
} from "@/lib/validation/vault";
import { vaultService } from "@/server/services/vault-service";
import { apiError, parseJsonBody } from "@/lib/api-helpers";
import { vaultApiClientKey, vaultApiRateLimitResponse } from "@/lib/vault/vault-api-guard";

export async function PUT(request: Request) {
  try {
    const user = await requireFullyAuthenticatedUser();
    const limited = vaultApiRateLimitResponse(
      "vault-password-envelope",
      vaultApiClientKey(request, user.id)
    );
    if (limited) return limited;

    const body = (await parseJsonBody(request)) as Record<string, unknown>;
    assertNoVaultPlaintextFields(body);
    const parsed = passwordEnvelopeReplaceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid password envelope payload", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const result = await vaultService.replacePasswordEnvelope(user.id, parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof VaultPlaintextRejectionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return apiError(error, "PUT /api/vault/password-envelope");
  }
}
