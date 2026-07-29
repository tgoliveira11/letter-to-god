import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";

function loadEnvLocal() {
  if (!existsSync(".env.local")) return;
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseExpectedCounts() {
  const raw = argument("--expected-counts");
  if (!raw) throw new Error("--expected-counts '<json>' is required");
  const value = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("--expected-counts must be a JSON object");
  }
  return value;
}

function normalizeCounts(rows) {
  return Object.fromEntries(rows.map((row) => [row.name, Number(row.count)]));
}

function assertExactCounts(expected, actual, label) {
  const expectedJson = JSON.stringify(expected, Object.keys(expected).sort());
  const actualJson = JSON.stringify(actual, Object.keys(actual).sort());
  if (expectedJson !== actualJson) {
    throw new Error(`${label} mismatch\nexpected=${expectedJson}\nactual=${actualJson}`);
  }
}

async function collectCounts(tx, cutoff) {
  return normalizeCounts(await tx`
    WITH old_credentials AS (
      SELECT id, credential_id
      FROM passkey_credentials
      WHERE created_at <= ${cutoff}
    ), counts AS (
      SELECT 'passkeyCredentials' name, count(*)::bigint count FROM old_credentials
      UNION ALL
      SELECT 'legacyVaultEnvelopes', count(*)::bigint
      FROM vault_envelopes envelope
      WHERE envelope.created_at <= ${cutoff}
        AND envelope.method IN ('passkey_authorized_device', 'passkey_prf')
      UNION ALL
      SELECT 'deviceBindings', count(*)::bigint
      FROM vault_passkey_device_bindings binding
      WHERE binding.created_at <= ${cutoff}
        AND binding.passkey_credential_id IN (SELECT id FROM old_credentials)
      UNION ALL
      SELECT 'webauthnChallenges', count(*)::bigint
      FROM webauthn_challenges WHERE created_at <= ${cutoff}
      UNION ALL
      SELECT 'twoFactorLoginChallenges', count(*)::bigint
      FROM user_two_factor_login_challenges
      WHERE created_at <= ${cutoff} AND auth_provider = 'passkey'
      UNION ALL
      SELECT 'twoFactorLoginTokens', count(*)::bigint
      FROM user_two_factor_login_tokens
      WHERE created_at <= ${cutoff} AND auth_method = 'passkey'
      UNION ALL
      SELECT 'passkeySessions', count(*)::bigint
      FROM account_sessions
      WHERE created_at <= ${cutoff} AND auth_method = 'passkey'
      UNION ALL
      SELECT 'brokerOperations', count(*)::bigint
      FROM webauthn_broker_operations
      WHERE credential_db_id IN (SELECT id FROM old_credentials)
      UNION ALL
      SELECT 'auditCredentialIds', count(*)::bigint
      FROM audit_events
      WHERE created_at <= ${cutoff} AND metadata ? 'credentialId'
      UNION ALL
      SELECT 'portableMappingsOnTargetCredentials', count(*)::bigint
      FROM vault_portable_broker_envelopes
      WHERE passkey_credential_id IN (SELECT id FROM old_credentials)
    )
    SELECT name, count FROM counts ORDER BY name
  `);
}

async function prepareEpoch(sql, expected) {
  return sql.begin("serializable", async (tx) => {
    const [{ cutoff }] = await tx`SELECT clock_timestamp() cutoff`;
    const actual = await collectCounts(tx, cutoff);
    assertExactCounts(expected, actual, "Prepared snapshot counts");
    if (actual.portableMappingsOnTargetCredentials !== 0) {
      throw new Error("Cutover target already contains portable mappings");
    }
    const [epoch] = await tx`
      INSERT INTO passkey_cleanup_epochs (cutoff_at, expected_counts)
      VALUES (${cutoff}, ${tx.json(actual)})
      RETURNING id, cutoff_at
    `;
    return { mode: "prepared", epochId: epoch.id, cutoffAt: epoch.cutoff_at, counts: actual };
  });
}

async function inspectEpoch(sql, epochId, expected) {
  const [epoch] = await sql`
    SELECT id, cutoff_at, status, expected_counts
    FROM passkey_cleanup_epochs WHERE id = ${epochId}
  `;
  if (!epoch) throw new Error("Cleanup epoch not found");
  assertExactCounts(expected, epoch.expected_counts, "Command and stored expected counts");
  const actual = await collectCounts(sql, epoch.cutoff_at);
  assertExactCounts(expected, actual, "Live target counts");
  return { mode: "dry-run", epochId, cutoffAt: epoch.cutoff_at, status: epoch.status, counts: actual };
}

