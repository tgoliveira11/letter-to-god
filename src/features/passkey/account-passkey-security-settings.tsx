"use client";

import { SecuritySettingsPage } from "@tgoliveira/secure-auth/react";

/** Account passkeys remain account-auth credentials; vault enrollment lives in vault settings. */
export function AccountPasskeySecuritySettings(_props: { userId: string }) {
  return <SecuritySettingsPage />;
}
