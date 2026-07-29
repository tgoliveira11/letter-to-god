import { requireFullyAuthenticatedUser } from "@/lib/auth/session";
import { apiError } from "@/lib/api-helpers";
import { secureAuth } from "@/lib/secure-auth";
import { portableVaultBrokerService } from "@/server/services/portable-vault-broker-service";
import { portableVaultFinalizedReceiptSchema } from "@/lib/validation/portable-vault-broker";

export async function POST(request: Request) {
  try {
    const user = await requireFullyAuthenticatedUser();
    const response = await secureAuth.routes.passkeyPortableVaultGrantFinalize.POST(request);
    if (!response.ok) return response;

    const result = portableVaultFinalizedReceiptSchema.parse(await response.clone().json());
    await portableVaultBrokerService.completeVerifiedReceipt(user.id, result);
    return response;
  } catch (error) {
    return apiError(error, "POST /api/account/passkeys/portable-vault-grants/finalize");
  }
}
