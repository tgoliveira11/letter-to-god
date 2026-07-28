import type { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isVaultDeviceBindingCookieSecure } from "@/lib/passkey/vault-device-binding-cookie";

export const VAULT_REGISTRATION_PROOF_COOKIE = "selahkeep_vault_registration_proof";
const MAX_AGE_SECONDS = 5 * 60;
const PROOF_RE = /^[A-Za-z0-9_-]{20,256}$/;

export function applyVaultRegistrationProofCookie(
  response: NextResponse,
  proof: string
): NextResponse {
  if (!PROOF_RE.test(proof)) throw new TypeError("Invalid vault registration proof");
  response.cookies.set(VAULT_REGISTRATION_PROOF_COOKIE, proof, {
    httpOnly: true,
    secure: isVaultDeviceBindingCookieSecure(),
    sameSite: "strict",
    path: "/api/passkeys/account-registration-vault",
    maxAge: MAX_AGE_SECONDS,
  });
  return response;
}

export function clearVaultRegistrationProofCookie(response: NextResponse): NextResponse {
  response.cookies.set(VAULT_REGISTRATION_PROOF_COOKIE, "", {
    httpOnly: true,
    secure: isVaultDeviceBindingCookieSecure(),
    sameSite: "strict",
    path: "/api/passkeys/account-registration-vault",
    maxAge: 0,
  });
  return response;
}

export async function readVaultRegistrationProofCookie(): Promise<string | undefined> {
  const value = (await cookies()).get(VAULT_REGISTRATION_PROOF_COOKIE)?.value;
  return value && PROOF_RE.test(value) ? value : undefined;
}
