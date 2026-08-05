const db = require("../db");
const {
  CANONICAL_ACCOUNT_ID,
  EXPECTED_TENANT_ID,
  LEGACY_ACCOUNT_ID,
  MT8_PREFIX,
  MT8_TENANT_ID,
  evaluateResolutionState,
  loadResolutionState,
} = require("../utils/waliIdentityResolution");

const CONFIRM_FLAG = "--confirm-wali-identity-resolution";

async function run() {
  if (!process.argv.includes(CONFIRM_FLAG)) {
    throw new Error(`Write ditolak: flag ${CONFIRM_FLAG} wajib`);
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query("SET LOCAL lock_timeout='5s'");
    await client.query("SET LOCAL statement_timeout='30s'");
    await client.query("LOCK TABLE tenants,wali_akun,wali_santri,wali_app_audit,santri,guru,kelas,users,unit_pendidikan IN SHARE ROW EXCLUSIVE MODE");

    const target = await client.query(
      `SELECT current_database() AS database,inet_server_addr()::text AS host,
              t.id AS tenant_id,t.nama AS tenant_name,t.slug AS tenant_slug
       FROM tenants t WHERE t.id=$1`,
      [EXPECTED_TENANT_ID],
    );
    console.log("[wali-identity-resolution-target]", {
      ...(target.rows[0] || { tenant_id: EXPECTED_TENANT_ID }),
      retainAccountId: CANONICAL_ACCOUNT_ID,
      archiveAccountId: LEGACY_ACCOUNT_ID,
      archiveSmokeTenantId: MT8_TENANT_ID,
    });

    const state = await loadResolutionState(client, { lockAccounts: true });
    const evaluation = evaluateResolutionState(state);
    const failed = evaluation.assumptions.filter((item) => !item.ok);
    if (failed.length) {
      throw new Error(`Asumsi berubah; write dibatalkan: ${failed.map((item) => item.key).join(", ")}`);
    }

    const updated = await client.query(
      `UPDATE wali_akun SET status='inactive',updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND status='active' AND last_login IS NULL
       RETURNING id,tenant_id,status`,
      [LEGACY_ACCOUNT_ID, EXPECTED_TENANT_ID],
    );
    if (updated.rowCount !== 1) throw new Error("Update akun legacy tidak tepat satu baris");

    const archivedTenant = await client.query(
      `UPDATE tenants SET status='inactive',updated_at=NOW()
       WHERE id=$1 AND slug='al-hikmah' AND status='active'
       RETURNING id,status`,
      [MT8_TENANT_ID],
    );
    if (archivedTenant.rowCount !== 1) throw new Error("Archive tenant MT8 tidak tepat satu baris");

    const archivedSantri = await client.query(
      `UPDATE santri SET status='Nonaktif'
       WHERE tenant_id=$1 AND nama LIKE $2 AND LOWER(TRIM(status))='aktif'`,
      [MT8_TENANT_ID, `${MT8_PREFIX}%`],
    );
    if (archivedSantri.rowCount !== 3) throw new Error("Archive santri MT8 tidak tepat tiga baris");

    const archivedGuru = await client.query(
      `UPDATE guru SET status='Nonaktif'
       WHERE tenant_id=$1 AND nama LIKE $2 AND LOWER(TRIM(status))='aktif'`,
      [MT8_TENANT_ID, `${MT8_PREFIX}%`],
    );
    if (archivedGuru.rowCount !== 1) throw new Error("Archive guru MT8 tidak tepat satu baris");

    const archivedUsers = await client.query(
      `UPDATE users SET status='Nonaktif'
       WHERE tenant_id=$1 AND status='Aktif'`,
      [MT8_TENANT_ID],
    );
    if (archivedUsers.rowCount !== 1) throw new Error("Archive admin MT8 tidak tepat satu baris");

    const archivedUnits = await client.query(
      `UPDATE unit_pendidikan SET is_active=false
       WHERE tenant_id=$1 AND is_active=true`,
      [MT8_TENANT_ID],
    );
    if (archivedUnits.rowCount !== 8) throw new Error("Archive unit MT8 tidak tepat delapan baris");

    await client.query(
      `INSERT INTO audit_logs(device_id,event_type,detail,tenant_id)
       VALUES($1,$2,$3,$4)`,
      [
        "maintenance:wali-identity-resolution",
        "wali.identity.legacy_archived",
        JSON.stringify({
          legacy_account_id: LEGACY_ACCOUNT_ID,
          retained_account_id: CANONICAL_ACCOUNT_ID,
          action: "status_active_to_inactive",
          moved_santri_relations: 0,
          merged_credentials: false,
        }),
        EXPECTED_TENANT_ID,
      ],
    );

    await client.query(
      `INSERT INTO audit_logs(device_id,event_type,detail,tenant_id)
       VALUES($1,$2,$3,$4)`,
      [
        "maintenance:wali-identity-resolution",
        "smoke_test.mt8.logical_archive",
        JSON.stringify({
          smoke_tenant_id: MT8_TENANT_ID,
          wali_id: 26,
          hard_delete: false,
          archived_santri: archivedSantri.rowCount,
          archived_guru: archivedGuru.rowCount,
          archived_users: archivedUsers.rowCount,
          archived_units: archivedUnits.rowCount,
          inherited_archive_tables: ["wali_santri", "kelas", "profil_pesantren", "tenant_features"],
        }),
        MT8_TENANT_ID,
      ],
    );

    await client.query("COMMIT");
    console.log("Wali identity resolution selesai: akun legacy dan tenant MT8 diarsipkan logis; tidak ada record dihapus.");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* best effort */ }
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`[wali-identity-resolution-apply-error] ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { CONFIRM_FLAG, run };
