const assert = require("assert");
const fs = require("fs");
const { listOperationalStudents } = require("../services/operationalStudentLookupService");

async function run() {
  const calls = [];
  const client = { async query(sql, params) {
    calls.push({ sql, params });
    return { rows: [{ id: 7, nama: "Aman", nis: "N-7", santri_unit_id: 70, kelas_id: 8, nama_kelas: "A" }] };
  }};
  const req = { tenantId: 1, user: { id: 9, role: "keamanan", tenant_id: 1 }, query: { unit_id: "179", search: "N-7" }, headers: {} };
  const result = await listOperationalStudents(req, client, {
    resolveAccess: async (_req, usedClient, options) => {
      assert.strictEqual(usedClient, client);
      assert.deepStrictEqual(options, { requireSpecific: true });
      return { mode: "UNIT", unitId: 179 };
    },
  });
  assert.strictEqual(result.rows.length, 1);
  assert.deepStrictEqual(calls[0].params, [1, 179, "N-7"]);
  assert.match(calls[0].sql, /FROM santri_units su/);
  assert.match(calls[0].sql, /santri_kelas_enrollments/);
  assert.match(calls[0].sql, /su\.tenant_id = \$1/);
  assert.match(calls[0].sql, /su\.unit_id = \$2/);
  assert.doesNotMatch(calls[0].sql, /s\.alamat|s\.nik|s\.nama_wali|s\.no_hp/);
  await assert.rejects(
    () => listOperationalStudents({ ...req, query: {} }, client, { resolveAccess: async () => ({ mode: "UNIT", unitId: 179 }) }),
    (error) => error.code === "UNIT_REQUIRED" && error.status === 400,
  );

  for (const [path, permission] of [
    ["routes/perizinanRoutes.js", "perizinan.create"],
    ["routes/kesehatanRoutes.js", "kesehatan.manage"],
    ["routes/pelanggaranRoutes.js", "pelanggaran.create"],
  ]) {
    const source = fs.readFileSync(path, "utf8");
    assert.match(source, /"\/student-lookup"/);
    assert.ok(source.includes(permission));
    assert.ok(source.includes("listOperationalStudents"));
  }
  for (const [path, endpoint] of [
    ["frontend/src/pages/PerizinanPage.jsx", "/perizinan/student-lookup"],
    ["frontend/src/pages/KesehatanPage.jsx", "/kesehatan/student-lookup"],
    ["frontend/src/pages/PelanggaranPage.jsx", "/pelanggaran/student-lookup"],
  ]) {
    const source = fs.readFileSync(path, "utf8");
    assert.ok(source.includes(endpoint));
    assert.ok(source.includes("santriLookupError"));
    assert.ok(!source.includes('api.get("/santri", { params: readScopeParams })'));
  }
  const dashboard = fs.readFileSync("frontend/src/pages/DashboardPage.jsx", "utf8");
  assert.ok(dashboard.includes("<DashboardHero unitContext={unitContext} />"));
  assert.ok(!/!isUnitWorkspace\s*\?\s*\([\s\S]{0,150}<DashboardHero/.test(dashboard));
  assert.ok(dashboard.includes('api.get("/dashboard-specific-unit/summary"'));
  assert.ok(dashboard.includes('api.get("/dashboard/all-units-v1"'));
  console.log("security lookup + dashboard hero regression: PASS");
}
run().catch((error) => { console.error(error); process.exit(1); });
