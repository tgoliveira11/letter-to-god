"use client";

import {
  generatePortableVaultOpaqueAadScope,
  type PortableVaultOpaqueAadScope,
} from "@tgoliveira/vault-core";
import {
  createPortableVaultBrokerEnrollmentPackage,
  createPortableVaultBrokerUnlockSession,
  assertVaultSessionOperationCurrent,
  serializePortableVaultBrokerEnrollmentPackage,
  unlockPortableVaultBrokerResponse,
} from "@tgoliveira/vault-core/browser";
import type { VaultSessionOperation } from "@tgoliveira/vault-core/browser";
import {
  passkeyPortableVaultGrantApi,
  requestPortableVaultGrant,
} from "@tgoliveira/secure-auth/client";
import { getUserVaultKey } from "@/lib/crypto-client/vault-session";
import { vaultApi, type PortableVaultMapping } from "@/lib/api-client/vault";
import {
  portableVaultBrokerCompletionSchema,
  portableVaultBrokerOperationCompletionSchema,
} from "@/lib/validation/portable-vault-broker";
import { SELAHKEEP_VAULT_PROFILE } from "@/modules/vault/selahkeep-profile";

const MAX_BROKER_RESPONSE_BYTES = 64 * 1024;

function brokerEndpoint(brokerUrl: string, path: string): string {
  const url = new URL(path, brokerUrl.endsWith("/") ? brokerUrl : `${brokerUrl}/`);
  if (url.protocol !== "https:" && url.hostname !== "localhost") {
    throw new Error("Portable vault broker must use HTTPS");
  }
  return url.toString();
}

async function parseBoundedBrokerJson(response: Response): Promise<unknown> {
  if (!response.ok) throw new Error("Portable vault broker request failed");
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BROKER_RESPONSE_BYTES) {
    throw new Error("Portable vault broker response is too large");
  }
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BROKER_RESPONSE_BYTES) {
    throw new Error("Portable vault broker response is too large");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Portable vault broker returned malformed JSON");
  }
}

