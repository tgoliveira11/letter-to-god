import type { SecureAuthUIPublicConfig } from "@tgoliveira/secure-auth/react";
import { PRODUCT_NAME } from "@/lib/marketing/brand";
import { buildSecureAuthConfigFromEnv } from "@/lib/env/secure-auth-from-env";
import { authPageMessages } from "@/lib/auth/auth-page-messages";

const testEnvBase: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  NEXTAUTH_SECRET: "a".repeat(32),
  TWO_FACTOR_SECRET_ENCRYPTION_KEY: "b".repeat(32),
  APP_BASE_URL: "http://localhost:3001",
};

/** Resolve password policy the same way production secure-auth config does. */
export function buildTestPasswordPolicyFromEnv(
  env: Record<string, string> = {}
): SecureAuthUIPublicConfig["passwordPolicy"] {
  const config = buildSecureAuthConfigFromEnv(
    { ...testEnvBase, ...env },
    { appName: PRODUCT_NAME, appSlug: "letters-to-god", baseUrl: "http://localhost:3001" }
  );
  return config.passwordPolicy as SecureAuthUIPublicConfig["passwordPolicy"];
}

/** Minimal UI config for rendering @tgoliveira/secure-auth pages in Vitest. */
export const testSecureAuthUiConfig: SecureAuthUIPublicConfig = {
  appSlug: "letters-to-god",
  appName: PRODUCT_NAME,
  paths: {
    home: "/",
    login: "/login",
    register: "/register",
    forgotPassword: "/forgot-password",
    resetPassword: "/reset-password",
    checkEmail: "/check-email",
    verifyEmail: "/verify-email",
    loginTwoFactor: "/login/2fa",
    loginTwoFactorOauthComplete: "/login/2fa/complete",
    loginComplete: "/login/complete",
    magicLinkVerify: "/login/magic-link",
    afterLogin: "/home",
    afterLogout: "/login",
    accountDeleted: "/account-deleted",
    accountSettings: "/settings/account",
    securitySettings: "/settings/account",
    sessionsSettings: "/settings/account",
    waitlistPending: "/waitlist",
    adminPanel: "/admin",
  },
  messages: { ...authPageMessages },
  passwordPolicy: buildTestPasswordPolicyFromEnv(),
  passwordStrength: { position: "above" },
  sessionPolicy: {
    singleActiveSession: false,
    revocationPollIntervalSeconds: 0,
  },
  auth: {
    redirectAuthenticatedFromGuestPages: true,
    authenticatedRedirectPath: "/home",
  },
  oauthProviderIds: ["google", "apple", "azure-ad"],
  preferences: { enabled: true },
};
