import { secureAuth } from "@/lib/secure-auth";

export const GET = secureAuth.routes.accountPreferencesByKey.GET;
export const PUT = secureAuth.routes.accountPreferencesByKey.PUT;
export const DELETE = secureAuth.routes.accountPreferencesByKey.DELETE;
