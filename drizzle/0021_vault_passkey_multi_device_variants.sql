ALTER TABLE "passkey_credentials" ADD COLUMN "credential_device_type" text;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD COLUMN "backup_eligible" boolean;--> statement-breakpoint
ALTER TABLE "passkey_credentials" ADD COLUMN "credential_backed_up" boolean;--> statement-breakpoint
ALTER TABLE "vault_envelopes" ADD COLUMN "passkey_credential_id" uuid;--> statement-breakpoint
ALTER TABLE "vault_passkey_device_bindings" ADD COLUMN "selected_envelope_variant_id" uuid;--> statement-breakpoint
DROP INDEX IF EXISTS "idx_vault_passkey_device_bindings_credential";--> statement-breakpoint
ALTER TABLE "vault_envelopes" ADD CONSTRAINT "vault_envelopes_passkey_credential_id_passkey_credentials_id_fk" FOREIGN KEY ("passkey_credential_id") REFERENCES "public"."passkey_credentials"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "vault_envelopes" AS envelope
SET "passkey_credential_id" = credential."id"
FROM "passkey_credentials" AS credential
WHERE envelope."method" = 'passkey_authorized_device'
  AND envelope."passkey_credential_id" IS NULL
  AND envelope."public_metadata" ->> 'credentialId' = credential."credential_id"
  AND envelope."user_id" = credential."user_id";--> statement-breakpoint
UPDATE "vault_envelopes" AS envelope
SET "passkey_credential_id" = (
  SELECT credential."id"
  FROM "passkey_credentials" AS credential
  WHERE credential."user_id" = envelope."user_id"
    AND credential."vault_unlock_enabled" = true
    AND credential."revoked_at" IS NULL
  LIMIT 1
)
WHERE envelope."method" = 'passkey_authorized_device'
  AND envelope."passkey_credential_id" IS NULL
  AND NULLIF(envelope."public_metadata" ->> 'credentialId', '') IS NULL
  AND (
    SELECT COUNT(*)
    FROM "passkey_credentials" AS credential
    WHERE credential."user_id" = envelope."user_id"
      AND credential."vault_unlock_enabled" = true
      AND credential."revoked_at" IS NULL
  ) = 1;--> statement-breakpoint
UPDATE "vault_passkey_device_bindings" AS binding
SET "selected_envelope_variant_id" = (
  SELECT envelope."id"
  FROM "vault_envelopes" AS envelope
  WHERE envelope."user_id" = binding."user_id"
    AND envelope."passkey_credential_id" = binding."passkey_credential_id"
    AND envelope."method" = 'passkey_authorized_device'
    AND envelope."revoked_at" IS NULL
  ORDER BY envelope."created_at" ASC, envelope."id" ASC
  LIMIT 1
)
WHERE binding."selected_envelope_variant_id" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "vault_envelopes" AS envelope
    WHERE envelope."user_id" = binding."user_id"
      AND envelope."passkey_credential_id" = binding."passkey_credential_id"
      AND envelope."method" = 'passkey_authorized_device'
      AND envelope."revoked_at" IS NULL
  );--> statement-breakpoint
CREATE INDEX "idx_vault_envelopes_passkey_credential" ON "vault_envelopes" USING btree ("passkey_credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vault_envelopes_id_passkey_credential" ON "vault_envelopes" USING btree ("id", "passkey_credential_id");--> statement-breakpoint
ALTER TABLE "vault_passkey_device_bindings" ADD CONSTRAINT "vault_passkey_binding_selected_variant_credential_fk" FOREIGN KEY ("selected_envelope_variant_id", "passkey_credential_id") REFERENCES "public"."vault_envelopes"("id", "passkey_credential_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_vault_passkey_device_bindings_credential" ON "vault_passkey_device_bindings" USING btree ("passkey_credential_id");--> statement-breakpoint
CREATE INDEX "idx_vault_passkey_device_bindings_selected_variant" ON "vault_passkey_device_bindings" USING btree ("selected_envelope_variant_id");
