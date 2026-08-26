const assert = require("node:assert/strict");
const pool = require("../db");
const { getDashboardSpecificUnit } = require("../services/dashboardSpecificUnitService");

const permissions = [
  "santri.view", "kelas.view", "guru.view", "kesehatan.view", "perizinan.view",
  "bukukas.view", "wallet.view", "rfid.view", "sahriyah.view", "pelanggaran.view",
  "nilai.view", "absensi.view",
];

async function run() {
  const tenantId = Number(process.env.RECONCILE_TENANT_ID || 1);
  const { rows: units } = await pool.query(
    `SELECT id,nama FROM unit_pendidikan WHERE tenant_id=$1 AND is_active=true ORDER BY sort_order,id`,
    [tenantId],
  );
  assert.ok(units.length > 0, "No active unit found");
  const output = [];
  for (const unit of units) {
    const data = await getDashboardSpecificUnit(pool, {
      tenantId, unitId: unit.id, year: new Date().getFullYear(), permissions,
    });
    const cash = data.finance.cash_balance || 0;
    const wallet = data.finance.wallet_balance || 0;
    assert.equal(data.finance.total, cash + wallet, `Finance mismatch unit ${unit.id}`);
    assert.ok(data.finance.monthly_closing.length === 0 || data.finance.monthly_closing.length === 12);
    output.push({
      unit_id: Number(unit.id), unit_name: unit.nama, eligibility: data.eligibility,
      counts: data.counts, cash_balance: data.finance.cash_balance,
      wallet_balance: data.finance.wallet_balance, total_finance: data.finance.total,
      selected_class_id: data.selected_class_id,
      grades: data.grades.length, alpha: data.alpha.length,
    });
  }
  console.log(JSON.stringify({ tenant_id: tenantId, units: output }, null, 2));
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
