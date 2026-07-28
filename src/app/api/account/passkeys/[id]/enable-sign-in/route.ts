import { secureAuth } from "@/lib/secure-auth";

/** secure-auth owns exact-credential UV verification and the sign-in capability transition. */
export const POST = secureAuth.routes.passkeyEnableSignIn.POST;