async function executeEpoch(sql, epochId, expected) {
  return sql.begin("serializable", async (tx) => {
    await tx`LOCK TABLE passkey_credentials, vault_envelopes, vault_passkey_device_bindings,
      webauthn_challenges, user_two_factor_login_challenges, user_two_factor_login_tokens,
      account_sessions, webauthn_broker_operations, vault_portable_broker_envelopes,
      audit_events, passkey_cleanup_epochs IN SHARE ROW EXCLUSIVE MODE`;
    const [epoch] = await tx`
      SELECT id, cutoff_at, status, expected_counts
      FROM passkey_cleanup_epochs WHERE id = ${epochId} FOR UPDATE
    `;
    if (!epoch) throw new Error("Cleanup epoch not found");
    if (epoch.status !== "planned") throw new Error("Cleanup epoch is not planned");
    assertExactCounts(expected, epoch.expected_counts, "Command and stored expected counts");
    const before = await collectCounts(tx, epoch.cutoff_at);
    assertExactCounts(expected, before, "Locked target counts");
    if (before.portableMappingsOnTargetCredentials !== 0) {
      throw new Error("Cleanup would delete a credential referenced by a portable mapping");
    }

    await tx`CREATE TEMP TABLE cleanup_target_credentials ON COMMIT DROP AS
      SELECT id FROM passkey_credentials WHERE created_at <= ${epoch.cutoff_at}`;
    const deleted = {};
    deleted.deviceBindings = (await tx`
      DELETE FROM vault_passkey_device_bindings
      WHERE created_at <= ${epoch.cutoff_at}
        AND passkey_credential_id IN (SELECT id FROM cleanup_target_credentials)
      RETURNING id
    `).count;
    deleted.legacyVaultEnvelopes = (await tx`
      DELETE FROM vault_envelopes
      WHERE created_at <= ${epoch.cutoff_at}
        AND method IN ('passkey_authorized_device', 'passkey_prf')
      RETURNING id
    `).count;
    deleted.twoFactorLoginChallenges = (await tx`
      DELETE FROM user_two_factor_login_challenges
      WHERE created_at <= ${epoch.cutoff_at} AND auth_provider = 'passkey'
      RETURNING id
    `).count;
    deleted.twoFactorLoginTokens = (await tx`
      DELETE FROM user_two_factor_login_tokens
      WHERE created_at <= ${epoch.cutoff_at} AND auth_method = 'passkey'
      RETURNING id
    `).count;
    deleted.webauthnChallenges = (await tx`
      DELETE FROM webauthn_challenges WHERE created_at <= ${epoch.cutoff_at} RETURNING id
    `).count;
    deleted.brokerOperations = (await tx`
      DELETE FROM webauthn_broker_operations
      WHERE credential_db_id IN (SELECT id FROM cleanup_target_credentials)
      RETURNING request_id
    `).count;
    deleted.passkeySessions = (await tx`
      DELETE FROM account_sessions
      WHERE created_at <= ${epoch.cutoff_at} AND auth_method = 'passkey'
      RETURNING id
    `).count;
    deleted.passkeyCredentials = (await tx`
      DELETE FROM passkey_credentials
      WHERE id IN (SELECT id FROM cleanup_target_credentials)
      RETURNING id
    `).count;
    deleted.auditCredentialIds = (await tx`
      UPDATE audit_events SET metadata = metadata - 'credentialId'
      WHERE created_at <= ${epoch.cutoff_at} AND metadata ? 'credentialId'
      RETURNING id
    `).count;
    deleted.portableMappingsOnTargetCredentials = 0;
    assertExactCounts(expected, deleted, "Deleted and sanitized counts");
    const after = await collectCounts(tx, epoch.cutoff_at);
    const zero = Object.fromEntries(Object.keys(after).map((key) => [key, 0]));
    assertExactCounts(zero, after, "Cleanup postcondition");
    await tx`
      UPDATE passkey_cleanup_epochs
      SET status = 'completed', actual_counts = ${tx.json(deleted)}, cleanup_completed_at = now()
      WHERE id = ${epochId}
    `;
    return { mode: "executed", epochId, cutoffAt: epoch.cutoff_at, counts: deleted };
  });
}

async function reopenEpoch(sql, epochId) {
  const [epoch] = await sql`
    UPDATE passkey_cleanup_epochs SET enrollment_reopened_at = now()
    WHERE id = ${epochId} AND status = 'completed' AND enrollment_reopened_at IS NULL
    RETURNING id, enrollment_reopened_at
  `;
  if (!epoch) throw new Error("Completed, unopened cleanup epoch not found");
  return { mode: "reopened", epochId: epoch.id, reopenedAt: epoch.enrollment_reopened_at };
}

loadEnvLocal();
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const prepare = process.argv.includes("--prepare-epoch");
const execute = process.argv.includes("--execute");
const reopen = process.argv.includes("--reopen-epoch");
const epochId = argument("--epoch-id");
if ([prepare, execute, reopen].filter(Boolean).length > 1) {
  throw new Error("Choose only one of --prepare-epoch, --execute, or --reopen-epoch");
}

const sql = postgres(connectionString, { max: 1 });
try {
  let result;
  if (prepare) {
    result = await prepareEpoch(sql, parseExpectedCounts());
  } else if (reopen) {
    if (!epochId) throw new Error("--epoch-id is required");
    result = await reopenEpoch(sql, epochId);
  } else {
    if (!epochId) throw new Error("--epoch-id is required for dry-run or execute");
    const expected = parseExpectedCounts();
    result = execute
      ? await executeEpoch(sql, epochId, expected)
      : await inspectEpoch(sql, epochId, expected);
  }
  console.log(JSON.stringify(result, null, 2));
} finally {
  await sql.end({ timeout: 1 });
}
