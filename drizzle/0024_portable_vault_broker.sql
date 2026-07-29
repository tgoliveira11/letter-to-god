CREATE TABLE "webauthn_broker_operations" (
	"request_id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_session_id" uuid NOT NULL,
	"credential_db_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"action" text NOT NULL,
	"challenge_hash" text NOT NULL,
	"ephemeral_public_key_thumbprint" text,
	"envelope_id_hash" text,
	"challenge_expires_at" timestamp with time zone NOT NULL,
	"challenge_consumed_at" timestamp with time zone,
	"grant_jti_hash" text,
	"grant_expires_at" timestamp with time zone,
	"receipt_jti_hash" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webauthn_broker_operations_challenge_hash_unique" UNIQUE("challenge_hash"),
	CONSTRAINT "webauthn_broker_operations_grant_jti_hash_unique" UNIQUE("grant_jti_hash"),
	CONSTRAINT "webauthn_broker_operations_receipt_jti_hash_unique" UNIQUE("receipt_jti_hash"),
	CONSTRAINT "webauthn_broker_operations_purpose_check" CHECK ("purpose" = 'portable_vault'),
	CONSTRAINT "webauthn_broker_operations_action_scope_check" CHECK ((
		("action" = 'enroll' AND "envelope_id_hash" IS NULL AND "ephemeral_public_key_thumbprint" IS NULL)
		OR ("action" = 'revoke' AND "envelope_id_hash" IS NOT NULL AND "ephemeral_public_key_thumbprint" IS NULL)
		OR ("action" = 'unlock' AND "envelope_id_hash" IS NOT NULL AND "ephemeral_public_key_thumbprint" IS NOT NULL)
	))
);--> statement-breakpoint
CREATE TABLE "vault_portable_broker_envelopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"passkey_credential_id" uuid NOT NULL,
	"broker_envelope_id" uuid,
	"opaque_aad_user_id" uuid NOT NULL,
	"opaque_aad_resource_id" uuid NOT NULL,
	"enrollment_request_id" uuid,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "vault_portable_broker_envelopes_broker_envelope_id_unique" UNIQUE("broker_envelope_id"),
	CONSTRAINT "vault_portable_broker_envelopes_state_check" CHECK ("state" IN ('pending', 'active', 'revoked'))
);--> statement-breakpoint
CREATE TABLE "passkey_cleanup_epochs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"expected_counts" jsonb NOT NULL,
	"actual_counts" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleanup_completed_at" timestamp with time zone,
	"enrollment_reopened_at" timestamp with time zone,
	CONSTRAINT "passkey_cleanup_epochs_status_check" CHECK ("status" IN ('planned', 'completed'))
);--> statement-breakpoint
ALTER TABLE "webauthn_broker_operations" ADD CONSTRAINT "webauthn_broker_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_broker_operations" ADD CONSTRAINT "webauthn_broker_operations_account_session_id_account_sessions_id_fk" FOREIGN KEY ("account_session_id") REFERENCES "public"."account_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webauthn_broker_operations" ADD CONSTRAINT "webauthn_broker_operations_credential_db_id_passkey_credentials_id_fk" FOREIGN KEY ("credential_db_id") REFERENCES "public"."passkey_credentials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_portable_broker_envelopes" ADD CONSTRAINT "vault_portable_broker_envelopes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vault_portable_broker_envelopes" ADD CONSTRAINT "vault_portable_broker_envelopes_passkey_credential_id_passkey_credentials_id_fk" FOREIGN KEY ("passkey_credential_id") REFERENCES "public"."passkey_credentials"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_webauthn_broker_operations_user_session" ON "webauthn_broker_operations" USING btree ("user_id","account_session_id");--> statement-breakpoint
CREATE INDEX "idx_webauthn_broker_operations_expiry" ON "webauthn_broker_operations" USING btree ("challenge_expires_at");--> statement-breakpoint
CREATE INDEX "idx_webauthn_broker_operations_credential" ON "webauthn_broker_operations" USING btree ("credential_db_id");--> statement-breakpoint
CREATE INDEX "idx_vault_portable_broker_envelopes_user_state" ON "vault_portable_broker_envelopes" USING btree ("user_id","state");--> statement-breakpoint
CREATE INDEX "idx_vault_portable_broker_envelopes_credential" ON "vault_portable_broker_envelopes" USING btree ("passkey_credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_vault_portable_broker_envelopes_current_credential" ON "vault_portable_broker_envelopes" USING btree ("passkey_credential_id") WHERE "state" IN ('pending', 'active');--> statement-breakpoint
CREATE INDEX "idx_passkey_cleanup_epochs_cutoff" ON "passkey_cleanup_epochs" USING btree ("cutoff_at");
