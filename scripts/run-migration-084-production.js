const pool = require("../db");
const { readMigration, recordMigration } = require("../utils/migrationLedger");

const FILENAME = "084_alumni_unit_scope.sql";

async function scalar(client, sql, params = []) {
  return Number((await client.query(sql, params)).rows[0]?.value || 0);
}

async function alumniHash(client) {
  return (await client.query(`SELECT MD5(COALESCE(STRING_AGG(ROW_TO_JSON(snapshot)::text, '|' ORDER BY id), '')) AS value
    FROM (SELECT * FROM alumni ORDER BY id) snapshot`)).rows[0].value;
}

async function snapshot(client) {
  const relationExists = (await client.query(`SELECT to_regclass('public.alumni_units') IS NOT NULL AS value`)).rows[0].value;
  return {
    alumni_rows: await scalar(client, `SELECT COUNT(1) AS value FROM alumni`),
    alumni_hash: await alumniHash(client),
    alumni_units_rows: relationExists ? await scalar(client, `SELECT COUNT(1) AS value FROM alumni_units`) : 0,
    relation_exists: relationExists,
    ledger_084: await scalar(client, `SELECT COUNT(1) AS value FROM schema_migrations WHERE filename=$1`, [FILENAME]),
  };
}

async function verify(client, before) {
  const after = await snapshot(client);
  const checks = {
    alumni_rows_preserved: after.alumni_rows === before.alumni_rows,
    alumni_snapshot_preserved: after.alumni_hash === before.alumni_hash,
    relation_created: after.relation_exists,
    no_orphan_or_cross_tenant: await scalar(client, `SELECT COUNT(1) AS value
      FROM alumni_units au
      LEFT JOIN alumni a ON a.tenant_id=au.tenant_id AND a.id=au.alumni_id
      LEFT JOIN unit_pendidikan u ON u.tenant_id=au.tenant_id AND u.id=au.unit_id
      WHERE a.id IS NULL OR u.id IS NULL`) === 0,
    no_duplicate_history: await scalar(client, `SELECT COUNT(1) AS value FROM (
      SELECT tenant_id,alumni_id,unit_id,COALESCE(tahun_lulus,0)
      FROM alumni_units GROUP BY 1,2,3,4 HAVING COUNT(1)>1
    ) duplicate_history`) === 0,
    linked_evidence_scoped: await scalar(client, `SELECT COUNT(1) AS value
      FROM alumni a
      WHERE a.santri_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM santri_units su WHERE su.tenant_id=a.tenant_id AND su.santri_id=a.santri_id)
        AND NOT EXISTS (SELECT 1 FROM alumni_units au WHERE au.tenant_id=a.tenant_id AND au.alumni_id=a.id)`) === 0,
    ledger_recorded: after.ledger_084 === 1,
  };
  return { after, checks };
}

async function main() {
  const rollbackRehearsal = process.argv.includes("--rollback-rehearsal");
  const confirm = process.argv.includes("--confirm-production");
  if (!rollbackRehearsal && !confirm) throw new Error("Gunakan --rollback-rehearsal atau --confirm-production");
  const client = await pool.connect();
  try {
    const before = await snapshot(client);
    if (before.relation_exists || before.ledger_084) throw new Error(`BASELINE_NOT_CURRENT:${JSON.stringify(before)}`);
    await client.query("BEGIN");
    const migration = readMigration(FILENAME);
    await client.query(migration.executionSql);
    await recordMigration(client, migration);
    const verification = await verify(client, before);
    if (Object.values(verification.checks).some((value) => !value)) {
      throw new Error(`PRODUCTION_CHECK_FAILED:${JSON.stringify(verification.checks)}`);
    }
    if (rollbackRehearsal) {
      await client.query("ROLLBACK");
      const rollback = await snapshot(client);
      const rollbackPass = !rollback.relation_exists && rollback.ledger_084 === 0 &&
        rollback.alumni_rows === before.alumni_rows && rollback.alumni_hash === before.alumni_hash;
      console.log(JSON.stringify({ mode: "PRODUCTION_ROLLBACK_REHEARSAL", before, ...verification, rollback: rollbackPass ? "PASS" : "FAIL" }, null, 2));
      if (!rollbackPass) process.exitCode = 1;
      return;
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ mode: "PRODUCTION_APPLY", migration: FILENAME, before, ...verification, status: "PASS" }, null, 2));
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
