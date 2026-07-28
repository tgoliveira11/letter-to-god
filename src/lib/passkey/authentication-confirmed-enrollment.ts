"use client";

import {
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { extractPasskeyPrfOutput } from "@/lib/crypto-client/passkey-vault";
import {
  resolvePasskeyPrfEnrollmentAfterRegistration,
  resolvePasskeyPrfCapability,
  sanitizeWebAuthnResponseForServer,
} from "@/lib/crypto-client/vault-passkey-browser";
import { prepareVaultAuthenticationOptions } from "@/lib/passkey/prepare-webauthn-options";

export type AuthenticationConfirmedEnrollmentVerification = {
  verifiedCredentialId: string;
  enrollmentProof: string;
};

export type AuthenticationConfirmedEnrollmentResult =
  AuthenticationConfirmedEnrollmentVerification & {
    prfOutput: Uint8Array;
  };

export class PasskeyAuthenticationPrfUnavailableError extends Error {
  override readonly name = "PasskeyAuthenticationPrfUnavailableError";
}

export async function runAuthenticationConfirmedPasskeyEnrollment(input: {
  userId: string;
  registrationCredentialId: string;
  verifiedRegistrationCredentialId: string;
  registrationClientExtensionResults?: Record<string, unknown> | null;
  requestAuthenticationOptions: (
    verifiedCredentialId: string
  ) => Promise<PublicKeyCredentialRequestOptionsJSON>;
  verifyAuthentication: (
    verifiedCredentialId: string,
    response: unknown
  ) => Promise<AuthenticationConfirmedEnrollmentVerification>;
}): Promise<AuthenticationConfirmedEnrollmentResult> {
  const enrollment = resolvePasskeyPrfEnrollmentAfterRegistration({
    registrationCredentialId: input.registrationCredentialId,
    verifiedCredentialId: input.verifiedRegistrationCredentialId,
    clientExtensionResults: input.registrationClientExtensionResults,
  });

  // vault-core 1.6.1 never returns ready. Keep this guard so a future regression cannot make a
  // registration-derived output authorize the first durable envelope.
  if (enrollment.status === "ready") {
    enrollment.prfOutput.fill(0);
    throw new Error("Passkey authentication confirmation is required for vault unlock.");
  }
  if (enrollment.status !== "authentication_required") {
    throw new Error("This passkey did not confirm PRF support for vault unlock.");
  }

  const serverOptions = await input.requestAuthenticationOptions(enrollment.credentialId);
  const optionsJSON = await prepareVaultAuthenticationOptions(
    serverOptions,
    input.userId,
    enrollment.credentialSelection
  );
  const assertion = await startAuthentication({ optionsJSON });
  const clientExtensionResults = assertion.clientExtensionResults as Record<string, unknown>;
  const verified = await input.verifyAuthentication(
    enrollment.credentialId,
    sanitizeWebAuthnResponseForServer(assertion)
  );

  if (
    assertion.id !== enrollment.credentialId ||
    verified.verifiedCredentialId !== assertion.id
  ) {
    throw new Error("Verified passkey credential mismatch.");
  }

  const capability = resolvePasskeyPrfCapability({
    ceremony: "authentication",
    verifiedCredentialId: verified.verifiedCredentialId,
    clientExtensionResults,
  });
  const prfOutput = extractPasskeyPrfOutput(
    clientExtensionResults,
    verified.verifiedCredentialId
  );
  if (capability.state !== "confirmed_authentication" || !prfOutput) {
    prfOutput?.fill(0);
    throw new PasskeyAuthenticationPrfUnavailableError(
      "Authentication completed, but this passkey did not return PRF output for vault unlock."
    );
  }

  return { ...verified, prfOutput };
}
