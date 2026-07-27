CREATE TABLE "user_preferences" (
	"user_id" uuid NOT NULL,
	"namespace" varchar(64) NOT NULL,
	"key" varchar(128) NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action,
	CONSTRAINT "user_preferences_user_id_namespace_key_pk" PRIMARY KEY("user_id","namespace","key")
);
--> statement-breakpoint
CREATE INDEX "idx_user_preferences_user_namespace" ON "user_preferences" USING btree ("user_id","namespace");
