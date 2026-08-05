const db = require("../db");
const {
  CANONICAL_ACCOUNT_ID,
  EXPECTED_TENANT_ID,
  LEGACY_ACCOUNT_ID,
  MT8_TENANT_ID,
  REVIEW_WALI_ID,
  canonicalPhone,
  evaluateResolutionState,
  loadResolutionState,
} = require("../utils/waliIdentityResolution");

async function run() {
  const client = await db.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const target = await client.query(
      `SELECT current_database() AS database,inet_server_addr()::text AS host,
              t.id AS tenant_id,t.nama AS tenant_name,t.slug AS tenant_slug
       FROM tenants t WHERE t.id=$1`,
      [EXPECTED_TENANT_ID],
    );
    const state = await loadResolutionState(client);
    const evaluation = evaluateResolutionState(state);
    await client.query("ROLLBACK");

    console.log(JSON.stringify({
      marker: "wali-identity-resolution-plan",
      mode: "READ_ONLY_DRY_RUN",
      status: evaluation.ready ? "READY_FOR_CONTROLLED_DATA_FIX" : "BLOCKED_ASSUMPTION_CHANGED",
      target: target.rows[0] || { tenant_id: EXPECTED_TENANT_ID },
      accounts: {
        retain: {
          id: CANONICAL_ACCOUNT_ID,
          status: state.canonical?.status || null,
          canonical_phone: state.canonical?.nomor_hp || null,
          santri_relation_count: state.canonicalRelations.length,
        },
        archive: {
          id: LEGACY_ACCOUNT_ID,
          current_status: state.legacy?.status || null,
          resulting_status: "inactive",
          original_phone: state.legacy?.nomor_hp || null,
          canonical_phone: canonicalPhone(state.legacy?.nomor_hp),
          santri_relation_count: state.legacyRelations.length,
          new_audit_activity_count: state.legacyAuditAfterCreation,
        },
      },
      actions: [
        "Set wali_akun ID 3 status menjadi inactive (logical archive)",
        "Biarkan wali_akun ID 1 tetap active",
        "Tidak memindahkan relasi santri",
        "Tidak menggabungkan PIN, credential, session, token, atau audit",
        `Arsipkan tenant smoke-test ID ${MT8_TENANT_ID} dan record anak melalui status yang tersedia`,
        `Wali ID ${REVIEW_WALI_ID} diwariskan sebagai archived dari tenant smoke-test; tidak membuat akun`,
      ],
      review_required: state.reviewWali ? {
        wali_id: state.reviewWali.wali_id,
        tenant_id: state.reviewWali.tenant_id,
        tenant_name: state.reviewWali.tenant_name,
        santri_count: state.reviewWali.santri_count,
        phone: state.reviewWali.nomor_hp,
        status: "CONFIRMED_SMOKE_TEST_PENDING_ARCHIVE",
      } : { wali_id: REVIEW_WALI_ID, status: "ASSUMPTION_CHANGED" },
      assumptions: evaluation.assumptions,
      writes_executed: false,
    }, null, 2));
    if (!evaluation.ready) process.exitCode = 1;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* best effort */ }
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

run().catch((error) => {
  console.error(`[wali-identity-resolution-plan-error] ${error.message}`);
  process.exitCode = 1;
});
