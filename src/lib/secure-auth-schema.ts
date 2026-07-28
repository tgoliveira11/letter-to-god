import "server-only";

import { getPostgresClient } from "@/lib/db/postgres-client";

const REQUIRED_USER_COLUMNS = [
  "id",
  "email",
  "auth_provider",
  "password_hash",
  "email_verified_at",
  "password_updated_at",
  "role",
  "status",
  "created_at",
  "updated_at",
] as const;

const REQUIRED_AUTH_TABLES = [
  "users",
  "account_sessions",
  "account_tokens",
  "user_two_factor_settings",
  "user_two_factor_login_challenges",
  "user_two_factor_login_tokens",
  "user_two_factor_session_upgrades",
  "user_two_factor_backup_codes",
  "admin_config_overrides",
  "api_keys",
  "invite_codes",
  "invite_uses",
  "login_attempt_counters",
  "user_preferences",
  "passkey_credentials",
] as const;

const REQUIRED_PASSKEY_CREDENTIAL_COLUMNS = ["counter_revision"] as const;

export class SecureAuthDatabaseNotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecureAuthDatabaseNotReadyError";
  }
}

function migrationHint(): string {
  return "Run `npm run db:migrate` against your development PostgreSQL (see README).";
}

let readyPromise: Promise<void> | null = null;

export async function ensureSecureAuthDatabaseReady(): Promise<void> {
  if (!readyPromise) {
    readyPromise = verifySecureAuthDatabaseSchema();
  }
  await readyPromise;
}

async function verifySecureAuthDatabaseSchema(): Promise<void> {
  const sql = getPostgresClient();

  try {
    await sql`SELECT 1`;
  } catch (error) {
    const cause = error instanceof Error ? error.message : "unknown connection error";
    throw new SecureAuthDatabaseNotReadyError(
      `Cannot connect to PostgreSQL for @tgoliveira/secure-auth (${cause}). ${migrationHint()}`
    );
  }

  const tables = await sql<{ table_name: string }[]>`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${REQUIRED_AUTH_TABLES as unknown as string[]})
  `;

  const tableNames = new Set(tables.map((row) => row.table_name));
  const missingTables = REQUIRED_AUTH_TABLES.filter((name) => !tableNames.has(name));
  if (missingTables.length > 0) {
    throw new SecureAuthDatabaseNotReadyError(
      `Auth database schema is missing table(s): ${missingTables.join(", ")}. ${migrationHint()}`
    );
  }

  const columns = await sql<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
  `;

  const columnNames = new Set(columns.map((row) => row.column_name));
  const missingColumns = REQUIRED_USER_COLUMNS.filter((name) => !columnNames.has(name));
  if (missingColumns.length > 0) {
    throw new SecureAuthDatabaseNotReadyError(
      `Auth database schema is missing users column(s): ${missingColumns.join(", ")}. ${migrationHint()}`
    );
  }


  const passkeyColumns = await sql<{ column_name: string }[]>`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'passkey_credentials'
  `;

  const passkeyColumnNames = new Set(passkeyColumns.map((row) => row.column_name));
  const missingPasskeyColumns = REQUIRED_PASSKEY_CREDENTIAL_COLUMNS.filter(
    (name) => !passkeyColumnNames.has(name)
  );
  if (missingPasskeyColumns.length > 0) {
    throw new SecureAuthDatabaseNotReadyError(
      `Auth database schema is missing passkey_credentials column(s): ${missingPasskeyColumns.join(", ")}. ${migrationHint()}`
    );
  }
}
