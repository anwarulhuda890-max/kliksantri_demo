const pool = require("../db");

async function scalar(client, sql) {
  return Number((await client.query(sql)).rows[0]?.value || 0);
}

async function hasColumn(client, table, column) {
  return Boolean((await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1 AND column_name=$2
     ) AS value`,
    [table, column],
  )).rows[0]?.value);
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const hasUnitId = await hasColumn(client, "absensi", "unit_id");
    const before = {
      row_count: await scalar(client, "SELECT COUNT(*) value FROM absensi"),
      distinct_session_labels: await scalar(client, "SELECT COUNT(DISTINCT sesi) value FROM absensi"),
      blank_session_labels: await scalar(client, "SELECT COUNT(*) value FROM absensi WHERE NULLIF(BTRIM(sesi),'') IS NULL"),
      duplicate_legacy_key: await scalar(client, `SELECT COUNT(*) value FROM (
        SELECT santri_id,tanggal,sesi FROM absensi GROUP BY 1,2,3 HAVING COUNT(*)>1
      ) d`),
      orphan_or_cross_tenant_student: await scalar(client, `SELECT COUNT(*) value
        FROM absensi a LEFT JOIN santri s ON s.id=a.santri_id AND s.tenant_id=a.tenant_id
        WHERE s.id IS NULL`),
    };

    const ownership = hasUnitId
      ? (await client.query(`SELECT a.tenant_id,a.unit_id,u.nama AS unit_name,
            COUNT(*)::int row_count,ARRAY_AGG(DISTINCT a.sesi ORDER BY a.sesi) sessions
          FROM absensi a
          LEFT JOIN unit_pendidikan u ON u.tenant_id=a.tenant_id AND u.id=a.unit_id
          GROUP BY a.tenant_id,a.unit_id,u.nama ORDER BY a.tenant_id,a.unit_id`)).rows
      : (await client.query(`SELECT a.tenant_id,k.unit_id,u.nama AS unit_name,
            COUNT(*)::int row_count,ARRAY_AGG(DISTINCT a.sesi ORDER BY a.sesi) sessions
          FROM absensi a
          JOIN santri s ON s.id=a.santri_id AND s.tenant_id=a.tenant_id
          LEFT JOIN kelas k ON k.id=s.kelas_id AND k.tenant_id=s.tenant_id
          LEFT JOIN unit_pendidikan u ON u.tenant_id=k.tenant_id AND u.id=k.unit_id
          GROUP BY a.tenant_id,k.unit_id,u.nama ORDER BY a.tenant_id,k.unit_id`)).rows;

    const manualConfigurationUnits = hasUnitId
      ? (await client.query(`SELECT u.tenant_id,u.id AS unit_id,u.nama
          FROM unit_pendidikan u
          WHERE u.is_active=true AND NOT EXISTS (
            SELECT 1 FROM absensi a WHERE a.tenant_id=u.tenant_id AND a.unit_id=u.id
          ) ORDER BY u.tenant_id,u.sort_order,u.id`)).rows
      : (await client.query(`SELECT u.tenant_id,u.id AS unit_id,u.nama
          FROM unit_pendidikan u
          WHERE u.is_active=true AND NOT EXISTS (
            SELECT 1 FROM absensi a
            JOIN santri s ON s.id=a.santri_id AND s.tenant_id=a.tenant_id
            JOIN kelas k ON k.id=s.kelas_id AND k.tenant_id=s.tenant_id
            WHERE a.tenant_id=u.tenant_id AND k.unit_id=u.id
          ) ORDER BY u.tenant_id,u.sort_order,u.id`)).rows;

    const blockers = [];
    if (before.blank_session_labels) blockers.push("blank_session_labels");
    if (before.duplicate_legacy_key) blockers.push("duplicate_legacy_key");
    if (before.orphan_or_cross_tenant_student) blockers.push("orphan_or_cross_tenant_student");
    if (ownership.some((row) => row.unit_id == null)) blockers.push("attendance_without_deterministic_unit");

    console.log(JSON.stringify({
      marker: "attendance-session-migration-083-preflight",
      mode: "READ_ONLY",
      schema_phase: hasUnitId ? "POST_072" : "PRE_072_WITH_DETERMINISTIC_UNIT_EVIDENCE",
      before,
      ownership,
      expected_backfill_session_count: ownership.reduce((sum, row) => sum + row.sessions.length, 0),
      manual_configuration_units: manualConfigurationUnits,
      blockers,
      status: blockers.length ? "BLOCKED" : "READY_FOR_CLONE_REHEARSAL",
    }, null, 2));
    await client.query("ROLLBACK");
    if (blockers.length) process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", reason: error.message }));
  process.exit(1);
});
