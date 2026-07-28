import type { NextResponse } from "next/server";
import { cookies } from "next/headers";

/** HttpOnly browser routing hint — not a secret; selects one verified credential and variant. */
export const VAULT_DEVICE_BINDING_COOKIE = "selahkeep_vault_device";

/** One year — rebinding on setup refreshes Max-Age. */
export const VAULT_DEVICE_BINDING_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isVaultDeviceBindingCookieSecure(): boolean {
  const raw = process.env.AUTH_COOKIE_SECURE;
  if (raw === undefined) {
    return process.env.NODE_ENV === "production";
  }
  return raw === "true" || raw === "1";
}

export function parseVaultDeviceBindingId(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return UUID_RE.test(trimmed) ? trimmed : undefined;
}

export function applyVaultDeviceBindingCookie(
  response: NextResponse,
  bindingId: string
): NextResponse {
  response.cookies.set(VAULT_DEVICE_BINDING_COOKIE, bindingId, {
    httpOnly: true,
    secure: isVaultDeviceBindingCookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: VAULT_DEVICE_BINDING_MAX_AGE_SECONDS,
  });
  return response;
}

export function clearVaultDeviceBindingCookie(response: NextResponse): NextResponse {
  response.cookies.set(VAULT_DEVICE_BINDING_COOKIE, "", {
    httpOnly: true,
    secure: isVaultDeviceBindingCookieSecure(),
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

/** Read binding id from an incoming API request Cookie header. */
export function readVaultDeviceBindingIdFromRequest(request: Request): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;

  for (const segment of cookieHeader.split(";")) {
    const trimmed = segment.trim();
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator);
    if (name !== VAULT_DEVICE_BINDING_COOKIE) continue;
    const rawValue = trimmed.slice(separator + 1);
    try {
      return parseVaultDeviceBindingId(decodeURIComponent(rawValue));
    } catch {
      return parseVaultDeviceBindingId(rawValue);
    }
  }

  return undefined;
}

/** Read validated device binding id from the HttpOnly cookie (server routes only). */
export async function readVaultDeviceBindingIdFromCookies(): Promise<string | undefined> {
  const cookieStore = await cookies();
  return parseVaultDeviceBindingId(cookieStore.get(VAULT_DEVICE_BINDING_COOKIE)?.value);
}
