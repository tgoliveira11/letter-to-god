import { randomBytes } from "node:crypto";
import { runInTransaction } from "@/lib/db/transaction";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { passkeyRepository } from "@/server/repositories/passkey-repository";
import { vaultPasskeyDeviceBindingRepository } from "@/server/repositories/vault-passkey-device-binding-repository";
import { vaultRepository } from "@/server/repositories/vault-repository";
import { auditRepository } from "@/server/repositories/audit-repository";
import { enforceRateLimit } from "@/server/policies/rate-limit";
import { passkeyPrfExtensions } from "@/lib/passkey/prf";
import { toAllowCredentialDescriptor } from "@/lib/passkey/passkey-transports";
import {
  getWebAuthnOrigins,
  getWebAuthnRpId,
  toPasskeyVerificationErrorMessage,
} from "@/lib/passkey/webauthn-config";
import { assertVaultKeyAad } from "@/server/policies/aad-validation";
import type { EncryptedPayload } from "@/lib/validation/encrypted-payload";
import { ChallengeError, NotFoundError } from "@/server/services/passkey-service";
import { SELAHKEEP_VAULT_PROFILE } from "@/modules/vault/selahkeep-profile";
import {
  vaultBindingProofAudience,
  vaultEnvelopeAuthenticationProofAudience,
  vaultPasskeyEnrollmentChallenge,
} from "@/lib/passkey/challenge-audiences";
import { resolvePasskeyCounterAdvance } from "@/lib/passkey/passkey-counter";
import {
  AUTHENTICATION_CONFIRMED_PRF_CEREMONY,
  isAuthenticationConfirmedPasskeyVariant,
} from "@/lib/passkey/passkey-envelope-variant-metadata";
import { isLegacyPasskeyPrfEnrollmentEnabled } from "@/lib/env/portable-vault-broker";

const rpID = getWebAuthnRpId();
const origins = getWebAuthnOrigins();

function assertLegacyEnrollmentEnabled() {
  if (!isLegacyPasskeyPrfEnrollmentEnabled()) {
    throw new NotFoundError("Legacy passkey PRF enrollment is disabled");
  }
}

/** App policy: all active variants must fit in vault-core's bounded candidate set. */
export const MAX_ACTIVE_PASSKEY_ENVELOPE_VARIANTS = 5;

async function issueProof(userId: string, type: string): Promise<string> {
  const proof = randomBytes(32).toString("base64url");
  await passkeyRepository.storeChallenge({
    userId,
    challenge: proof,
    type,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  return proof;
}

async function verifyPasskeyAuthentication(
  userId: string,
  credentialDbId: string,
  response: AuthenticationResponseJSON
) {
  const credential = await passkeyRepository.findByIdForUser(credentialDbId, userId);
  if (!credential) throw new NotFoundError("Passkey not found");

  const clientData = JSON.parse(
    Buffer.from(response.response.clientDataJSON, "base64url").toString()
  );

  let challengeRecord;
  try {
    challengeRecord = await passkeyRepository.consumeValidChallenge(
      clientData.challenge,
      vaultPasskeyEnrollmentChallenge(credential.id),
      userId
    );
  } catch {
    throw new ChallengeError("Invalid or expired challenge");
  }

  if (response.id !== credential.credentialId) {
    throw new ChallengeError("Passkey mismatch. Try again with the selected passkey.");
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      credential: {
        id: credential.credentialId,
        publicKey: new Uint8Array(Buffer.from(credential.publicKey, "base64url")),
        counter: Number.parseInt(credential.counter, 10) || 0,
        transports: (credential.transports as AuthenticatorTransport[]) ?? undefined,
      },
    });
  } catch (error) {
    throw new ChallengeError(toPasskeyVerificationErrorMessage(error));
  }

  if (!verification.verified) {
    throw new ChallengeError("Passkey verification failed. Try again.");
  }

  const counterPlan = resolvePasskeyCounterAdvance(
    credential.counter,
    verification.authenticationInfo.newCounter
  );
  if (counterPlan.status === "invalid") {
    throw new ChallengeError("Passkey verification failed. Try again.");
  }
  const counterAdvance = await passkeyRepository.advanceCounter(
    credential.credentialId,
    counterPlan.expectedCounter,
    counterPlan.nextCounter,
    credential.counterRevision
  );
  if (counterAdvance === "conflict") {
    throw new ChallengeError("Passkey verification failed. Try again.");
  }
  await passkeyRepository.updateLastUsedAt(credential.credentialId);
  await passkeyRepository.updateCredentialFlags(credential.id, userId, {
    credentialDeviceType: verification.authenticationInfo.credentialDeviceType,
    backupEligible: verification.authenticationInfo.credentialDeviceType === "multiDevice",
    credentialBackedUp: verification.authenticationInfo.credentialBackedUp,
  });

  return { credential, verification };
}

