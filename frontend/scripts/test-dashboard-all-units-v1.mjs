import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const page = readFileSync(resolve(root, "src/pages/DashboardPage.jsx"), "utf8");
const allUnits = readFileSync(resolve(root, "src/components/dashboard/DashboardAllUnitsV1.jsx"), "utf8");
const hero = readFileSync(resolve(root, "src/components/dashboard/DashboardHero.jsx"), "utf8");

assert.match(page, /activeUnitId[\s\S]*api\.get\("\/dashboard\/summary"/, "Specific-unit dashboard must keep existing summary endpoint");
assert.match(page, /api\.get\("\/dashboard\/all-units-v1"/, "All-unit dashboard must use dedicated aggregate endpoint");
assert.match(page, /isUnitWorkspace \? \([\s\S]*<DashboardMetrics[\s\S]*\) : \([\s\S]*<DashboardAllUnitsV1/, "Rendering must branch without redesigning specific-unit metrics");
assert.match(page, /scope: "all", year: allUnitsYear/, "All-unit request must carry read scope and chart year");
assert.doesNotMatch(page, /DashboardKesehatanHariIni|DashboardAnnouncement|DashboardViolations|DashboardFinanceChart/, "Out-of-scope legacy all-unit modules must not render in V1");
assert.match(hero, /Dashboard Yayasan \/ Semua Unit/, "All-unit hero must use Yayasan label");
assert.match(hero, /Dashboard Unit/, "Specific-unit hero title must remain intact");

for (const label of ["TOTAL SANTRI", "TOTAL KELAS", "TOTAL GURU", "TOTAL SALDO BUKU KAS SEMUA UNIT", "TOTAL KEUANGAN", "SALDO BUKU KAS SEMUA UNIT"]) {
  assert.match(allUnits, new RegExp(label), `Missing V1 label: ${label}`);
}
assert.match(allUnits, /wallet_enabled \? formatCurrency\(row\.wallet_balance\) :[\s\S]*Tidak Aktif/, "Wallet-off units must not display Rp0");
assert.match(allUnits, /closing_balance != null/, "Future null months must not be plotted");
assert.match(allUnits, /preserveAspectRatio="none"/, "Line chart must scale to container");
assert.match(allUnits, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/, "Desktop must show three database KPI cards");
assert.match(allUnits, /@media \(max-width: 639px\)[\s\S]*grid-template-columns: minmax\(0, 1fr\)/, "Mobile must stack database cards");
assert.match(allUnits, /max-width: 100%/, "V1 containers must be width constrained");
assert.doesNotMatch(allUnits, /Dashboard(Sahriyah|Perizinan|Kesehatan|Pelanggaran|Nilai|Absensi|Tamu)|TOTAL (SAHRIYAH|PERIZINAN|PELANGGARAN|ABSENSI|TAMU)/, "V1 UI must not include out-of-scope modules");

console.log("PASS Dashboard Semua Unit V1 frontend: branch contract, labels, Wallet unavailable state, chart, and responsive assertions");
