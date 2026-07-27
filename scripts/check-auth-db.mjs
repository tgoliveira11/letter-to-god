import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";

function loadEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvLocal();

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set (check .env.local).");
  process.exit(1);
}

const requiredUserColumns = [
  "id",
  "email",
  "auth_provider",
  "password_hash",
  "email_verified_at",
  "password_updated_at",
  "created_at",
  "updated_at",
];

const requiredTables = [
  "users",
  "account_sessions",
  "account_tokens",
  "user_two_factor_settings",
  "user_two_factor_login_challenges",
  "user_two_factor_login_tokens",
  "user_two_factor_session_upgrades",
  "user_two_factor_backup_codes",
  "user_preferences",
];

const sql = postgres(connectionString, { max: 1 });

try {
  await sql`SELECT 1`;
  console.log("PostgreSQL connection: OK");

  const tables = await sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY(${requiredTables})
  `;
  const tableNames = new Set(tables.map((row) => row.table_name));
  const missingTables = requiredTables.filter((name) => !tableNames.has(name));
  if (missingTables.length > 0) {
    console.error("Missing auth table(s):", missingTables.join(", "));
    console.error("Run: npm run db:migrate");
    process.exit(1);
  }
  console.log("Auth tables: OK");

  const columns = await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
  `;
  const columnNames = new Set(columns.map((row) => row.column_name));
  const missingColumns = requiredUserColumns.filter((name) => !columnNames.has(name));
  if (missingColumns.length > 0) {
    console.error("Missing users column(s):", missingColumns.join(", "));
    console.error("Run: npm run db:migrate");
    process.exit(1);
  }
  console.log("users columns: OK");
  console.log("Auth database schema is ready for @tgoliveira/secure-auth.");
} catch (error) {
  console.error("Auth database check failed:", error instanceof Error ? error.message : error);
  console.error("Run: npm run db:migrate");
  process.exit(1);
} finally {
  await sql.end({ timeout: 1 });
}
