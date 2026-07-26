import { runInTransaction } from "@/lib/db/transaction";
import { randomBytes } from "node:crypto";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { passkeyRepository } from "@/server/repositories/passkey-repository";
import { vaultPasskeyDeviceBindingRepository } from "@/server/repositories/vault-passkey-device-binding-repository";
import { vaultRepository } from "@/server/repositories/vault-repository";
import { auditRepository } from "@/server/repositories/audit-repository";
import {
  resolvePasskeyUnlockAvailableOnThisDevice,
} from "@/server/services/vault-passkey-device-binding-service";
import { enforceRateLimit, RateLimitError } from "@/server/policies/rate-limit";
import { passkeyPrfExtensions } from "@/lib/passkey/prf";
import {
  toAllowCredentialDescriptor,
  persistRegistrationTransports,
  vaultRegistrationExcludeCredentials,
} from "@/lib/passkey/passkey-transports";
import {
  PASSKEY_ACCOUNT_ONLY_FOR_SIGN_IN_MESSAGE,
  PASSKEY_NOT_LINKED_TO_VAULT_UNLOCK_MESSAGE,
  PASSKEY_VAULT_UNLOCK_NOT_CONFIGURED_MESSAGE,
} from "@/lib/passkey/messages";
import {
  getWebAuthnOrigins,
  getWebAuthnRpId,
  getWebAuthnRpName,
  toPasskeyVerificationErrorMessage,
} from "@/lib/passkey/webauthn-config";

const rpName = getWebAuthnRpName();
const rpID = getWebAuthnRpId();
const origins = getWebAuthnOrigins();

export type PasskeyAuthenticatePurpose = "vault_unlock";

type PasskeyAuthenticationOptions = {
  purpose?: PasskeyAuthenticatePurpose;
  deviceBindingId?: string;
  credentialId?: string;
};

type PasskeyRegistrationOptions = {
  vaultOnly?: boolean;
};

/**
 * Random per-registration WebAuthn user handle for vault-only passkeys. Distinct
 * handles let multiple vault passkeys (one per device) coexist without a synced
 * provider overwriting one another, and stay separate from the account passkey handle
 * (the userId) so adding an account passkey never replaces a vault passkey.
 */
export function vaultPasskeyUserHandle(): Uint8Array<ArrayBuffer> {
  const handle = new Uint8Array(new ArrayBuffer(32));
  handle.set(randomBytes(32));
  return handle;
}

/**
 * Builds vault-unlock authentication options for passkey envelope credentials.
 *
 * When `deviceBindingId` is present (HttpOnly cookie), scopes `allowCredentials` to the
 * single credential bound to this browser so multi-device accounts skip the passkey picker.
 * Without a binding, offers every active vault passkey (legacy / first unlock on a browser).
 */
