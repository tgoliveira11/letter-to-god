import "server-only";

import { NextResponse } from "next/server";
import { createSecureAuth } from "@tgoliveira/secure-auth/next";
import type { SecureAuthEmailTemplates } from "@tgoliveira/secure-auth";
import { secureAuthDb } from "@/lib/secure-auth-db";
import { ensureSecureAuthDatabaseReady } from "@/lib/secure-auth-schema";
import { emailProvider } from "@/lib/email-provider";
import { buildSecureAuthConfigFromEnv } from "@/lib/env/secure-auth-from-env";
import { readEnv } from "@/lib/env/parse";
import { ACCOUNT_PASSWORD_VAULT_NOTE } from "@/lib/account-auth-messages";
import { PRODUCT_NAME } from "@/lib/marketing/brand";
import { ensureBootstrapEmailAdminRole } from "@/lib/secure-auth-admin-bootstrap";
import { getVaultPasskeyLoginAuthenticationExtensions } from "@/server/services/passkey-login-vault-extension-service";

type RouteHandler = (request: Request, ...args: unknown[]) => Promise<Response>;

let adminBootstrapPromise: Promise<void> | null = null;

async function ensureAdminBootstrap(): Promise<void> {
  if (!adminBootstrapPromise) {
    adminBootstrapPromise = (async () => {
      const services = await initSecureAuth().getServices();
      await services.adminService.bootstrapAdminIfNeeded();
      await ensureBootstrapEmailAdminRole();
    })();
  }
  await adminBootstrapPromise;
}

export async function ensureAdminBootstrapAccess(): Promise<void> {
  await ensureSecureAuthDatabaseReady();
  await ensureAdminBootstrap();
}

function wrapSecureAuthHandler(handler: RouteHandler): RouteHandler {
  return async (request, ...args) => {
    try {
      await ensureSecureAuthDatabaseReady();
      await ensureAdminBootstrap();
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Auth database is not ready for @tgoliveira/secure-auth",
        },
        { status: 503 }
      );
    }

    return handler(request, ...args);
  };
}

function wrapSecureAuthRoutes<T extends Record<string, unknown>>(routes: T): T {
  const wrapped = {} as T;

  for (const [routeName, routeHandlers] of Object.entries(routes)) {
    if (!routeHandlers || typeof routeHandlers !== "object") {
      wrapped[routeName as keyof T] = routeHandlers as T[keyof T];
      continue;
    }

    const wrappedHandlers = {} as Record<string, unknown>;
    for (const [method, handler] of Object.entries(routeHandlers as Record<string, unknown>)) {
      wrappedHandlers[method] =
        typeof handler === "function" ? wrapSecureAuthHandler(handler as RouteHandler) : handler;
    }
    wrapped[routeName as keyof T] = wrappedHandlers as T[keyof T];
  }

  return wrapped;
}

const emailTemplates: SecureAuthEmailTemplates = {
  verificationEmail: ({ appName, verifyUrl }) => ({
    subject: `Verify your email — ${appName}`,
    text: [
      "Please verify your email address to finish setting up your account.",
      "",
      verifyUrl,
      "",
      "If you did not create this account, you can ignore this email.",
    ].join("\n"),
    html: [
      "<p>Please verify your email address to finish setting up your account.</p>",
      `<p><a href="${verifyUrl}">Verify your email</a></p>`,
      "<p>If you did not create this account, you can ignore this email.</p>",
    ].join(""),
  }),
  passwordReset: ({ appName, resetUrl }) => ({
    subject: `Reset your password — ${appName}`,
    text: [
      "We received a request to reset your account password.",
      "",
      resetUrl,
      "",
      ACCOUNT_PASSWORD_VAULT_NOTE,
      "",
      "If you did not request this, you can ignore this email.",
    ].join("\n"),
    html: [
      "<p>We received a request to reset your account password.</p>",
      `<p><a href="${resetUrl}">Reset your password</a></p>`,
      `<p>${ACCOUNT_PASSWORD_VAULT_NOTE}</p>`,
      "<p>If you did not request this, you can ignore this email.</p>",
    ].join(""),
  }),
};

type SecureAuthCore = ReturnType<typeof createSecureAuth>;
type SecureAuthInstance = SecureAuthCore & {
  routes: ReturnType<typeof wrapSecureAuthRoutes<SecureAuthCore["routes"]>>;
};

let secureAuthInstance: SecureAuthInstance | null = null;

function initSecureAuth(): SecureAuthInstance {
  if (secureAuthInstance) {
    return secureAuthInstance;
  }

  const envConfig = buildSecureAuthConfigFromEnv(process.env, {
    appName: PRODUCT_NAME,
    appSlug: "letters-to-god",
    baseUrl: "http://localhost:3001",
  });

  const secureAuthCore = createSecureAuth({
    db: secureAuthDb,
    ...envConfig,
    webauthn: {
      ...envConfig.webauthn,
      getLoginAuthenticationExtensions: getVaultPasskeyLoginAuthenticationExtensions,
    },
    accountPolicy: {
      sendVerificationOnRegister: envConfig.accountPolicy!.sendVerificationOnRegister,
      requireEmailVerificationForAccountApis:
        envConfig.accountPolicy!.requireEmailVerificationForAccountApis,
      requireEmailVerificationBeforeSignIn:
        envConfig.auth.requireEmailVerificationBeforeSignIn,
    },
    email: {
      from:
        readEnv(process.env, "EMAIL_FROM") ??
        `${envConfig.app.name} <noreply@localhost>`,
      provider: emailProvider,
      templates: emailTemplates,
    },
  });

  secureAuthInstance = Object.assign(secureAuthCore, {
    routes: wrapSecureAuthRoutes(secureAuthCore.routes),
  });

  return secureAuthInstance;
}

export const secureAuth = new Proxy({} as SecureAuthInstance, {
  get(_target, prop, receiver) {
    const instance = initSecureAuth();
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
