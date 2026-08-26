const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { buildEligibility, normalizeYear } = require("../services/dashboardSpecificUnitService");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function assertFrozenAtBaseline(file) {
  const baseline = execFileSync("git", ["show", `e6d48a4:${file}`], { cwd: root, encoding: "utf8" });
  assert.equal(read(file).replace(/\r\n/g, "\n"), baseline.replace(/\r\n/g, "\n"), `${file} must remain frozen`);
}

function run() {
  assert.equal(normalizeYear(undefined, 2026), 2026);
  assert.equal(normalizeYear("2025", 2026), 2025);
  assert.throws(() => normalizeYear("1999"), (error) => error.code === "INVALID_YEAR");

  const features = ["santri", "kelas", "guru", "kesehatan", "perizinan", "wallet", "sahriyah", "pelanggaran", "nilai", "absensi"]
    .map((key) => ({ key, effective_enabled: true }));
  const full = buildEligibility({
    permissions: ["santri.view", "kelas.view", "guru.view", "kesehatan.view", "perizinan.view", "bukukas.view", "wallet.view", "sahriyah.view", "pelanggaran.view", "nilai.view", "absensi.view"],
    effectiveFeatures: features,
    cashEnabled: true,
  });
  assert.ok(Object.values(full).every(Boolean), "full-feature unit should show the reference modules");
  const subset = buildEligibility({
    permissions: ["santri.view", "kelas.view", "guru.view", "wallet.view", "nilai.view"],
    effectiveFeatures: features.map((item) => ({ ...item, effective_enabled: ["santri", "kelas", "guru", "wallet"].includes(item.key) })),
    cashEnabled: false,
  });
  assert.deepEqual(subset, {
    students: true, classes: true, teachers: true, health: false, permits: false,
    cash: false, wallet: true, sahriyah: false, violations: false, grades: false, attendance: false,
  });
  const randomSubset = buildEligibility({
    permissions: ["santri.view", "kelas.view", "bukukas.view", "pelanggaran.view"],
    effectiveFeatures: features.map((item) => ({
      ...item,
      effective_enabled: ["santri", "kelas", "pelanggaran"].includes(item.key),
    })),
    cashEnabled: true,
  });
  assert.deepEqual(randomSubset, {
    students: true, classes: true, teachers: false, health: false, permits: false,
    cash: true, wallet: false, sahriyah: false, violations: true, grades: false, attendance: false,
  });
  const noPermission = buildEligibility({ permissions: [], effectiveFeatures: features, cashEnabled: true });
  assert.ok(Object.values(noPermission).every((value) => value === false), "role permission must remain part of every module gate");

  const service = read("services/dashboardSpecificUnitService.js");
  const route = read("routes/dashboardSpecificUnitRoutes.js");
  const page = read("frontend/src/pages/DashboardPage.jsx");
  const component = read("frontend/src/components/dashboard/DashboardSpecificUnit.jsx");
  assert.match(route, /router\.get\("\/summary"/);
  assert.doesNotMatch(route, /router\.(post|put|patch|delete)\(/i);
  assert.match(route, /access\.mode !== "UNIT"[\s\S]*UNIT_REQUIRED/);
  assert.match(route, /req\.query\.unit_id == null[\s\S]*UNIT_REQUIRED/);
  assert.match(route, /resolveActiveUnit\(req\)/);
  assert.match(service, /COUNT\(DISTINCT su\.santri_id\)/);
  assert.match(service, /COUNT\(DISTINCT gu\.guru_id\)/);
  assert.match(service, /SUM\(current_balance\)/);
  assert.doesNotMatch(service, /santri\.saldo|SUM\(s\.saldo\)/);
  assert.match(service, /CASE WHEN jenis='Masuk' THEN nominal ELSE -nominal END/);
  assert.match(service, /l\.tanggal<\(make_date/);
  assert.match(service, /closing_balance: row\.closing_balance == null \? null/);
  assert.match(service, /a\.enrollment_id/);
  assert.match(service, /IN \('a','alfa','alpha','alpa'\)/);
  assert.doesNotMatch(service, /Ngaji Pagi|Ngaji Siang|Ngaji Sore|Ngaji Malam/);
  assert.match(service, /Kelas tidak tersedia pada unit aktif/);
  assert.match(service, /tenant_id=\$1 AND [a-z.]*unit_id=\$2/);
  assert.doesNotMatch(service, /unit_id\s*=\s*(2|3|179)\b/);
  assert.match(page, /api\.get\("\/dashboard-specific-unit\/summary"/);
  assert.match(page, /api\.get\("\/dashboard\/all-units-v1"/);
  assert.match(page, /<DashboardAllUnitsV1/);
  assert.match(page, /<DashboardSpecificUnit/);
  assert.match(component, /wallet_balance/);
  assert.match(component, /cash_balance/);
  assert.match(component, /eligibility\.cash && eligibility\.wallet, "Total Keuangan"/);
  assert.match(component, /Top 3 Alfa Bulan Ini/);
  assert.match(component, /@media\(max-width:639px\)/);
  assert.match(component, /grid-template-columns:minmax\(0,1fr\)/);
  assert.match(component, /max-width:100%/);

  assertFrozenAtBaseline("frontend/src/components/dashboard/DashboardAllUnitsV1.jsx");
  assertFrozenAtBaseline("services/dashboardAllUnitsV1Service.js");
  assertFrozenAtBaseline("routes/dashboardRoutes.js");
  console.log("PASS specific-unit Dashboard V1: scope, feature parity, money, Alfa, responsive, and all-unit freeze assertions");
}

run();
