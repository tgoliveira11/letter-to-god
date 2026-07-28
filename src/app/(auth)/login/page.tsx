import { LoginPage } from "@tgoliveira/secure-auth/react";
import { accountPasskeyLoginVaultHooks } from "@/features/passkey/account-passkey-login-vault-hooks";

export default function Page() {
  return <LoginPage passkeyLoginHooks={accountPasskeyLoginVaultHooks} />;
}
