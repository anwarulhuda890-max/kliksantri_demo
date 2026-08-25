const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { Client } = require("pg");
const { readMigration, recordMigration } = require("../utils/migrationLedger");

const ROOT = path.join(__dirname, "..");
const FILENAME = "083_attendance_sessions_per_unit.sql";

function parseEnv(name) {
  return dotenv.parse(fs.readFileSync(path.join(ROOT, name)));
}

function endpointMatches(host, endpointId) {
  return host.startsWith(`${endpointId}.`) || host.startsWith(`${endpointId}-pooler.`);
}

function rehearsalConnectionString() {
  const rehearsal = parseEnv(".env.rehearsal");
  const production = parseEnv(".env.production.local");
  const rehearsalUrl = new URL(rehearsal.DATABASE_URL);
  const productionUrl = new URL(production.DATABASE_URL);
  const rehearsalId = String(rehearsal.EXPECTED_REHEARSAL_ENDPOINT_ID || "").toLowerCase();
  const productionId = String(production.EXPECTED_PRODUCTION_ENDPOINT_ID || "").toLowerCase();
  if (!rehearsalId || !productionId ||
      !endpointMatches(rehearsalUrl.hostname.toLowerCase(), rehearsalId) ||
      !endpointMatches(productionUrl.hostname.toLowerCase(), productionId)) {
    throw new Error("ENDPOINT_GUARD_FAILED");
  }
  if (rehearsalUrl.hostname === productionUrl.hostname || endpointMatches(rehearsalUrl.hostname.toLowerCase(), productionId)) {
    throw new Error("PRODUCTION_COLLISION");
  }
  return rehearsal.DATABASE_URL;
}

async function scalar(client, sql, params = []) {
  return Number((await client.query(sql, params)).rows[0]?.value || 0);
}

async function legacyHash(client) {
  return (await client.query(`SELECT MD5(COALESCE(STRING_AGG(ROW_TO_JSON(row_data)::text, '|' ORDER BY id), '')) value
    FROM (
      SELECT id,santri_id,tanggal,status,sesi,tenant_id,unit_id,santri_unit_id,
             enrollment_id,kelas_id,actor_user_id,source
      FROM absensi ORDER BY id
    ) row_data`)).rows[0].value;
}

async function snapshot(client) {
  const hasSessions = (await client.query("SELECT to_regclass('public.attendance_sessions') IS NOT NULL value")).rows[0].value;
  return {
    attendance_rows: await scalar(client, "SELECT COUNT(*) value FROM absensi"),
    attendance_legacy_hash: await legacyHash(client),
    configured_sessions: hasSessions ? await scalar(client, "SELECT COUNT(*) value FROM attendance_sessions") : 0,
    ledger_083: await scalar(client, "SELECT COUNT(*) value FROM schema_migrations WHERE filename=$1", [FILENAME]),
    session_table: hasSessions,
  };
}

