import { secureAuth } from "@/lib/secure-auth";

export const GET = secureAuth.routes.accountPreferences.GET;
export const PATCH = secureAuth.routes.accountPreferences.PATCH;
