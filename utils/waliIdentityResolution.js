const LEGACY_ACCOUNT_ID = 3;
const CANONICAL_ACCOUNT_ID = 1;
const EXPECTED_TENANT_ID = 1;
const REVIEW_WALI_ID = 26;
const MT8_TENANT_ID = 37;
const MT8_TENANT_SLUG = "al-hikmah";
const MT8_PREFIX = "MT8-HIKMAH";

function canonicalPhone(value) {
  const phone = String(value || "").trim();
  return phone.startsWith("62") ? `0${phone.slice(2)}` : phone;
}

async function loadResolutionState(client, { lockAccounts = false } = {}) {
  const accounts = await client.query(
    `SELECT id,tenant_id,nama,nomor_hp,status,last_login,created_at,updated_at
     FROM wali_akun WHERE id = ANY($1::int[]) ORDER BY id
     ${lockAccounts ? "FOR UPDATE" : ""}`,
    [[CANONICAL_ACCOUNT_ID, LEGACY_ACCOUNT_ID]],
  );
  const byId = new Map(accounts.rows.map((row) => [Number(row.id), row]));
  const legacy = byId.get(LEGACY_ACCOUNT_ID) || null;
  const canonical = byId.get(CANONICAL_ACCOUNT_ID) || null;

  const legacyRelations = await client.query(
    `SELECT ws.id AS wali_id,ws.santri_id
     FROM wali_santri ws
     WHERE ws.tenant_id=$1 AND ws.nomor_hp=$2
     ORDER BY ws.id`,
    [EXPECTED_TENANT_ID, legacy?.nomor_hp || ""],
  );
  const canonicalRelations = await client.query(
    `SELECT ws.id AS wali_id,ws.santri_id
     FROM wali_santri ws
     WHERE ws.tenant_id=$1 AND ws.nomor_hp=$2
     ORDER BY ws.id`,
    [EXPECTED_TENANT_ID, canonical?.nomor_hp || ""],
  );
  const legacyAuditAfterCreation = legacy
    ? await client.query(
      `SELECT COUNT(*)::int AS count FROM wali_app_audit
       WHERE nomor_hp=$1 AND created_at >= $2`,
      [legacy.nomor_hp, legacy.created_at],
    )
    : { rows: [{ count: 0 }] };

  const reviewWali = await client.query(
    `SELECT ws.id AS wali_id,ws.tenant_id,ws.nama,ws.nomor_hp,t.nama AS tenant_name,
            COUNT(DISTINCT ws.santri_id)::int AS santri_count,
            EXISTS(SELECT 1 FROM wali_akun wa
                   WHERE wa.tenant_id=ws.tenant_id AND wa.nomor_hp=ws.nomor_hp) AS has_exact_account
     FROM wali_santri ws JOIN tenants t ON t.id=ws.tenant_id
     WHERE ws.id=$1
     GROUP BY ws.id,ws.tenant_id,ws.nama,ws.nomor_hp,t.nama`,
    [REVIEW_WALI_ID],
  );

  const mt8Tenant = await client.query(
    `SELECT id,slug,nama,status FROM tenants WHERE id=$1`,
    [MT8_TENANT_ID],
  );
  const mt8Counts = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM wali_santri WHERE tenant_id=$1) AS wali,
       (SELECT COUNT(*)::int FROM wali_akun WHERE tenant_id=$1) AS wali_accounts,
       (SELECT COUNT(*)::int FROM santri WHERE tenant_id=$1) AS santri,
       (SELECT COUNT(*)::int FROM santri WHERE tenant_id=$1 AND nama LIKE $2) AS prefixed_santri,
       (SELECT COUNT(*)::int FROM guru WHERE tenant_id=$1) AS guru,
       (SELECT COUNT(*)::int FROM guru WHERE tenant_id=$1 AND nama LIKE $2) AS prefixed_guru,
       (SELECT COUNT(*)::int FROM kelas WHERE tenant_id=$1) AS kelas,
       (SELECT COUNT(*)::int FROM kelas WHERE tenant_id=$1 AND nama_kelas LIKE $2) AS prefixed_kelas,
       (SELECT COUNT(*)::int FROM users WHERE tenant_id=$1) AS users,
       (SELECT COUNT(*)::int FROM unit_pendidikan WHERE tenant_id=$1) AS units`,
    [MT8_TENANT_ID, `${MT8_PREFIX}%`],
  );

  return {
    legacy,
    canonical,
    legacyRelations: legacyRelations.rows,
    canonicalRelations: canonicalRelations.rows,
    legacyAuditAfterCreation: Number(legacyAuditAfterCreation.rows[0]?.count || 0),
    reviewWali: reviewWali.rows[0] || null,
    mt8Tenant: mt8Tenant.rows[0] || null,
    mt8Counts: mt8Counts.rows[0] || {},
  };
}

function evaluateResolutionState(state) {
  const assumptions = [
    { key: "legacy_account_exists", ok: Boolean(state.legacy) },
    { key: "canonical_account_exists", ok: Boolean(state.canonical) },
    { key: "legacy_tenant_is_expected", ok: Number(state.legacy?.tenant_id) === EXPECTED_TENANT_ID },
    { key: "canonical_tenant_is_expected", ok: Number(state.canonical?.tenant_id) === EXPECTED_TENANT_ID },
    { key: "same_tenant", ok: Number(state.legacy?.tenant_id) === Number(state.canonical?.tenant_id) },
    { key: "phones_form_exact_collision", ok: canonicalPhone(state.legacy?.nomor_hp) === state.canonical?.nomor_hp },
    { key: "legacy_status_unchanged_active", ok: state.legacy?.status === "active" },
    { key: "canonical_stays_active", ok: state.canonical?.status === "active" },
    { key: "legacy_never_logged_in", ok: state.legacy?.last_login == null },
    { key: "legacy_has_no_santri_relation", ok: state.legacyRelations.length === 0 },
    { key: "legacy_has_no_new_audit_activity", ok: state.legacyAuditAfterCreation === 0 },
    { key: "canonical_has_real_relations", ok: state.canonicalRelations.length > 0 },
    { key: "review_wali_still_without_account", ok: Boolean(state.reviewWali) && state.reviewWali.has_exact_account === false },
    { key: "mt8_tenant_identity_exact", ok: Number(state.mt8Tenant?.id) === MT8_TENANT_ID && state.mt8Tenant?.slug === MT8_TENANT_SLUG },
    { key: "mt8_tenant_still_active", ok: state.mt8Tenant?.status === "active" },
    { key: "mt8_wali_exactly_one", ok: Number(state.mt8Counts.wali) === 1 && Number(state.reviewWali?.wali_id) === REVIEW_WALI_ID },
    { key: "mt8_has_no_wali_account", ok: Number(state.mt8Counts.wali_accounts) === 0 },
    { key: "mt8_all_santri_are_seed", ok: Number(state.mt8Counts.santri) === 3 && Number(state.mt8Counts.prefixed_santri) === 3 },
    { key: "mt8_all_guru_are_seed", ok: Number(state.mt8Counts.guru) === 1 && Number(state.mt8Counts.prefixed_guru) === 1 },
    { key: "mt8_all_kelas_are_seed", ok: Number(state.mt8Counts.kelas) === 2 && Number(state.mt8Counts.prefixed_kelas) === 2 },
    { key: "mt8_has_one_simulation_admin", ok: Number(state.mt8Counts.users) === 1 },
    { key: "mt8_has_expected_units", ok: Number(state.mt8Counts.units) === 8 },
  ];
  return { assumptions, ready: assumptions.every((item) => item.ok) };
}

module.exports = {
  CANONICAL_ACCOUNT_ID,
  EXPECTED_TENANT_ID,
  LEGACY_ACCOUNT_ID,
  MT8_PREFIX,
  MT8_TENANT_ID,
  MT8_TENANT_SLUG,
  REVIEW_WALI_ID,
  canonicalPhone,
  evaluateResolutionState,
  loadResolutionState,
};
