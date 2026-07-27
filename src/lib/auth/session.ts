import "server-only";
import { cache } from "react";
import { getServerSession } from "next-auth";
import { isFullyAuthenticatedSession } from "@/lib/auth/session-state";
import { secureAuth } from "@/lib/secure-auth";

export const getAppSession = cache(async () => {
  const services = await secureAuth.getServices();
  return getServerSession(services.getAuthOptions());
});

export async function getSessionUser() {
  const session = await getAppSession();
  if (!session?.user?.id) return null;
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    accountSessionId: session.accountSessionId,
    twoFactorVerified: session.twoFactorVerified !== false,
    twoFactorPending: session.twoFactorPending === true,
  };
}

export async function requireSessionUser() {
  const user = await getSessionUser();
  if (!user) {
    throw new UnauthorizedError("Authentication required");
  }
  return user;
}

export async function requireFullyAuthenticatedUser() {
  const session = await getAppSession();
  if (!session?.user?.id) {
    throw new UnauthorizedError("Authentication required");
  }
  if (!isFullyAuthenticatedSession(session)) {
    throw new UnauthorizedError("Complete account authentication required");
  }
  return {
    id: session.user.id,
    email: session.user.email ?? "",
    accountSessionId: session.accountSessionId,
  };
}

export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}
