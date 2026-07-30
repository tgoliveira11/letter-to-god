import type { SecureAuthConfig } from "@tgoliveira/secure-auth";
import type { SecureAuthUIPublicConfig } from "@tgoliveira/secure-auth/react";
import { authPageMessages } from "@/lib/auth/auth-page-messages";
import {
  readBoolEnv,
  readEnumEnv,
  readEnv,
  readEnvWithLegacy,
  readIntEnv,
} from "@/lib/env/parse";
import { resolveRateLimitStore } from "@/lib/env/rate-limit-store";
import { resolveWebAuthnSettings } from "@/lib/env/webauthn-from-env";
import { resolvePortableVaultGrantConfig } from "@/lib/env/portable-vault-broker";

export type SecureAuthEnvSlice = Pick<
  SecureAuthConfig,
  | "app"
  | "auth"
  | "accountPolicy"
  | "passwordPolicy"
  | "sessions"
  | "rateLimit"
  | "server"
  | "security"
  | "debug"
  | "oauth"
  | "webauthn"
  | "ui"
  | "admin"
  | "accountLockout"
  | "invites"
  | "apiKeys"
  | "profile"
  | "preferences"
>;

function readCsvEnv(env: NodeJS.ProcessEnv, key: string): string[] {
  const raw = readEnv(env, key);
  if (!raw) return [];
  return raw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

import { PRODUCT_NAME } from "@/lib/marketing/brand";

const PRODUCT_DEFAULTS = {
  appName: PRODUCT_NAME,
  appSlug: "letters-to-god",
  baseUrl: "http://localhost:3001",
} as const;

function parseSecureAuthEnv(
  env: NodeJS.ProcessEnv,
  defaults: { appName: string; appSlug: string; baseUrl: string }
) {
  const appName = readEnv(env, "APP_NAME") ?? defaults.appName;
  const appSlug = readEnv(env, "APP_SLUG") ?? defaults.appSlug;
  const baseUrl =
    readEnvWithLegacy(env, "APP_BASE_URL", "NEXTAUTH_URL") ?? defaults.baseUrl;

  const nextAuthSecret = readEnv(env, "NEXTAUTH_SECRET");
  const twoFactorEncryptionKey = readEnv(env, "TWO_FACTOR_SECRET_ENCRYPTION_KEY");

  const afterLoginPath = readEnv(env, "AUTH_AFTER_LOGIN_PATH") ?? "/home";
  const afterLogoutPath = readEnv(env, "AUTH_AFTER_LOGOUT_PATH") ?? "/";
  const authenticatedRedirectPath =
    readEnv(env, "AUTH_AUTHENTICATED_REDIRECT_PATH") ?? afterLoginPath;
  const redirectAuthenticatedFromGuestPages = readBoolEnv(
    env,
    "AUTH_REDIRECT_AUTHENTICATED_FROM_GUEST_PAGES",
    true
  );

  const requireEmailVerificationBeforeSignIn = readBoolEnv(
    env,
    "EMAIL_VERIFICATION_REQUIRE_BEFORE_SIGN_IN",
    readBoolEnv(env, "AUTH_REQUIRE_EMAIL_VERIFICATION_BEFORE_SIGN_IN", false)
  );

  const sendVerificationOnRegister = readBoolEnv(
    env,
    "EMAIL_VERIFICATION_SEND_ON_REGISTER",
    true
  );

  const requireEmailVerificationForAccountApis = readBoolEnv(
    env,
    "EMAIL_VERIFICATION_REQUIRE_FOR_ACCOUNT_APIS",
    true
  );

  const sameOriginProtectionEnabled = readBoolEnv(
    env,
    "AUTH_SAME_ORIGIN_PROTECTION_ENABLED",
    true
  );
  const sameOriginAllowedOrigins = readCsvEnv(env, "AUTH_ALLOWED_ORIGINS");

  const authTrace = readBoolEnv(env, "AUTH_TRACE", false);
  const exposeTraceRoute = readBoolEnv(env, "AUTH_DEBUG_EXPOSE_TRACE_ROUTE", false);

  const singleActiveSession = readBoolEnv(env, "AUTH_SINGLE_ACTIVE_SESSION", false);
  const revocationPollIntervalSeconds = readIntEnv(
    env,
    "AUTH_SESSION_REVOCATION_POLL_SECONDS",
    singleActiveSession ? 10 : 0,
    { min: 0, max: 3600 }
  );

  // Email-first login: /login asks for the email (with magic link and OAuth), then password
  // and passkey. Runtime-overridable from the admin panel via `ui.login.twoStep`.
  const loginTwoStep = readBoolEnv(env, "AUTH_LOGIN_TWO_STEP", true);

  const passwordStrengthPosition = readEnumEnv(
    env,
    "AUTH_PASSWORD_STRENGTH_POSITION",
    ["above", "below"] as const,
    "above"
  );

  const cookieSecureRaw = readEnv(env, "AUTH_COOKIE_SECURE");
  const cookieSecure =
    cookieSecureRaw === undefined
      ? env.NODE_ENV === "production"
      : readBoolEnv(env, "AUTH_COOKIE_SECURE", false);

  const googleClientId = readEnvWithLegacy(env, "AUTH_GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_ID");
  const googleClientSecret = readEnvWithLegacy(
    env,
    "AUTH_GOOGLE_CLIENT_SECRET",
    "GOOGLE_CLIENT_SECRET"
  );
  const appleClientId = readEnvWithLegacy(env, "AUTH_APPLE_CLIENT_ID", "APPLE_CLIENT_ID");
  const appleClientSecret = readEnvWithLegacy(
    env,
    "AUTH_APPLE_CLIENT_SECRET",
    "APPLE_CLIENT_SECRET"
  );
  const microsoftClientId = readEnvWithLegacy(
    env,
    "AUTH_MICROSOFT_CLIENT_ID",
    "AUTH_AZURE_AD_ID"
  );
  const microsoftClientSecret = readEnvWithLegacy(
    env,
    "AUTH_MICROSOFT_CLIENT_SECRET",
    "AUTH_AZURE_AD_SECRET"
  );
  const microsoftTenantId =
    readEnvWithLegacy(env, "AUTH_MICROSOFT_TENANT_ID", "AUTH_AZURE_AD_TENANT_ID") ??
    "common";
  const githubClientId = readEnvWithLegacy(env, "AUTH_GITHUB_CLIENT_ID", "GITHUB_CLIENT_ID");
  const githubClientSecret = readEnvWithLegacy(
    env,
    "AUTH_GITHUB_CLIENT_SECRET",
    "GITHUB_CLIENT_SECRET"
  );

  const passwordPolicy = {
    enforcement: readEnumEnv(
      env,
      "AUTH_PASSWORD_POLICY_ENFORCEMENT",
      ["off", "warn", "enforce"] as const,
      readEnumEnv(
        env,
        "PASSWORD_POLICY_ENFORCEMENT",
        ["off", "warn", "enforce"] as const,
        "warn"
      )
    ),
    minLength: readIntEnv(
      env,
      "AUTH_PASSWORD_MIN_LENGTH",
      readIntEnv(env, "PASSWORD_MIN_LENGTH", 12, { min: 1, max: 128 }),
      { min: 1, max: 128 }
    ),
    requireUppercase: readBoolEnv(
      env,
      "AUTH_PASSWORD_REQUIRE_UPPERCASE",
      readBoolEnv(env, "PASSWORD_REQUIRE_UPPERCASE", false)
    ),
    requireLowercase: readBoolEnv(
      env,
      "AUTH_PASSWORD_REQUIRE_LOWERCASE",
      readBoolEnv(env, "PASSWORD_REQUIRE_LOWERCASE", false)
    ),
    requireNumber: readBoolEnv(
      env,
      "AUTH_PASSWORD_REQUIRE_NUMBER",
      readBoolEnv(env, "PASSWORD_REQUIRE_NUMBER", false)
    ),
    requireSymbol: readBoolEnv(
      env,
      "AUTH_PASSWORD_REQUIRE_SYMBOL",
      readBoolEnv(env, "PASSWORD_REQUIRE_SYMBOL", false)
    ),
    blockCommonPasswords: readBoolEnv(
      env,
      "AUTH_PASSWORD_BLOCK_COMMON_PASSWORDS",
      readBoolEnv(env, "PASSWORD_BLOCK_COMMON_PASSWORDS", true)
    ),
    checkBreachedPasswords: readBoolEnv(
      env,
      "AUTH_PASSWORD_HIBP_ENABLED",
      readBoolEnv(env, "AUTH_PASSWORD_CHECK_BREACHED", true)
    ),
    minScore: readIntEnv(
      env,
      "AUTH_PASSWORD_MIN_SCORE",
      readIntEnv(env, "PASSWORD_MIN_SCORE", 2, { min: 0, max: 4 }),
      { min: 0, max: 4 }
    ),
  };

  const adminPath = readEnv(env, "AUTH_ADMIN_PATH") ?? "/admin";

  const uiPaths = {
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
    accountDeleted: "/account-deleted",
    accountSettings: "/settings/account",
    securitySettings: "/settings/account",
    sessionsSettings: "/settings/account",
    waitlistPending: "/waitlist",
    adminPanel: adminPath,
  };

  return {
    appName,
    appSlug,
    baseUrl,
    nextAuthSecret,
    twoFactorEncryptionKey,
    afterLoginPath,
    afterLogoutPath,
    authenticatedRedirectPath,
    redirectAuthenticatedFromGuestPages,
    requireEmailVerificationBeforeSignIn,
    sendVerificationOnRegister,
    requireEmailVerificationForAccountApis,
    sameOriginProtectionEnabled,
    sameOriginAllowedOrigins,
    authTrace,
    exposeTraceRoute,
    singleActiveSession,
    revocationPollIntervalSeconds,
    passwordStrengthPosition,
    loginTwoStep,
    cookieSecure,
    googleClientId,
    googleClientSecret,
    appleClientId,
    appleClientSecret,
    microsoftClientId,
    microsoftClientSecret,
    microsoftTenantId,
    githubClientId,
    githubClientSecret,
    passwordPolicy,
    uiPaths,
    adminPath,
    adminEnabled: readBoolEnv(env, "AUTH_ADMIN_ENABLED", false),
    adminBootstrapEmail: readEnv(env, "ADMIN_BOOTSTRAP_EMAIL"),
    adminConfigCacheTtlSeconds: readIntEnv(env, "AUTH_ADMIN_CONFIG_CACHE_TTL_SECONDS", 60, {
      min: 0,
    }),
    accountLockoutEnabled: readBoolEnv(env, "AUTH_ACCOUNT_LOCKOUT_ENABLED", false),
    invitesEnabled: readBoolEnv(env, "AUTH_INVITES_ENABLED", false),
    invitesRequireApproval: readBoolEnv(env, "AUTH_INVITES_REQUIRE_APPROVAL", false),
    invitesRequireCode: readBoolEnv(env, "AUTH_INVITES_REQUIRE_CODE", false),
    invitesDefaultQuota: readIntEnv(env, "AUTH_INVITES_DEFAULT_QUOTA", 0, { min: 0 }),
    invitesCodeExpiryDays: readIntEnv(env, "AUTH_INVITES_CODE_EXPIRY_DAYS", 30, { min: 1 }),
    apiKeysEnabled: readBoolEnv(env, "AUTH_API_KEYS_ENABLED", false),
    profileEnabled: readBoolEnv(env, "AUTH_PROFILE_ENABLED", false),
    magicLinkEnabled: readBoolEnv(env, "AUTH_MAGIC_LINK_ENABLED", false),
    securityNotificationsEnabled: readBoolEnv(
      env,
      "AUTH_SECURITY_NOTIFICATIONS_ENABLED",
      true
    ),
    trustForwardedHeaders: readBoolEnv(env, "AUTH_TRUST_FORWARDED_HEADERS", false),
  };
}

/** Client-safe UI config for providers; does not require server secrets at import time. */
export function buildSecureAuthUiPublicConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  defaults: { appName: string; appSlug: string; baseUrl: string } = PRODUCT_DEFAULTS
): SecureAuthUIPublicConfig {
  const parsed = parseSecureAuthEnv(env, defaults);

  return {
    appSlug: parsed.appSlug,
    appName: parsed.appName,
    paths: {
      ...parsed.uiPaths,
      afterLogin: parsed.afterLoginPath,
      afterLogout: parsed.afterLogoutPath,
    },
    messages: { ...authPageMessages },
    passwordPolicy: parsed.passwordPolicy,
    passwordStrength: {
      position: parsed.passwordStrengthPosition,
    },
    sessionPolicy: {
      singleActiveSession: parsed.singleActiveSession,
      revocationPollIntervalSeconds: parsed.revocationPollIntervalSeconds,
    },
    auth: {
      redirectAuthenticatedFromGuestPages: parsed.redirectAuthenticatedFromGuestPages,
      authenticatedRedirectPath: parsed.authenticatedRedirectPath,
    },
    login: {
      twoStep: parsed.loginTwoStep,
    },
  };
}

