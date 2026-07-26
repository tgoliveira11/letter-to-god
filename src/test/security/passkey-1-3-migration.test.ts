import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(process.cwd(), "drizzle/0021_vault_passkey_multi_device_variants.sql"),
  "utf8"
);

describe("vault-core 1.3 passkey migration", () => {
  it("maps legacy metadata and only infers metadata-free rows for one eligible credential", () => {
    expect(migration).toContain("envelope.\"public_metadata\" ->> 'credentialId'");
    expect(migration).toContain("NULLIF(envelope.\"public_metadata\" ->> 'credentialId', '') IS NULL");
    expect(migration).toMatch(/SELECT COUNT\(\*\)[\s\S]*\) = 1/);
    expect(migration).toContain('credential."vault_unlock_enabled" = true');
    expect(migration).toContain('credential."revoked_at" IS NULL');
  });

  it("preserves envelope identifiers, ciphertext, AAD, salt, and metadata byte-for-byte", () => {
    expect(migration).not.toMatch(/SET\s+"encrypted_vault_key"/i);
    expect(migration).not.toMatch(/SET\s+"public_metadata"/i);
    expect(migration).not.toMatch(/SET\s+"id"/i);
    expect(migration).not.toMatch(/aad|ciphertext|salt/i);
  });

  it("supports several bindings and enforces selected variant ownership in the database", () => {
    expect(migration).toContain('DROP INDEX IF EXISTS "idx_vault_passkey_device_bindings_credential"');
    expect(migration).toContain('CREATE INDEX "idx_vault_passkey_device_bindings_credential"');
    expect(migration).toContain('CREATE UNIQUE INDEX "uq_vault_envelopes_id_passkey_credential"');
    expect(migration).toContain(
      'FOREIGN KEY ("selected_envelope_variant_id", "passkey_credential_id")'
    );
    expect(migration).toContain(
      'REFERENCES "public"."vault_envelopes"("id", "passkey_credential_id")'
    );
  });
});