async function getVaultUnlockAuthOptions(
  userId: string,
  credentialDbId: string,
  ip?: string
) {
  const credential = await passkeyRepository.findByIdForUser(credentialDbId, userId);
  if (!credential) throw new NotFoundError("Passkey not found");

  await enforceRateLimit({
    operation: "passkey.authenticate",
    userId,
    ip,
    endpoint: "/api/account/passkeys/enable-vault-unlock",
  });

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: [toAllowCredentialDescriptor(credential)],
    userVerification: "required",
    extensions: await passkeyPrfExtensions(userId),
  });
  await passkeyRepository.storeChallenge({
    userId,
    challenge: options.challenge,
    type: vaultPasskeyEnrollmentChallenge(credential.id),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });
  return options;
}

/** Product-only passkey envelope persistence; WebAuthn verification stays app-owned. */
export const passkeyVaultEnvelopeService = {
  async resolveCredentialDbId(userId: string, verifiedCredentialId: string) {
    const credential = await passkeyRepository.findByCredentialId(verifiedCredentialId);
    if (!credential || credential.userId !== userId) throw new NotFoundError("Passkey not found");
    return credential.id;
  },

  async getVaultUnlockAuthOptions(userId: string, credentialDbId: string, ip?: string) {
    assertLegacyEnrollmentEnabled();
    return getVaultUnlockAuthOptions(userId, credentialDbId, ip);
  },

  async getCandidatesAfterAccountPasskeyLogin(
    userId: string,
    verifiedCredentialId: string,
    selectedEnvelopeVariantId?: string | null
  ) {
    const credential = await passkeyRepository.findByCredentialId(verifiedCredentialId);
    if (!credential || credential.userId !== userId || !credential.vaultUnlockEnabled) {
      throw new NotFoundError("This sign-in passkey is not enabled for vault unlock");
    }
    const variants = await vaultRepository.findActivePasskeyEnvelopeVariants(
      userId,
      credential.id,
      credential.credentialId,
      selectedEnvelopeVariantId
    );
    if (variants.length === 0 || variants.length > MAX_ACTIVE_PASSKEY_ENVELOPE_VARIANTS) {
      throw new ChallengeError("No bounded vault envelope candidate set is available");
    }
    const bindingProof = await issueProof(userId, vaultBindingProofAudience(credential.id));
    return {
      userId,
      verifiedCredentialId: credential.credentialId,
      bindingProof,
      candidates: variants.map((variant) => ({
        envelopeVariantId: variant.id,
        credentialId: credential.credentialId,
        envelope: {
          method: "passkey_prf" as const,
          encryptedVaultKey: variant.encryptedVaultKey,
          kdfMetadata: null,
          ...(variant.publicMetadata
            ? { publicMetadata: variant.publicMetadata as Record<string, unknown> }
            : {}),
        },
      })),
    };
  },

  async verifyVaultUnlockEnrollment(
    userId: string,
    credentialDbId: string,
    response: AuthenticationResponseJSON
  ) {
    assertLegacyEnrollmentEnabled();
    const { credential } = await verifyPasskeyAuthentication(userId, credentialDbId, response);
    const enrollmentProof = await issueProof(
      userId,
      vaultEnvelopeAuthenticationProofAudience(credential.id)
    );
    return {
      verified: true,
      verifiedCredentialId: credential.credentialId,
      enrollmentProof,
    };
  },

  async persistVaultUnlockEnvelope(
    userId: string,
    credentialDbId: string,
    enrollmentProof: string,
    encryptedVaultKey: EncryptedPayload,
    options?: { prfSupported?: boolean | null }
  ) {
    assertLegacyEnrollmentEnabled();
    assertVaultKeyAad(userId, encryptedVaultKey, SELAHKEEP_VAULT_PROFILE.aadContextEnvelope);
    const credential = await passkeyRepository.findByIdForUser(credentialDbId, userId);
    if (!credential) throw new NotFoundError("Passkey not found");

    try {
      await passkeyRepository.consumeValidChallenge(
        enrollmentProof,
        vaultEnvelopeAuthenticationProofAudience(credential.id),
        userId
      );
    } catch {
      throw new ChallengeError("Passkey envelope enrollment proof is invalid or expired.");
    }

    let envelopeVariantId = "";
    await runInTransaction(async (tx) => {
      await passkeyRepository.lockForVaultMutation(credential.id, userId, tx);
      const variants = await vaultRepository.findActivePasskeyEnvelopeVariants(
        userId,
        credential.id,
        credential.credentialId,
        undefined,
        tx
      );
      if (variants.length >= MAX_ACTIVE_PASSKEY_ENVELOPE_VARIANTS) {
        throw new ChallengeError(
          "This passkey reached the active envelope variant limit. Use vault recovery before removing a known-good variant."
        );
      }

      const envelope = await vaultRepository.createEnvelope(
        {
          userId,
          passkeyCredentialId: credential.id,
          method: "passkey_authorized_device",
          encryptedVaultKey,
          publicMetadata: {
            credentialId: credential.credentialId,
            prfRequired: true,
            prfCeremony: AUTHENTICATION_CONFIRMED_PRF_CEREMONY,
          },
        },
        tx
      );
      envelopeVariantId = envelope.id;

      await passkeyRepository.updateCredentialFlags(
        credential.id,
        userId,
        { vaultUnlockEnabled: true, prfSupported: options?.prfSupported ?? true },
        tx
      );
      await auditRepository.record(
        "passkey_vault_unlock_enabled",
        userId,
        { credentialId: credential.credentialId },
        tx
      );
    });

    const bindingProof = await issueProof(userId, vaultBindingProofAudience(credential.id));
    return {
      success: true,
      verifiedCredentialId: credential.credentialId,
      envelopeVariantId,
      bindingProof,
    };
  },

  async getVaultUnlockStatus(userId: string, credentialDbId: string) {
    const credential = await passkeyRepository.findByIdForUser(credentialDbId, userId);
    if (!credential) throw new NotFoundError("Passkey not found");
    const variants = await vaultRepository.findActivePasskeyEnvelopeVariants(
      userId,
      credential.id,
      credential.credentialId
    );
    const authenticationConfirmedVariantCount = variants.filter(
      isAuthenticationConfirmedPasskeyVariant
    ).length;
    return {
      signInEnabled: credential.signInEnabled,
      vaultUnlockEnabled: Boolean(credential.vaultUnlockEnabled && variants.length > 0),
      prfSupported: credential.prfSupported,
      credentialId: credential.credentialId,
      credentialDeviceType: credential.credentialDeviceType,
      backupEligible: credential.backupEligible,
      credentialBackedUp: credential.credentialBackedUp,
      activeEnvelopeVariantCount: variants.length,
      authenticationConfirmedVariantCount,
      needsCompatibilityConfirmation:
        credential.vaultUnlockEnabled &&
        variants.length > 0 &&
        authenticationConfirmedVariantCount === 0,
    };
  },

  async getManageVaultUnlockAuthOptions(userId: string, credentialDbId: string, ip?: string) {
    const credential = await passkeyRepository.findByIdForUser(credentialDbId, userId);
    if (!credential) throw new NotFoundError("Passkey not found");
    if (!credential.vaultUnlockEnabled) {
      throw new ChallengeError("Passkey vault unlock is not enabled for this passkey.");
    }
    return getVaultUnlockAuthOptions(userId, credentialDbId, ip);
  },

  async disableVaultUnlockWithProof(
    userId: string,
    credentialDbId: string,
    input: {
      bindingProof: string;
      verifiedCredentialId: string;
      selectedEnvelopeVariantId: string;
    }
  ) {
    const credential = await passkeyRepository.findByIdForUser(credentialDbId, userId);
    if (!credential) throw new NotFoundError("Passkey not found");
    if (credential.credentialId !== input.verifiedCredentialId) {
      throw new ChallengeError("Passkey mismatch. Try again with the selected passkey.");
    }

    try {
      await passkeyRepository.consumeValidChallenge(
        input.bindingProof,
        vaultBindingProofAudience(credential.id),
        userId
      );
    } catch {
      throw new ChallengeError("Passkey management proof is invalid or expired.");
    }

    let removedBindingIds: string[] = [];
    await runInTransaction(async (tx) => {
      await passkeyRepository.lockForVaultMutation(credential.id, userId, tx);
      const matchedVariant = await vaultRepository.findActivePasskeyEnvelopeVariant(
        userId,
        credential.id,
        credential.credentialId,
        input.selectedEnvelopeVariantId,
        tx
      );
      if (!matchedVariant) {
        throw new ChallengeError("Matched passkey envelope variant is no longer active.");
      }
      await vaultRepository.revokePasskeyEnvelopeVariants(
        userId,
        credential.id,
        credential.credentialId,
        tx
      );
      removedBindingIds = await vaultPasskeyDeviceBindingRepository.deleteAllByPasskeyCredentialId(
        credential.id,
        userId,
        tx
      );

      if (!credential.signInEnabled) {
        await passkeyRepository.revoke(credential.id, userId, tx);
        await auditRepository.record("passkey_removed", userId, undefined, tx);
      } else {
        await passkeyRepository.updateCredentialFlags(
          credential.id,
          userId,
          { vaultUnlockEnabled: false },
          tx
        );
      }
      await auditRepository.record(
        "passkey_vault_unlock_disabled",
        userId,
        { credentialId: credential.credentialId },
        tx
      );
    });

    return { success: true, removedBindingIds };
  },
};