async function callBroker(
  brokerUrl: string,
  path: string,
  grant: string,
  body: unknown
): Promise<unknown> {
  return parseBoundedBrokerJson(
    await fetch(brokerEndpoint(brokerUrl, path), {
      method: "POST",
      headers: {
        authorization: `Bearer ${grant}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      credentials: "omit",
      cache: "no-store",
      referrerPolicy: "no-referrer",
    })
  );
}

function assertFinalized(
  finalized: {
    action: "enroll" | "unlock" | "revoke";
    requestId: string;
    credentialId: string;
    envelopeId: string;
  },
  expected: {
    action: "enroll" | "unlock" | "revoke";
    requestId: string;
    credentialId: string;
    envelopeId: string;
  }
) {
  if (
    finalized.action !== expected.action ||
    finalized.requestId !== expected.requestId ||
    finalized.credentialId !== expected.credentialId ||
    finalized.envelopeId !== expected.envelopeId
  ) {
    throw new Error("Portable vault completion receipt mismatch");
  }
}

export async function enrollPortablePasskey(input: {
  credentialDbId: string;
  brokerUrl: string;
  operation: VaultSessionOperation;
}): Promise<void> {
  const prepared = await vaultApi.preparePortablePasskey({
    credentialDbId: input.credentialDbId,
    opaqueScope: generatePortableVaultOpaqueAadScope(),
  });
  assertVaultSessionOperationCurrent(input.operation);
  const vaultKey = getUserVaultKey();
  if (!vaultKey) throw new Error("Unlock the vault before enabling portable passkey unlock");
  const enrollment = await createPortableVaultBrokerEnrollmentPackage({
    vaultKey,
    opaqueScope: prepared.opaqueScope,
    profile: SELAHKEEP_VAULT_PROFILE,
  });

  try {
    assertVaultSessionOperationCurrent(input.operation);
    const grant = await requestPortableVaultGrant({
      action: "enroll",
      credentialDbId: input.credentialDbId,
    });
    const brokerResult = portableVaultBrokerCompletionSchema.parse(
      await callBroker(
        input.brokerUrl,
        "api/v1/envelopes/enroll",
        grant.grant,
        serializePortableVaultBrokerEnrollmentPackage(enrollment)
      )
    );
    if (brokerResult.requestId !== grant.requestId) {
      throw new Error("Portable vault broker request mismatch");
    }
    await vaultApi.bindPortablePasskey({
      mappingId: prepared.id,
      brokerEnvelopeId: brokerResult.envelopeId,
      requestId: brokerResult.requestId,
    });
    const finalized = await passkeyPortableVaultGrantApi.finalizeReceipt(
      brokerResult.completionReceipt
    );
    assertFinalized(finalized, {
      action: "enroll",
      requestId: grant.requestId,
      credentialId: grant.verifiedCredentialId,
      envelopeId: brokerResult.envelopeId,
    });
  } finally {
    enrollment.dispose();
  }
}

export async function unlockWithPortablePasskey(input: {
  mapping: PortableVaultMapping;
  brokerUrl: string;
}): Promise<CryptoKey> {
  if (!input.mapping.brokerEnvelopeId || input.mapping.state !== "active") {
    throw new Error("Portable vault mapping is not active");
  }
  const session = await createPortableVaultBrokerUnlockSession();
  try {
    const grant = await requestPortableVaultGrant({
      action: "unlock",
      credentialDbId: input.mapping.credentialDbId,
      envelopeId: input.mapping.brokerEnvelopeId,
      ephemeralPublicKeyJwk: session.publicJwk,
    });
    const response = await callBroker(
      input.brokerUrl,
      "api/v1/envelopes/unlock",
      grant.grant,
      {
        envelopeId: input.mapping.brokerEnvelopeId,
        ephemeralPublicJwk: session.publicJwk,
      }
    );
    const unlocked = await unlockPortableVaultBrokerResponse({
      response,
      session,
      expectedOpaqueScope: input.mapping.opaqueScope as PortableVaultOpaqueAadScope,
      profile: SELAHKEEP_VAULT_PROFILE,
    });
    if (unlocked.status !== "unlocked") {
      throw new Error(`Portable passkey unlock failed: ${unlocked.status}`);
    }
    if (unlocked.requestId !== grant.requestId) {
      throw new Error("Portable vault broker request mismatch");
    }
    const finalized = await passkeyPortableVaultGrantApi.finalizeReceipt(
      unlocked.completionReceipt
    );
    assertFinalized(finalized, {
      action: "unlock",
      requestId: grant.requestId,
      credentialId: grant.verifiedCredentialId,
      envelopeId: input.mapping.brokerEnvelopeId,
    });
    return unlocked.vaultKey;
  } finally {
    session.dispose();
  }
}

export async function revokePortablePasskey(input: {
  mapping: PortableVaultMapping;
  brokerUrl: string;
}): Promise<void> {
  if (!input.mapping.brokerEnvelopeId || input.mapping.state !== "active") {
    throw new Error("Portable vault mapping is not active");
  }
  const grant = await requestPortableVaultGrant({
    action: "revoke",
    credentialDbId: input.mapping.credentialDbId,
    envelopeId: input.mapping.brokerEnvelopeId,
  });
  const brokerResult = portableVaultBrokerOperationCompletionSchema.parse(
    await callBroker(input.brokerUrl, "api/v1/envelopes/revoke", grant.grant, {
      envelopeId: input.mapping.brokerEnvelopeId,
    })
  );
  if (brokerResult.requestId !== grant.requestId) {
    throw new Error("Portable vault broker request mismatch");
  }
  const finalized = await passkeyPortableVaultGrantApi.finalizeReceipt(
    brokerResult.completionReceipt
  );
  assertFinalized(finalized, {
    action: "revoke",
    requestId: grant.requestId,
    credentialId: grant.verifiedCredentialId,
    envelopeId: input.mapping.brokerEnvelopeId,
  });
}
