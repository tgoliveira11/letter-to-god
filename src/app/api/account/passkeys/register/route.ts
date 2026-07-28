import { secureAuth } from "@/lib/secure-auth";

/** Account passkey registration is fully owned by secure-auth. */
export const POST = secureAuth.routes.passkeyRegister.POST;