async function buildVaultUnlockAuthenticationOptions(
  userId?: string,
  deviceBindingId?: string,
  requestedCredentialId?: string
) {
  if (!userId) {
    throw new ChallengeError(PASSKEY_VAULT_UNLOCK_NOT_CONFIGURED_MESSAGE);
  }

  const envelopes = await vaultRepository.findActiveEnvelopesByUserId(userId);
  const activePasskeyEnvelopes = envelopes.filter(
    (envelope) => envelope.method === "passkey_authorized_device"
  );
  if (activePasskeyEnvelopes.length === 0) {
    throw new ChallengeError(PASSKEY_VAULT_UNLOCK_NOT_CONFIGURED_MESSAGE);
  }

  const credentials = await passkeyRepository.findByUserId(userId);
  let activeCredentials = credentials.filter(
    (credential) => credential.vaultUnlockEnabled && activePasskeyEnvelopes.some((envelope) => {
      if (envelope.passkeyCredentialId === credential.id) return true;
      const metadata = envelope.publicMetadata as { credentialId?: string } | null;
      return envelope.passkeyCredentialId == null && metadata?.credentialId === credential.credentialId;
    })
  );

  if (requestedCredentialId) {
    const requestedCredential = activeCredentials.find(
      (credential) => credential.credentialId === requestedCredentialId
    );
    if (!requestedCredential) {
      throw new ChallengeError(PASSKEY_NOT_LINKED_TO_VAULT_UNLOCK_MESSAGE);
    }
    activeCredentials = [requestedCredential];
  } else if (deviceBindingId) {
    const binding = await vaultPasskeyDeviceBindingRepository.findByIdForUser(
      deviceBindingId,
      userId
    );
    if (!binding) {
      throw new StaleVaultDeviceBindingError();
    }
    const boundCredential = activeCredentials.find(
      (credential) => credential.id === binding.passkeyCredentialId
    );
    if (!boundCredential) {
      throw new StaleVaultDeviceBindingError();
    }
    activeCredentials = [boundCredential];
  }

  if (activeCredentials.length === 0) {
    throw new ChallengeError(PASSKEY_VAULT_UNLOCK_NOT_CONFIGURED_MESSAGE);
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: activeCredentials.map((credential) =>
      toAllowCredentialDescriptor(credential)
    ),
    userVerification: "required",
    extensions: passkeyPrfExtensions(userId),
  });

  await passkeyRepository.storeChallenge({
    userId,
    challenge: options.challenge,
    type: "authentication",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  return options;
}

export const passkeyService = {
  async getRegistrationOptions(
    userId: string,
    userName: string,
    ip?: string,
    regOptions?: PasskeyRegistrationOptions
  ) {
    await enforceRateLimit({
      operation: "passkey.register",
      userId,
      ip,
      endpoint: "/api/passkeys/register",
    });

    const existing = await passkeyRepository.findByUserId(userId);
    const vaultOnly = Boolean(regOptions?.vaultOnly);
    const excludeCredentials = vaultOnly
      ? vaultRegistrationExcludeCredentials(existing)
      : existing.map((credential) => toAllowCredentialDescriptor(credential));

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: vaultOnly ? `${userName} · SelahKeep vault` : userName,
      userID: vaultOnly
        ? vaultPasskeyUserHandle()
        : new TextEncoder().encode(userId),
      attestationType: "none",
      excludeCredentials,
      authenticatorSelection: vaultOnly
        ? {
            authenticatorAttachment: "platform",
            residentKey: "preferred",
            userVerification: "required",
          }
        : {
            residentKey: "preferred",
            userVerification: "preferred",
          },
      extensions: passkeyPrfExtensions(userId),
    });

    await passkeyRepository.storeChallenge({
      userId,
      challenge: options.challenge,
      type: "registration",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    return options;
  },

  async verifyRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    options?: {
      vaultOnly?: boolean;
      friendlyName?: string;
    }
  ) {
    const clientData = JSON.parse(
      Buffer.from(response.response.clientDataJSON, "base64url").toString()
    );

    let challengeRecord;
    try {
      challengeRecord = await passkeyRepository.consumeValidChallenge(
        clientData.challenge,
        "registration",
        userId
      );
    } catch {
      throw new ChallengeError("Invalid or expired challenge");
    }

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeRecord.challenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      throw new Error("Passkey registration failed");
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    // Vault-only passkeys may register WITHOUT an envelope: the canonical flow
    // registers the credential first, then creates the envelope from an
    // authentication-ceremony PRF (POST /api/account/passkeys/:id/enable-vault-unlock),
    // so the wrap PRF matches the unlock `get` ceremony. Registration-PRF wrapping
    // is unreliable on iOS (create vs get can differ).
    const vaultOnly = Boolean(options?.vaultOnly);

    let createdCredentialDbId = "";
    await runInTransaction(async (tx) => {
      const createdCredential = await passkeyRepository.createCredential(
        {
          userId,
          credentialId: credential.id,
          publicKey: Buffer.from(credential.publicKey).toString("base64url"),
          counter: String(credential.counter),
          transports: persistRegistrationTransports(credential.transports),
          friendlyName: vaultOnly
            ? options?.friendlyName?.trim()
              ? `Vault passkey · ${options.friendlyName.trim().slice(0, 40)}`
              : "Vault passkey"
            : null,
          signInEnabled: vaultOnly ? false : true,
          vaultUnlockEnabled: false,
          prfSupported: null,
          credentialDeviceType,
          backupEligible: credentialDeviceType === "multiDevice",
          credentialBackedUp,
        },
        tx
      );
      createdCredentialDbId = createdCredential.id;

      await auditRepository.record("passkey_added", userId, undefined, tx);
    });

    return {
      verified: true,
      credentialId: credential.id,
      verifiedCredentialId: credential.id,
      credentialDbId: createdCredentialDbId,
      deviceType: credentialDeviceType,
      backedUp: credentialBackedUp,
    };
  },

  async getAuthenticationOptions(
    userId?: string,
    ip?: string,
    authOptions?: PasskeyAuthenticationOptions
  ) {
    await enforceRateLimit({
      operation: "passkey.authenticate",
      userId,
      ip,
      endpoint: "/api/passkeys/authenticate",
    });

    const purpose = authOptions?.purpose;

    // A valid browser binding selects one exact credential. Missing/stale bindings use
    // the explicit server allow-list; stored transports are preserved and never guessed.
    if (purpose === "vault_unlock") {
      return buildVaultUnlockAuthenticationOptions(
        userId,
        authOptions?.deviceBindingId,
        authOptions?.credentialId
      );
    }

    const credentials = userId ? await passkeyRepository.findByUserId(userId) : [];
    const allowCredentials =
      userId && credentials.length > 0
        ? credentials.map((credential) => toAllowCredentialDescriptor(credential))
        : undefined;
    const extensions = userId ? passkeyPrfExtensions(userId) : undefined;

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: "preferred",
      extensions,
    });

    await passkeyRepository.storeChallenge({
      userId,
      challenge: options.challenge,
      type: "authentication",
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    return options;
  },

  async verifyAuthentication(
    userId: string,
    response: AuthenticationResponseJSON,
    authOptions?: PasskeyAuthenticationOptions
  ) {
    const clientData = JSON.parse(
      Buffer.from(response.response.clientDataJSON, "base64url").toString()
    );

    let challengeRecord;
    try {
      challengeRecord = await passkeyRepository.consumeValidChallenge(
        clientData.challenge,
        "authentication",
        userId
      );
    } catch {
      throw new ChallengeError("Invalid or expired challenge");
    }

    const credential = await passkeyRepository.findByCredentialId(response.id);
    if (!credential || credential.userId !== userId) {
      await auditRepository.record("failed_unlock_attempt", userId, { method: "passkey" });
      throw new NotFoundError(
        "This passkey is not registered for your account. Set up your passkey again from Recovery while your vault is unlocked."
      );
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
      await auditRepository.record("failed_unlock_attempt", userId, { method: "passkey" });
      throw new ChallengeError(toPasskeyVerificationErrorMessage(error));
    }

    if (!verification.verified) {
      await auditRepository.record("failed_unlock_attempt", userId, { method: "passkey" });
      throw new ChallengeError("Passkey authentication failed. Try again or use your recovery code.");
    }

    await passkeyRepository.updateCounter(
      credential.credentialId,
      String(verification.authenticationInfo.newCounter)
    );

    await passkeyRepository.updateLastUsedAt(credential.credentialId);

    await passkeyRepository.updateCredentialFlags(credential.id, userId, {
      credentialDeviceType: verification.authenticationInfo.credentialDeviceType,
      backupEligible: verification.authenticationInfo.credentialDeviceType === "multiDevice",
      credentialBackedUp: verification.authenticationInfo.credentialBackedUp,
    });

    const purpose = authOptions?.purpose;

    if (purpose === "vault_unlock") {
      if (!credential.vaultUnlockEnabled) {
        await auditRepository.record("failed_unlock_attempt", userId, { method: "passkey" });
        throw new ChallengeError(PASSKEY_ACCOUNT_ONLY_FOR_SIGN_IN_MESSAGE);
      }

      const binding = authOptions?.deviceBindingId
        ? await vaultPasskeyDeviceBindingRepository.findByIdForUser(
            authOptions.deviceBindingId,
            userId
          )
        : null;
      const selectedEnvelopeVariantId =
        binding && binding.passkeyCredentialId === credential.id
          ? binding.selectedEnvelopeVariantId
          : null;
      const variants = await vaultRepository.findActivePasskeyEnvelopeVariants(
        userId,
        credential.id,
        credential.credentialId,
        selectedEnvelopeVariantId
      );

      if (variants.length === 0) {
        await auditRepository.record("failed_unlock_attempt", userId, { method: "passkey" });
        throw new ChallengeError(PASSKEY_NOT_LINKED_TO_VAULT_UNLOCK_MESSAGE);
      }

      if (variants.length > 5) {
        throw new ChallengeError(
          "This passkey has too many active envelope variants. Use vault recovery to review them safely."
        );
      }

      const bindingProof = randomBytes(32).toString("base64url");
      await passkeyRepository.storeChallenge({
        userId,
        challenge: bindingProof,
        type: `vault-binding:${credential.id}`,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });

      return {
        verified: true,
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
    }

    // Account authentication and vault unlock are separate domains. Only the explicit
    // vault_unlock purpose returns encrypted candidate envelopes.
    return { verified: true };
  },

  async bindVerifiedCredentialToDevice(
    userId: string,
    input: {
      bindingProof: string;
      verifiedCredentialId: string;
      selectedEnvelopeVariantId: string;
      existingDeviceBindingId?: string;
      deviceLabel?: string | null;
    }
  ) {
    const credential = await passkeyRepository.findByCredentialId(input.verifiedCredentialId);
    if (!credential || credential.userId !== userId || !credential.vaultUnlockEnabled) {
      throw new NotFoundError(PASSKEY_NOT_LINKED_TO_VAULT_UNLOCK_MESSAGE);
    }

    try {
      await passkeyRepository.consumeValidChallenge(
        input.bindingProof,
        `vault-binding:${credential.id}`,
        userId
      );
    } catch {
      throw new ChallengeError("Passkey binding proof is invalid or expired.");
    }

    return runInTransaction(async (tx) => {
      await passkeyRepository.lockForVaultMutation(credential.id, userId, tx);
      const variant = await vaultRepository.findActivePasskeyEnvelopeVariant(
        userId,
        credential.id,
        credential.credentialId,
        input.selectedEnvelopeVariantId,
        tx
      );
      if (!variant) {
        throw new ChallengeError(
          "Selected passkey envelope variant is not active for this credential."
        );
      }
      return vaultPasskeyDeviceBindingRepository.bindPasskeyToDevice(
        userId,
        credential.id,
        {
          existingBindingId: input.existingDeviceBindingId,
          selectedEnvelopeVariantId: variant.id,
          deviceLabel: input.deviceLabel,
        },
        tx
      );
    });
  },

  async listVaultUnlockCredentials(userId: string, deviceBindingId?: string) {
    const credentials = await passkeyRepository.findByUserId(userId);
    const envelope = await vaultRepository.findActiveEnvelopeByMethod(
      userId,
      "passkey_authorized_device"
    );
    const deviceBindings = await vaultPasskeyDeviceBindingRepository.listByUserId(userId);

    const vaultCredentials = credentials.filter((credential) => credential.vaultUnlockEnabled);

    const currentBinding = deviceBindingId
      ? deviceBindings.find((binding) => binding.id === deviceBindingId)
      : undefined;
    const currentDeviceCredentialId = currentBinding?.credentialId;
    const passkeyUnlockAvailableOnThisDevice = await resolvePasskeyUnlockAvailableOnThisDevice(
      userId,
      deviceBindingId
    );
    const passkeysWithVariants = await Promise.all(
      vaultCredentials.map(async (credential) => {
        const variants = await vaultRepository.findActivePasskeyEnvelopeVariants(
          userId,
          credential.id,
          credential.credentialId
        );
        return {
          id: credential.id,
          friendlyName: credential.friendlyName ?? "Vault passkey",
          signInEnabled: credential.signInEnabled,
          vaultUnlockEnabled: credential.vaultUnlockEnabled,
          prfSupported: credential.prfSupported,
          credentialId: credential.credentialId,
          credentialDeviceType: credential.credentialDeviceType,
          backupEligible: credential.backupEligible,
          credentialBackedUp: credential.credentialBackedUp,
          activeEnvelopeVariantCount: variants.length,
        };
      })
    );

    if (vaultCredentials.length === 0 && envelope) {
      return {
        passkeys: [] as Array<{
          id: string;
          friendlyName: string;
          signInEnabled: boolean;
          vaultUnlockEnabled: boolean;
          prfSupported: boolean | null;
          credentialId: string;
          credentialDeviceType: string | null;
          backupEligible: boolean | null;
          credentialBackedUp: boolean | null;
          activeEnvelopeVariantCount: number;
        }>,
        deviceBindings: deviceBindings.map((binding) => ({
          id: binding.id,
          credentialId: binding.credentialId,
          deviceLabel: binding.deviceLabel ?? binding.friendlyName ?? "Vault passkey",
          createdAt: binding.createdAt.toISOString(),
          lastUsedAt: binding.lastUsedAt?.toISOString() ?? null,
          selectedEnvelopeVariantId: binding.selectedEnvelopeVariantId,
          isCurrentDevice: binding.id === deviceBindingId,
        })),
        currentDeviceCredentialId,
        passkeyUnlockAvailableOnThisDevice,
        serverEnvelopeConfigured: true,
      };
    }

    return {
      passkeys: passkeysWithVariants,
      deviceBindings: deviceBindings.map((binding) => ({
        id: binding.id,
        credentialId: binding.credentialId,
        deviceLabel: binding.deviceLabel ?? binding.friendlyName ?? "Vault passkey",
        createdAt: binding.createdAt.toISOString(),
        lastUsedAt: binding.lastUsedAt?.toISOString() ?? null,
        selectedEnvelopeVariantId: binding.selectedEnvelopeVariantId,
        isCurrentDevice: binding.id === deviceBindingId,
      })),
      currentDeviceCredentialId,
      passkeyUnlockAvailableOnThisDevice,
      serverEnvelopeConfigured: Boolean(envelope),
    };
  },

  async removeAll(userId: string) {
    const credentials = await passkeyRepository.findByUserId(userId);
    const envelope = await vaultRepository.findActiveEnvelopeByMethod(
      userId,
      "passkey_authorized_device"
    );

    if (credentials.length === 0 && !envelope) {
      throw new NotFoundError("No passkey configured");
    }

    await runInTransaction(async (tx) => {
      for (const credential of credentials) {
        await passkeyRepository.lockForVaultMutation(credential.id, userId, tx);
      }
      await passkeyRepository.revokeAllByUserId(userId, tx);

      await vaultPasskeyDeviceBindingRepository.deleteAllByUserId(userId, tx);

      const envelopes = await vaultRepository.findActiveEnvelopesByUserId(userId);
      for (const item of envelopes) {
        if (item.method === "passkey_authorized_device") {
          await vaultRepository.revokeEnvelope(item.id, userId, tx);
        }
      }

      await auditRepository.record("passkey_removed", userId, undefined, tx);
    });

    return { success: true };
  },
};

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ChallengeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChallengeError";
  }
}

export class StaleVaultDeviceBindingError extends Error {
  constructor() {
    super("This browser's vault passkey binding is stale. Choose and verify a passkey again.");
    this.name = "StaleVaultDeviceBindingError";
  }
}

export { RateLimitError };
