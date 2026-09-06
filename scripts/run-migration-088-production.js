const crypto = require("crypto");
const pool = require("../db");
const { readMigration, recordMigration } = require("../utils/migrationLedger");

const FILENAME = "088_tenant_system_role_permission_overrides.sql";

function hashRows(rows) {
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

async function snapshot(client) {
  const overridesExist = Boolean((await client.query(
    "SELECT to_regclass('public.tenant_role_overrides') AS value",
  )).rows[0].value);
  const globalRows = (await client.query(
    `SELECT role_id, permission_id FROM role_permissions ORDER BY role_id, permission_id`,
  )).rows;
  return {
    global_role_count: Number((await client.query("SELECT COUNT(*) AS value FROM roles")).rows[0].value),
    global_permission_map_count: globalRows.length,
    global_permission_map_hash: hashRows(globalRows),
    override_count: overridesExist
      ? Number((await client.query("SELECT COUNT(*) AS value FROM tenant_role_overrides")).rows[0].value)
      : 0,
    override_permission_count: overridesExist
      ? Number((await client.query("SELECT COUNT(*) AS value FROM tenant_role_permissions")).rows[0].value)
      : 0,
    ledger_count: Number((await client.query(
      "SELECT COUNT(*) AS value FROM schema_migrations WHERE filename=$1",
      [FILENAME],
    )).rows[0].value),
  };
}

async function schemaChecks(client) {
  const constraints = (await client.query(
    `SELECT conname
     FROM pg_constraint
     WHERE conrelid IN ('tenant_role_overrides'::regclass, 'tenant_role_permissions'::regclass)`,
  )).rows.map((row) => row.conname);
  const indexes = (await client.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname='public'
       AND tablename IN ('tenant_role_overrides','tenant_role_permissions')`,
  )).rows.map((row) => row.indexname);
  const triggers = (await client.query(
    `SELECT tgname FROM pg_trigger
     WHERE tgrelid IN ('tenant_role_overrides'::regclass, 'tenant_role_permissions'::regclass)
       AND NOT tgisinternal`,
  )).rows.map((row) => row.tgname);
  return {
    tables: Boolean((await client.query(
      `SELECT to_regclass('public.tenant_role_overrides') IS NOT NULL
          AND to_regclass('public.tenant_role_permissions') IS NOT NULL AS value`,
    )).rows[0].value),
    primary_override: constraints.includes("tenant_role_overrides_pkey"),
    permission_fk: constraints.includes("tenant_role_permissions_override_fk"),
    lookup_index: indexes.includes("tenant_role_permissions_lookup_idx"),
    system_only_trigger: triggers.includes("trg_tenant_role_overrides_system_only"),
    token_override_trigger: triggers.includes("trg_tenant_role_overrides_bump_session"),
    token_permission_trigger: triggers.includes("trg_tenant_role_permissions_bump_session"),
  };
}

async function runIsolationRehearsal(client) {
  const pair = (await client.query(
    `SELECT r.id AS role_id, r.name AS role_name,
            a.tenant_id AS tenant_a, b.tenant_id AS tenant_b
     FROM roles r
     JOIN users a ON a.role = r.name AND a.tenant_id IS NOT NULL
     JOIN users b ON b.role = r.name AND b.tenant_id IS NOT NULL AND b.tenant_id <> a.tenant_id
     WHERE r.is_system = true AND r.name <> 'platform_superadmin'
     ORDER BY r.id, a.tenant_id, b.tenant_id
     LIMIT 1`,
  )).rows[0];
  if (!pair) throw new Error("088 rehearsal requires one system role used by two tenants");

  const globalIds = (await client.query(
    `SELECT permission_id FROM role_permissions WHERE role_id=$1 ORDER BY permission_id`,
    [pair.role_id],
  )).rows.map((row) => Number(row.permission_id));
  if (!globalIds.length) throw new Error("088 rehearsal system role has no global permissions");
  const replacementIds = [globalIds[0]];

  const tokensBeforeA = (await client.query(
    `SELECT id, token_version FROM users WHERE tenant_id=$1 AND role=$2 ORDER BY id`,
    [pair.tenant_a, pair.role_name],
  )).rows;
  const tokensBeforeB = (await client.query(
    `SELECT id, token_version FROM users WHERE tenant_id=$1 AND role=$2 ORDER BY id`,
    [pair.tenant_b, pair.role_name],
  )).rows;

  await client.query(
    `INSERT INTO tenant_role_overrides
       (tenant_id, role_id, has_permission_override, updated_by)
     VALUES ($1,$2,true,NULL)`,
    [pair.tenant_a, pair.role_id],
  );
  await client.query(
    `INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_id)
     VALUES ($1,$2,$3)`,
    [pair.tenant_a, pair.role_id, replacementIds[0]],
  );

  const tenantAIds = (await client.query(
    `SELECT permission_id FROM tenant_role_permissions
     WHERE tenant_id=$1 AND role_id=$2 ORDER BY permission_id`,
    [pair.tenant_a, pair.role_id],
  )).rows.map((row) => Number(row.permission_id));
  const tenantBOverride = Number((await client.query(
    `SELECT COUNT(*) AS value FROM tenant_role_overrides WHERE tenant_id=$1 AND role_id=$2`,
    [pair.tenant_b, pair.role_id],
  )).rows[0].value);
  const globalAfterIds = (await client.query(
    `SELECT permission_id FROM role_permissions WHERE role_id=$1 ORDER BY permission_id`,
    [pair.role_id],
  )).rows.map((row) => Number(row.permission_id));

  await client.query("SAVEPOINT duplicate_guard");
  let duplicateGuard = false;
  try {
    await client.query(
      `INSERT INTO tenant_role_overrides (tenant_id, role_id, has_permission_override)
       VALUES ($1,$2,true)`,
      [pair.tenant_a, pair.role_id],
    );
  } catch (error) {
    duplicateGuard = error.code === "23505";
    await client.query("ROLLBACK TO SAVEPOINT duplicate_guard");
  }
  await client.query("RELEASE SAVEPOINT duplicate_guard");

  const customRole = (await client.query(
    `INSERT INTO roles (name,label,is_system)
     VALUES ($1,'088 Rehearsal Custom',false) RETURNING id`,
    [`tenant_${pair.tenant_a}_migration_088_${Date.now()}`],
  )).rows[0];
  await client.query("SAVEPOINT system_only_guard");
  let systemOnlyGuard = false;
  try {
    await client.query(
      `INSERT INTO tenant_role_overrides (tenant_id, role_id, has_permission_override)
       VALUES ($1,$2,true)`,
      [pair.tenant_a, customRole.id],
    );
  } catch (error) {
    systemOnlyGuard = error.code === "23514";
    await client.query("ROLLBACK TO SAVEPOINT system_only_guard");
  }
  await client.query("RELEASE SAVEPOINT system_only_guard");
  await client.query("DELETE FROM roles WHERE id=$1", [customRole.id]);

  const tokensAfterA = (await client.query(
    `SELECT id, token_version FROM users WHERE tenant_id=$1 AND role=$2 ORDER BY id`,
    [pair.tenant_a, pair.role_name],
  )).rows;
  const tokensAfterB = (await client.query(
    `SELECT id, token_version FROM users WHERE tenant_id=$1 AND role=$2 ORDER BY id`,
    [pair.tenant_b, pair.role_name],
  )).rows;

  return {
    role: pair.role_name,
    tenant_a: pair.tenant_a,
    tenant_b: pair.tenant_b,
    tenant_a_replacement: JSON.stringify(tenantAIds) === JSON.stringify(replacementIds),
    tenant_b_has_no_override: tenantBOverride === 0,
    tenant_b_global_fallback_unchanged: JSON.stringify(globalAfterIds) === JSON.stringify(globalIds),
    duplicate_guard: duplicateGuard,
    system_only_guard: systemOnlyGuard,
    tenant_a_tokens_invalidated: tokensAfterA.every((row, index) =>
      Number(row.token_version) > Number(tokensBeforeA[index].token_version)),
    tenant_b_tokens_unchanged: JSON.stringify(tokensAfterB) === JSON.stringify(tokensBeforeB),
  };
}

async function main() {
  const rehearsal = process.argv.includes("--rollback-rehearsal");
  const confirm = process.argv.includes("--confirm-production");
  if (!rehearsal && !confirm) throw new Error("Gunakan --rollback-rehearsal atau --confirm-production");

  const host = String(process.env.DB_HOST || "");
  const railwayProduction = process.env.RAILWAY_ENVIRONMENT_NAME === "production";
  const railwayBinding = Boolean(process.env.RAILWAY_PROJECT_ID && process.env.RAILWAY_SERVICE_ID);
  if (!host || !railwayProduction || !railwayBinding) {
    throw new Error("TARGET_NOT_VERIFIED: Railway production DB marker missing");
  }

  const client = await pool.connect();
  try {
    const identity = (await client.query(
      `SELECT current_database() AS database, current_user AS db_user`,
    )).rows[0];
    const previousLatest = (await client.query(
      `SELECT filename, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 1`,
    )).rows[0] || null;
    const before = await snapshot(client);
    if (before.ledger_count) throw new Error(`ALREADY_APPLIED:${JSON.stringify(before)}`);

    await client.query("BEGIN");
    const migration = readMigration(FILENAME);
    await client.query(migration.executionSql);
    await recordMigration(client, migration);
    const checks = await schemaChecks(client);
    if (Object.values(checks).some((value) => !value)) {
      throw new Error(`SCHEMA_CHECK_FAILED:${JSON.stringify(checks)}`);
    }

    const isolation = rehearsal ? await runIsolationRehearsal(client) : null;
    if (isolation && Object.entries(isolation)
      .filter(([, value]) => typeof value === "boolean")
      .some(([, value]) => !value)) {
      throw new Error(`ISOLATION_CHECK_FAILED:${JSON.stringify(isolation)}`);
    }

    const after = await snapshot(client);
    const globalUnchanged = before.global_role_count === after.global_role_count &&
      before.global_permission_map_count === after.global_permission_map_count &&
      before.global_permission_map_hash === after.global_permission_map_hash;
    if (!globalUnchanged) throw new Error("GLOBAL_RBAC_MUTATED");

    const target = {
      host: host.replace(/^(.{0,8}).*?([^.]+\.[^.]+)$/i, "$1…$2"),
      database: identity.database,
      db_user: identity.db_user,
      previous_latest_migration: previousLatest,
    };

    if (rehearsal) {
      await client.query("ROLLBACK");
      const rollback = await snapshot(client);
      const rollbackPass = JSON.stringify(rollback) === JSON.stringify(before);
      console.log(JSON.stringify({ mode: "PRODUCTION_ROLLBACK_REHEARSAL", target, checks, isolation, global_unchanged: globalUnchanged, rollback: rollbackPass ? "PASS" : "FAIL" }, null, 2));
      if (!rollbackPass) process.exitCode = 1;
      return;
    }

    await client.query("COMMIT");
    const committed = await snapshot(client);
    console.log(JSON.stringify({ mode: "PRODUCTION_APPLY", target, migration: FILENAME, checks, global_unchanged: globalUnchanged, ledger_recorded: committed.ledger_count === 1, status: "PASS" }, null, 2));
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* best effort */ }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", reason: error.message }));
  process.exit(1);
});
