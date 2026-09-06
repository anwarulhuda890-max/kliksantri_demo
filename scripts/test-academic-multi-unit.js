process.env.DB_USER ||= "test";
process.env.DB_HOST ||= "localhost";
process.env.DB_NAME ||= "test";
process.env.DB_PASSWORD ||= "test";

const assert = require("assert");
const fs = require("fs");
const {
  listActiveStudentsInClass,
} = require("../services/academicUnitService");
const { isUnitFeatureEnabled } = require("../services/unitFeatureService");

let assertions = 0;
function ok(value, message) {
  assert.ok(value, message);
  assertions += 1;
}

async function main() {
  const calls = [];
  const canonicalClient = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes("FROM kelas")) {
        return { rows: [{ id: 31, tenant_id: 1, unit_id: 7, nama_kelas: "A" }] };
      }
      return {
        rows: [
          { id: 10, nama: "Santri A", santri_unit_id: 20, enrollment_id: 30, kelas_id: 31 },
        ],
      };
    },
  };
  const students = await listActiveStudentsInClass(1, 31, 7, canonicalClient);
  ok(students.length === 1, "canonical class students returned");
  ok(calls.length === 2, "class ownership checked before enrollment query");
  ok(calls[1].sql.includes("santri_kelas_enrollments"), "uses canonical enrollment");
  ok(calls[1].sql.includes("santri_units"), "uses canonical unit membership");
  ok(calls[1].sql.includes("su.unit_id = $3"), "unit scoped in SQL");
  ok(calls[1].sql.includes("ske.status = 'active'"), "active enrollment only");
  ok(calls[1].sql.includes("ske.end_date IS NULL"), "ended enrollment excluded");
  ok(calls[1].params.join(",") === "1,31,7", "tenant/class/unit params exact");

  await assert.rejects(
    () => listActiveStudentsInClass(1, 99, 7, { query: async () => ({ rows: [] }) }),
    (error) => error.code === "CROSS_UNIT_CLASS" && error.status === 403,
  );
  assertions += 1;

  await assert.rejects(
    () => listActiveStudentsInClass(1, "", 7, canonicalClient),
    (error) => error.code === "CLASS_REQUIRED" && error.status === 400,
  );
  assertions += 1;

  const enabledClient = { query: async () => ({ rows: [{ enabled: true }] }) };
  const disabledClient = { query: async () => ({ rows: [{ enabled: false }] }) };
  const missingClient = { query: async () => ({ rows: [] }) };
  ok(await isUnitFeatureEnabled(1, 7, "mata_pelajaran", enabledClient, async () => true), "feature ON allowed");
  ok(!(await isUnitFeatureEnabled(1, 7, "mata_pelajaran", disabledClient, async () => true)), "feature OFF denied");
  ok(!(await isUnitFeatureEnabled(1, 7, "mata_pelajaran", missingClient, async () => true)), "missing unit feature denied");
  ok(!(await isUnitFeatureEnabled(1, 7, "mata_pelajaran", enabledClient, async () => false)), "tenant entitlement OFF denied");

  const nilaiPage = fs.readFileSync("frontend/src/pages/NilaiPage.jsx", "utf8");
  const hafalanPage = fs.readFileSync("frontend/src/pages/HafalanPage.jsx", "utf8");
  const featureMap = fs.readFileSync("frontend/src/constants/permissions.js", "utf8");
  const sidebar = fs.readFileSync("frontend/src/components/Sidebar.jsx", "utf8");
  const nilaiRoute = fs.readFileSync("routes/nilaiRoutes.js", "utf8");
  const hafalanRoute = fs.readFileSync("routes/hafalanRoutes.js", "utf8");
  const academicFiles = [nilaiPage, hafalanPage, featureMap, sidebar, nilaiRoute, hafalanRoute, fs.readFileSync("routes/mataPelajaranRoutes.js", "utf8")].join("\n");

  ok(nilaiPage.includes('api.get("/nilai/students"'), "Nilai uses canonical class endpoint");
  ok(hafalanPage.includes('api.get("/hafalan/students"'), "Hafalan uses canonical class endpoint");
  ok(!nilaiPage.includes('api.get("/santri"'), "Nilai no longer fetches broad santri list");
  ok(!hafalanPage.includes('api.get("/santri"'), "Hafalan no longer fetches broad santri list");
  ok(featureMap.includes('"/mata-pelajaran": "mata_pelajaran"'), "Mapel exact unit feature");
  ok(featureMap.includes('"/nilai": "nilai"'), "Nilai exact unit feature");
  ok(featureMap.includes('"/hafalan": "hafalan"'), "Hafalan exact unit feature");
  ok(sidebar.includes('unitFeature: "mata_pelajaran"'), "sidebar Mapel unit-aware");
  ok(nilaiRoute.includes('requirePermission("nilai.manage")'), "Nilai writes require manage");
  ok(hafalanRoute.includes('requirePermission("hafalan.manage")'), "Hafalan writes require manage");
  ok(!/(unit_id\s*===?\s*(3|179)|unit\.nama\s*===?|SMP_ONLY|PESANTREN_ONLY)/i.test(academicFiles), "no unit id/name special case");
  ok(nilaiPage.includes("studentRequestId.current += 1"), "Nilai resets pending class request on unit switch");
  ok(hafalanPage.includes("studentRequestId.current += 1"), "Hafalan resets pending class request on unit switch");
  ok(nilaiPage.includes("Gagal memuat santri kelas"), "Nilai request errors are not empty state");
  ok(hafalanPage.includes("Gagal memuat santri kelas"), "Hafalan request errors are not empty state");

  console.log(JSON.stringify({ status: "PASS", assertions }, null, 2));
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
