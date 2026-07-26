import { rejectPlaintextFields } from "@/lib/validation/plaintext-forbidden";

const PASSKEY_VAULT_FORBIDDEN_FIELDS = [
  "prfOutput",
  "userVaultKey",
  "noteKey",
  "vaultPassword",
  "recoveryPhrase",
] as const;

export function rejectPasskeyVaultForbiddenFields(body: Record<string, unknown>): string | null {
  const plaintextError = rejectPlaintextFields(body);
  if (plaintextError) return plaintextError;

  for (const field of PASSKEY_VAULT_FORBIDDEN_FIELDS) {
    if (field in body && body[field] !== undefined) {
      return `Forbidden field '${field}' is not allowed`;
    }
  }
  const stack: unknown[] = [body];
  const seen = new Set<object>();
  while (stack.length > 0) {
    const value = stack.pop();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }
    const record = value as Record<string, unknown>;
    if ("prfOutput" in record || "prfHash" in record) {
      return "Passkey PRF output or hashes must never be sent to the server";
    }
    const extensionResults = record.clientExtensionResults;
    if (
      extensionResults &&
      typeof extensionResults === "object" &&
      !Array.isArray(extensionResults) &&
      "prf" in (extensionResults as Record<string, unknown>)
    ) {
      return "WebAuthn PRF extension results must never be sent to the server";
    }
    stack.push(...Object.values(record));
  }
  return null;
}