export function buildSecureAuthConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  defaults: { appName: string; appSlug: string; baseUrl: string } = PRODUCT_DEFAULTS
): SecureAuthEnvSlice {
  const parsed = parseSecureAuthEnv(env, defaults);

  if (!parsed.nextAuthSecret) {
    throw new Error("NEXTAUTH_SECRET is required for @tgoliveira/secure-auth");
  }

  if (!parsed.twoFactorEncryptionKey) {
    throw new Error(
      "TWO_FACTOR_SECRET_ENCRYPTION_KEY is required for @tgoliveira/secure-auth"
    );
  }

  const {
    appName,
    appSlug,
    baseUrl,
    nextAuthSecret,
    twoFactorEncryptionKey,
    afterLoginPath,
    afterLogoutPath,
    authenticatedRedirectPath,
    redirectAuthenticatedFromGuestPages,
    requireEmailVerificationBeforeSignIn,
    sendVerificationOnRegister,
    requireEmailVerificationForAccountApis,
    sameOriginProtectionEnabled,
    sameOriginAllowedOrigins,
    authTrace,
    exposeTraceRoute,
    singleActiveSession,
    revocationPollIntervalSeconds,
    passwordStrengthPosition,
    loginTwoStep,
    cookieSecure,
    googleClientId,
    googleClientSecret,
    appleClientId,
    appleClientSecret,
    microsoftClientId,
    microsoftClientSecret,
    microsoftTenantId,
    githubClientId,
    githubClientSecret,
    passwordPolicy,
    uiPaths,
    adminPath,
    adminEnabled,
    adminBootstrapEmail,
    adminConfigCacheTtlSeconds,
    accountLockoutEnabled,
    invitesEnabled,
    invitesRequireApproval,
    invitesRequireCode,
    invitesDefaultQuota,
    invitesCodeExpiryDays,
    apiKeysEnabled,
    profileEnabled,
    magicLinkEnabled,
    securityNotificationsEnabled,
    trustForwardedHeaders,
  } = parsed;

  const nodeEnv = env.NODE_ENV;
  const serverEnvironment =
    nodeEnv === "production"
      ? "production"
      : nodeEnv === "test"
        ? "test"
        : "development";

  return {
    app: {
      name: appName,
      slug: appSlug,
      baseUrl,
    },
    auth: {
      afterLoginPath,
      afterLogoutPath,
      requireEmailVerificationBeforeSignIn,
      nextAuthSecret,
      twoFactorEncryptionKey,
      redirectAuthenticatedFromGuestPages,
      authenticatedRedirectPath,
      magicLink: {
        enabled: magicLinkEnabled,
      },
      securityNotifications: {
        enabled: securityNotificationsEnabled,
      },
    },
    accountPolicy: {
      sendVerificationOnRegister,
      requireEmailVerificationBeforeSignIn,
      requireEmailVerificationForAccountApis,
    },
    security: {
      trustForwardedHeaders,
      sameOriginProtection: {
        enabled: sameOriginProtectionEnabled,
        allowedOrigins: sameOriginAllowedOrigins,
      },
    },
    passwordPolicy,
    sessions: {
      maxAgeSeconds: readIntEnv(env, "AUTH_SESSION_MAX_AGE_SECONDS", 30 * 24 * 60 * 60, {
        min: 60,
        max: 365 * 24 * 60 * 60,
      }),
      lastUsedUpdateIntervalSeconds: readIntEnv(
        env,
        "AUTH_SESSION_LAST_USED_UPDATE_SECONDS",
        readIntEnv(env, "SESSION_LAST_USED_UPDATE_INTERVAL_SECONDS", 300, {
          min: 0,
          max: 86_400,
        }),
        { min: 0, max: 86_400 }
      ),
      singleActiveSession,
      revocationPollIntervalSeconds,
    },
    rateLimit: {
      store: resolveRateLimitStore(env),
    },
    server: {
      cookieSecure,
      environment: serverEnvironment,
    },
    debug: {
      authTrace,
      exposeTraceRoute,
    },
    oauth: {
      google:
        googleClientId && googleClientSecret
          ? { clientId: googleClientId, clientSecret: googleClientSecret }
          : undefined,
      apple:
        appleClientId && appleClientSecret
          ? { clientId: appleClientId, clientSecret: appleClientSecret }
          : undefined,
      microsoft:
        microsoftClientId && microsoftClientSecret
          ? {
              clientId: microsoftClientId,
              clientSecret: microsoftClientSecret,
              tenantId: microsoftTenantId,
            }
          : undefined,
      github:
        githubClientId && githubClientSecret
          ? { clientId: githubClientId, clientSecret: githubClientSecret }
          : undefined,
    },
    webauthn: (() => {
      const webauthn = resolveWebAuthnSettings(env, { appName, baseUrl });
      return {
        rpId: webauthn.rpId,
        rpName: webauthn.rpName,
        origin: webauthn.origin,
        originAliasPolicy: env.NODE_ENV === "production" ? "none" : "apex-www",
        portableVaultGrants: resolvePortableVaultGrantConfig(env, baseUrl),
      };
    })(),
    ui: {
      paths: uiPaths,
      messages: { ...authPageMessages },
      passwordStrength: {
        position: passwordStrengthPosition,
      },
      login: {
        twoStep: loginTwoStep,
      },
    },
    admin: {
      enabled: adminEnabled,
      path: adminPath,
      bootstrapEmail: adminBootstrapEmail,
      configCacheTtlSeconds: adminConfigCacheTtlSeconds,
    },
    accountLockout: {
      enabled: accountLockoutEnabled,
    },
    invites: {
      enabled: invitesEnabled,
      requireApproval: invitesRequireApproval,
      requireInviteCode: invitesRequireCode,
      defaultQuotaPerUser: invitesDefaultQuota,
      codeExpiryDays: invitesCodeExpiryDays,
    },
    apiKeys: {
      enabled: apiKeysEnabled,
    },
    profile: {
      enabled: profileEnabled,
    },
    preferences: {
      enabled: true,
    },
  };
}
