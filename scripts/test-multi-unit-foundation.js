const assert = require("assert/strict");
const {
  assertUnitAccess,
  getAllowedUnitIds,
} = require("../services/unitAccessService");
const { createMembership } = require("../services/santriUnitService");
const { isUnitFeatureEnabled, updateUnitFeatures } = require("../services/unitFeatureService");
const { getPresetPreview } = require("../config/unitFeaturePresets");

function accessDb({ userTenant = 1, role = "operator", unit = null, allowed = [] } = {}) {
  return {
    async query(sql) {
      if (sql.includes("FROM users WHERE")) return { rows: [{ id: 10, tenant_id: userTenant, role, status: "Aktif" }] };
      if (sql.includes("FROM unit_pendidikan WHERE")) return { rows: unit ? [unit] : [] };
      if (sql.includes("FROM user_unit_scope")) return { rows: allowed.map((unit_id) => ({ unit_id })) };
      throw new Error(`Unexpected access SQL: ${sql}`);
    },
  };
}

async function rejectsCode(fn, code) {
  await assert.rejects(fn, (error) => error.code === code || error.message.includes(code));
}

async function run() {
  const activeSmp = { id: 2, tenant_id: 1, kode: "SMP", nama: "SMP", unit_type: "SMP", preset_key: "SEKOLAH", is_active: true };
  const activePondok = { ...activeSmp, id: 1, kode: "PESANTREN", nama: "Pondok", unit_type: "PESANTREN", preset_key: "PESANTREN" };

  await assert.rejects(
    () => assertUnitAccess({ id: 10, tenant_id: 1, role: "operator" }, 99, 1, accessDb({ unit: null })),
    /Unit tidak ditemukan/,
    "Tenant A tidak boleh mengakses unit tenant B",
  );

  await assert.rejects(
    () => assertUnitAccess({ id: 10, tenant_id: 1, role: "operator" }, 1, 1, accessDb({ unit: activePondok, allowed: [2] })),
    /Akses unit ditolak/,
    "Operator SMP tidak boleh mengakses Pondok",
  );

  assert.deepEqual(
    await getAllowedUnitIds({ id: 10, tenant_id: 1, role: "operator" }, 1, accessDb({ allowed: [] })),
    [],
    "Akun tanpa scope harus menghasilkan daftar kosong, bukan all access",
  );

  assert.equal(
    (await assertUnitAccess({ id: 10, tenant_id: 1, role: "superadmin" }, 2, 1, accessDb({ role: "superadmin", unit: activeSmp }))).id,
    2,
  );
  await assert.rejects(
    () => assertUnitAccess({ id: 10, tenant_id: 1, role: "superadmin" }, 3, 1, accessDb({ role: "superadmin", unit: null })),
    /Unit tidak ditemukan/,
  );

  const unitFeatureDb = (enabled) => ({ query: async () => ({ rows: [{ enabled }] }) });
  assert.equal(await isUnitFeatureEnabled(1, 2, "nilai", unitFeatureDb(false), async () => true), false);
  assert.equal(await isUnitFeatureEnabled(1, 2, "nilai", unitFeatureDb(true), async () => false), false);

  await rejectsCode(
    () => assertUnitAccess({ id: 10, tenant_id: 1, role: "operator" }, 2, 1, accessDb({ unit: { ...activeSmp, is_active: false }, allowed: [2] })),
    "UNIT_INACTIVE",
  );

  const crossTenantDb = { query: async (sql) => sql.includes("SELECT s.id") ? { rows: [] } : { rows: [] } };
  await rejectsCode(
    () => createMembership({ tenant_id: 1, santri_id: 5, unit_id: 20 }, crossTenantDb),
    "CROSS_TENANT_MEMBERSHIP",
  );

  const duplicateDb = {
    async query(sql) {
      if (sql.includes("SELECT s.id")) return { rows: [{ santri_id: 5, unit_id: 2 }] };
      const error = new Error("duplicate"); error.code = "23505"; throw error;
    },
  };
  await rejectsCode(
    () => createMembership({ tenant_id: 1, santri_id: 5, unit_id: 2 }, duplicateDb),
    "DUPLICATE_ACTIVE_MEMBERSHIP",
  );

  const before = getPresetPreview("SMP");
  const writes = [];
  const overrideDb = {
    async query(sql, params) {
      writes.push({ sql, params });
      if (sql.includes("SELECT uf.feature_key")) return { rows: [{ key: "nilai", enabled: false, source: "custom", available: true }] };
      if (sql.includes("SELECT enabled FROM unit_features")) return { rows: [{ enabled: false }] };
      return { rows: [] };
    },
  };
  await updateUnitFeatures(1, 2, [{ key: "nilai", enabled: false }], overrideDb, async () => true);
  assert.deepEqual(getPresetPreview("SMP"), before, "Override unit tidak boleh mengubah preset global");
  assert.ok(writes.some((entry) => entry.params?.includes("custom") || entry.sql.includes("'custom'")));

  console.log("PASS multi-unit foundation: 10 security/data tests");
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
