"use client";

import { useSecureAuthUi } from "@tgoliveira/secure-auth/react/client";

export {
  defaultSignOutAccount as signOutAccount,
  signOutWithRedirect,
  useSecureAuthUi,
} from "@tgoliveira/secure-auth/react/client";

/** Configured post-logout destination (`auth.afterLogoutPath`), defaulting to the app home. */
export function useAfterLogoutPath(): string {
  return useSecureAuthUi()?.paths.afterLogout ?? "/";
}
