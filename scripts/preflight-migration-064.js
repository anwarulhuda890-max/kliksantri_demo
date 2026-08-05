const db = require("../db");

const CHECKS = [
  {
    name: "duplicate_canonical_unit_codes_per_tenant",
    blocking: true,
    sql: `SELECT COUNT(*)::int AS count FROM (
      SELECT tenant_id,
             CASE WHEN UPPER(TRIM(kode)) = 'MADINAH' THEN 'MADIN' ELSE UPPER(TRIM(kode)) END
      FROM unit_pendidikan
      GROUP BY tenant_id,
               CASE WHEN UPPER(TRIM(kode)) = 'MADINAH' THEN 'MADIN' ELSE UPPER(TRIM(kode)) END
      HAVING COUNT(*) > 1
    ) duplicate_codes`,
  },
  {
    name: "madin_madinah_conflicts",
    blocking: true,
    sql: `SELECT COUNT(*)::int AS count FROM (
      SELECT tenant_id
      FROM unit_pendidikan
      WHERE UPPER(TRIM(kode)) IN ('MADIN', 'MADINAH')
      GROUP BY tenant_id
      HAVING COUNT(DISTINCT UPPER(TRIM(kode))) > 1
    ) conflicts`,
  },
  {
    name: "kelas_cross_tenant_unit",
    blocking: true,
    sql: `SELECT COUNT(*)::int AS count
      FROM kelas k JOIN unit_pendidikan u ON u.id = k.unit_id
      WHERE k.tenant_id IS DISTINCT FROM u.tenant_id`,
  },
  {
    name: "guru_cross_tenant_unit",
    blocking: true,
    sql: `SELECT COUNT(*)::int AS count
      FROM guru g JOIN unit_pendidikan u ON u.id = g.unit_id
      WHERE g.tenant_id IS DISTINCT FROM u.tenant_id`,
  },
  {
    name: "user_unit_scope_cross_tenant",
    blocking: true,
    sql: `SELECT COUNT(*)::int AS count
      FROM user_unit_scope s
      JOIN users usr ON usr.id = s.user_id
      JOIN unit_pendidikan u ON u.id = s.unit_id
      WHERE usr.tenant_id IS DISTINCT FROM u.tenant_id`,
  },
  {
    name: "santri_kelas_cross_tenant",
    blocking: true,
    sql: `SELECT COUNT(*)::int AS count
      FROM santri s JOIN kelas k ON k.id = s.kelas_id
      WHERE s.tenant_id IS DISTINCT FROM k.tenant_id`,
  },
  {
    name: "unit_invalid_tenant",
    blocking: true,
    sql: `SELECT COUNT(*)::int AS count
      FROM unit_pendidikan u LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.tenant_id IS NULL OR t.id IS NULL`,
  },
  {
    name: "orphan_kelas_unit",
    blocking: true,
    sql: `SELECT COUNT(*)::int AS count
      FROM kelas k LEFT JOIN unit_pendidikan u ON u.id = k.unit_id
      WHERE u.id IS NULL`,
  },
  {
    name: "orphan_guru_unit",
    blocking: true,
    sql: `SELECT COUNT(*)::int AS count
      FROM guru g LEFT JOIN unit_pendidikan u ON u.id = g.unit_id
      WHERE u.id IS NULL`,
  },
  {
    name: "orphan_user_unit_scope",
    blocking: true,
    sql: `SELECT COUNT(*)::int AS count
      FROM user_unit_scope s
      LEFT JOIN users usr ON usr.id = s.user_id
      LEFT JOIN unit_pendidikan u ON u.id = s.unit_id
      WHERE usr.id IS NULL OR u.id IS NULL`,
  },
  {
    name: "orphan_santri_kelas",
    blocking: true,
    sql: `SELECT COUNT(*)::int AS count
      FROM santri s LEFT JOIN kelas k ON k.id = s.kelas_id
      WHERE s.kelas_id IS NOT NULL AND k.id IS NULL`,
  },
  {
    name: "invalid_central_role_tenant",
    blocking: true,
    sql: `SELECT COUNT(*)::int AS count FROM users
      WHERE (role = 'platform_superadmin' AND tenant_id IS NOT NULL)
         OR (role IN ('superadmin', 'pimpinan_yayasan') AND tenant_id IS NULL)`,
  },
];

async function hasColumn(client, table, column) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
     ) AS present`,
    [table, column],
  );
  return result.rows[0].present;
}

async function run() {
  const client = await db.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const results = [];

    for (const check of CHECKS) {
      const result = await client.query(check.sql);
      results.push({ name: check.name, count: Number(result.rows[0].count), blocking: check.blocking });
    }

    const scopeHasStatus = await hasColumn(client, "user_unit_scope", "status");
    const duplicateScopes = await client.query(`SELECT COUNT(*)::int AS count FROM (
      SELECT user_id, unit_id
      FROM user_unit_scope
      ${scopeHasStatus ? "WHERE status = 'active'" : ""}
      GROUP BY user_id, unit_id
      HAVING COUNT(*) > 1
    ) duplicates`);
    results.push({
      name: "duplicate_active_user_unit_scope",
      count: Number(duplicateScopes.rows[0].count),
      blocking: true,
      evidence: scopeHasStatus ? "status column present" : "pre-064 schema; every scope treated as active",
    });

    const counts = await client.query(`SELECT
      (SELECT COUNT(*)::int FROM tenants) AS tenants,
      (SELECT COUNT(*)::int FROM unit_pendidikan) AS units,
      (SELECT COUNT(*)::int FROM santri) AS santri,
      (SELECT COUNT(*)::int FROM kelas) AS kelas,
      (SELECT COUNT(*)::int FROM guru) AS guru,
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM user_unit_scope) AS user_unit_scopes`);
    await client.query("ROLLBACK");

    const blockers = results.filter((item) => item.blocking && item.count > 0);
    console.log(JSON.stringify({
      marker: "migration-064-preflight",
      mode: "READ_ONLY",
      status: blockers.length ? "BLOCKED" : "PASS",
      row_counts: counts.rows[0],
      checks: results,
      blocker_count: blockers.length,
    }, null, 2));
    if (blockers.length) process.exitCode = 1;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* best effort only */ }
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

run().catch((error) => {
  console.error(`[migration-064-preflight-error] ${error.message}`);
  process.exitCode = 1;
});
