const db = require("../db");
const {
  CANONICAL_ACCOUNT_ID,
  LEGACY_ACCOUNT_ID,
  MT8_TENANT_ID,
  REVIEW_WALI_ID,
} = require("../utils/waliIdentityResolution");

async function run() {
  const client = await db.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const result = await client.query(
      `SELECT
        (SELECT COUNT(*)::int FROM wali_akun source JOIN wali_akun target
          ON target.tenant_id=source.tenant_id
         AND target.nomor_hp='0'||SUBSTRING(source.nomor_hp FROM 3)
         AND target.id<>source.id AND target.status='active'
         WHERE source.status='active' AND source.nomor_hp LIKE '62%') AS active_phone_collisions,
        (SELECT COUNT(*)::int FROM (
          SELECT DISTINCT ws.tenant_id,ws.nomor_hp FROM wali_santri ws
          JOIN tenants t ON t.id=ws.tenant_id AND t.status='active'
          JOIN santri s ON s.id=ws.santri_id AND s.tenant_id=ws.tenant_id
          LEFT JOIN wali_akun wa ON wa.tenant_id=ws.tenant_id
            AND wa.nomor_hp=ws.nomor_hp AND wa.status='active'
          WHERE LOWER(TRIM(COALESCE(s.status,'')))='aktif'
            AND ws.nomor_hp IS NOT NULL AND TRIM(ws.nomor_hp)<>'' AND wa.id IS NULL
        ) missing) AS production_wali_without_account,
        (SELECT status FROM wali_akun WHERE id=$1) AS canonical_account_status,
        (SELECT status FROM wali_akun WHERE id=$2) AS legacy_account_status,
        (SELECT status FROM tenants WHERE id=$3) AS mt8_tenant_status,
        (SELECT COUNT(*)::int FROM wali_santri WHERE id=$4 AND tenant_id=$3) AS mt8_wali_retained,
        (SELECT COUNT(*)::int FROM wali_akun WHERE tenant_id=$3) AS mt8_login_accounts,
        (SELECT COUNT(*)::int FROM santri WHERE tenant_id=$3 AND LOWER(TRIM(status))<>'nonaktif') AS mt8_nonarchived_santri,
        (SELECT COUNT(*)::int FROM guru WHERE tenant_id=$3 AND LOWER(TRIM(status))<>'nonaktif') AS mt8_nonarchived_guru,
        (SELECT COUNT(*)::int FROM users WHERE tenant_id=$3 AND LOWER(TRIM(status))<>'nonaktif') AS mt8_nonarchived_users,
        (SELECT COUNT(*)::int FROM unit_pendidikan WHERE tenant_id=$3 AND is_active=true) AS mt8_active_units`,
      [CANONICAL_ACCOUNT_ID, LEGACY_ACCOUNT_ID, MT8_TENANT_ID, REVIEW_WALI_ID],
    );
    await client.query("ROLLBACK");
    const checks = result.rows[0];
    const mt8Archived = checks.mt8_tenant_status === "inactive"
      && checks.mt8_wali_retained === 1
      && checks.mt8_login_accounts === 0
      && checks.mt8_nonarchived_santri === 0
      && checks.mt8_nonarchived_guru === 0
      && checks.mt8_nonarchived_users === 0
      && checks.mt8_active_units === 0;
    const mt8NotPresent = checks.mt8_tenant_status == null
      && checks.mt8_wali_retained === 0
      && checks.mt8_login_accounts === 0
      && checks.mt8_nonarchived_santri === 0
      && checks.mt8_nonarchived_guru === 0
      && checks.mt8_nonarchived_users === 0
      && checks.mt8_active_units === 0;
    const pass = checks.active_phone_collisions === 0
      && checks.production_wali_without_account === 0
      && checks.canonical_account_status === "active"
      && checks.legacy_account_status === "inactive"
      && (mt8Archived || mt8NotPresent);
    console.log(JSON.stringify({
      marker: "wali-identity-resolution-audit",
      mode: "READ_ONLY",
      status: pass ? "PASS" : "BLOCKED",
      mt8_resolution: mt8Archived ? "LOGICALLY_ARCHIVED" : mt8NotPresent ? "NOT_PRESENT" : "UNRESOLVED",
      checks,
    }, null, 2));
    if (!pass) process.exitCode = 1;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* best effort */ }
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

run().catch((error) => {
  console.error(`[wali-identity-resolution-audit-error] ${error.message}`);
  process.exitCode = 1;
});