async function main() {
  const client = new Client({ connectionString: rehearsalConnectionString(), ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const baseline = (await client.query(`SELECT
      EXISTS(SELECT 1 FROM schema_migrations WHERE filename='072_academic_multi_unit.sql') migration_072,
      EXISTS(SELECT 1 FROM schema_migrations WHERE filename=$1) migration_083,
      to_regclass('public.attendance_sessions') IS NOT NULL session_table,
      EXISTS(SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='absensi' AND column_name='unit_id') absensi_unit`, [FILENAME])).rows[0];
    if (!baseline.migration_072 || baseline.migration_083 || baseline.session_table || !baseline.absensi_unit) {
      throw new Error(`BASELINE_NOT_CURRENT:${JSON.stringify(baseline)}`);
    }

    const before = await snapshot(client);
    const expectedHistoricalSessions = await scalar(client, `SELECT COUNT(*) value FROM (
      SELECT DISTINCT tenant_id,unit_id,BTRIM(sesi) FROM absensi
      WHERE unit_id IS NOT NULL AND NULLIF(BTRIM(sesi),'') IS NOT NULL
    ) configured`);

    const migration = readMigration(FILENAME);
    await client.query("BEGIN");
    await client.query(migration.executionSql);
    await recordMigration(client, migration);
    const after = await snapshot(client);

    const safetyChecks = {
      row_count_preserved: after.attendance_rows === before.attendance_rows,
      legacy_hash_preserved: after.attendance_legacy_hash === before.attendance_legacy_hash,
      deterministic_session_count: after.configured_sessions === expectedHistoricalSessions,
      all_unit_rows_mapped: await scalar(client, `SELECT COUNT(*) value FROM absensi
        WHERE unit_id IS NOT NULL AND (session_id IS NULL OR NULLIF(BTRIM(session_name_snapshot),'') IS NULL)`) === 0,
      no_duplicate: await scalar(client, `SELECT COUNT(*) value FROM (
        SELECT tenant_id,unit_id,santri_id,tanggal,session_id
        FROM absensi WHERE session_id IS NOT NULL GROUP BY 1,2,3,4,5 HAVING COUNT(*)>1
      ) duplicate_rows`) === 0,
      no_cross_unit_reassignment: await scalar(client, `SELECT COUNT(*) value FROM absensi a
        JOIN attendance_sessions configured ON configured.id=a.session_id AND configured.tenant_id=a.tenant_id
        WHERE configured.unit_id<>a.unit_id`) === 0,
      snapshot_preserved: await scalar(client, `SELECT COUNT(*) value FROM absensi
        WHERE unit_id IS NOT NULL AND session_name_snapshot IS DISTINCT FROM BTRIM(sesi)`) === 0,
      ledger_recorded: after.ledger_083 === 1,
    };

    const availableUnits = (await client.query(`SELECT u.tenant_id,u.id
      FROM unit_pendidikan u
      WHERE u.is_active=true AND NOT EXISTS (
        SELECT 1 FROM attendance_sessions configured
        WHERE configured.tenant_id=u.tenant_id AND configured.unit_id=u.id
      ) ORDER BY u.tenant_id,u.sort_order,u.id LIMIT 2`)).rows;
    if (availableUnits.length < 2) throw new Error("REPRESENTATIVE_UNITS_UNAVAILABLE");
    const [randomUnit, independentUnit] = availableUnits;
    for (const [index, name] of ["Session A", "Session B", "Session C"].entries()) {
      await client.query(`INSERT INTO attendance_sessions
        (tenant_id,unit_id,code,display_name,sort_order) VALUES ($1,$2,$3,$4,$5)`,
      [randomUnit.tenant_id, randomUnit.id, `runtime-${index}`, name, (index + 1) * 10]);
    }
    await client.query(`INSERT INTO attendance_sessions
      (tenant_id,unit_id,code,display_name,sort_order) VALUES ($1,$2,'independent','Independent Session',10)`,
    [independentUnit.tenant_id, independentUnit.id]);
    await client.query(`UPDATE attendance_sessions SET display_name='Session B Renamed'
      WHERE tenant_id=$1 AND unit_id=$2 AND code='runtime-1'`, [randomUnit.tenant_id, randomUnit.id]);
    await client.query(`UPDATE attendance_sessions SET active=false
      WHERE tenant_id=$1 AND unit_id=$2 AND code='runtime-2'`, [randomUnit.tenant_id, randomUnit.id]);

    const runtimeChecks = {
      arbitrary_three_created: await scalar(client, "SELECT COUNT(*) value FROM attendance_sessions WHERE tenant_id=$1 AND unit_id=$2", [randomUnit.tenant_id, randomUnit.id]) === 3,
      rename_visible: await scalar(client, "SELECT COUNT(*) value FROM attendance_sessions WHERE tenant_id=$1 AND unit_id=$2 AND display_name='Session B Renamed'", [randomUnit.tenant_id, randomUnit.id]) === 1,
      disable_leaves_two_active: await scalar(client, "SELECT COUNT(*) value FROM attendance_sessions WHERE tenant_id=$1 AND unit_id=$2 AND active=true", [randomUnit.tenant_id, randomUnit.id]) === 2,
      other_unit_independent: await scalar(client, "SELECT COUNT(*) value FROM attendance_sessions WHERE tenant_id=$1 AND unit_id=$2", [independentUnit.tenant_id, independentUnit.id]) === 1,
    };

    if ([...Object.values(safetyChecks), ...Object.values(runtimeChecks)].some((value) => !value)) {
      throw new Error(`REHEARSAL_CHECK_FAILED:${JSON.stringify({ safetyChecks, runtimeChecks })}`);
    }
    await client.query("ROLLBACK");
    const rollback = await snapshot(client);
    const rollbackPass = !rollback.session_table && rollback.ledger_083 === 0 &&
      rollback.attendance_rows === before.attendance_rows && rollback.attendance_legacy_hash === before.attendance_legacy_hash;
    console.log(JSON.stringify({ baseline: "PASS", rehearsal: "PASS", before, after, safety_checks: safetyChecks, universal_runtime: runtimeChecks, rollback: rollbackPass ? "PASS" : "FAIL" }, null, 2));
    if (!rollbackPass) process.exitCode = 1;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", reason: error.message }));
  process.exit(1);
});
