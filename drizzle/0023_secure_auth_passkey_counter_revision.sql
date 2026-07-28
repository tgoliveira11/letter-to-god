ALTER TABLE "passkey_credentials" ADD COLUMN IF NOT EXISTS "counter_revision" integer DEFAULT 0 NOT NULL;
