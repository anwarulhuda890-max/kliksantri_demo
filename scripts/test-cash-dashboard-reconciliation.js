const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const pool = require("../db");
const {
  getUnitCashRunningBalance,
  listBukuKas,
} = require("../services/financeCashService");
const { getDashboardSpecificUnit } = require("../services/dashboardSpecificUnitService");
const { getDashboardAllUnitsV1 } = require("../services/dashboardAllUnitsV1Service");

const TENANT_ID = Number(process.env.CASH_RECONCILIATION_TENANT_ID || 1);
const PERMISSIONS = [
  "santri.view", "kelas.view", "guru.view", "kesehatan.view", "perizinan.view",
  "bukukas.view", "wallet.view", "rfid.view", "sahriyah.view",
  "pelanggaran.view", "nilai.view", "absensi.view",
];

function requestFor(user, query) {
  return {
    tenantId: TENANT_ID,
    user: {
      id: Number(user.id),
      tenant_id: TENANT_ID,
      role: user.role,
    },
    query,
    body: {},
    params: {},
    headers: {},
  };
}

function previousPeriod(now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return { bulan: date.getUTCMonth() + 1, tahun: date.getUTCFullYear() };
}

async function main() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const superadmin = (await client.query(
      `SELECT id,role FROM users
       WHERE tenant_id=$1 AND role='superadmin'
         AND LOWER(TRIM(status)) IN ('aktif','active')
       ORDER BY id LIMIT 1`,
      [TENANT_ID],
    )).rows[0];
    assert(superadmin, "Superadmin aktif untuk audit read-only tidak tersedia");

    const units = (await client.query(
      `SELECT id,nama FROM unit_pendidikan
       WHERE tenant_id=$1 AND is_active=true ORDER BY sort_order,id`,
      [TENANT_ID],
    )).rows;
    assert(units.length > 0, "Unit aktif tidak tersedia");

    const current = new Date();
    const currentPeriod = { bulan: current.getMonth() + 1, tahun: current.getFullYear() };
    const previous = previousPeriod(current);
    const reconciliation = [];

    for (const unit of units) {
      const canonical = await getUnitCashRunningBalance(client, {
        tenantId: TENANT_ID,
        unitId: unit.id,
      });
      const independent = Number((await client.query(
        `SELECT COALESCE(SUM(CASE WHEN jenis='Masuk' THEN nominal ELSE -nominal END),0)::bigint AS balance
         FROM buku_kas
         WHERE tenant_id=$1 AND unit_id=$2
           AND tanggal < (CURRENT_DATE + INTERVAL '1 day')`,
        [TENANT_ID, unit.id],
      )).rows[0].balance);
      const pageCurrent = await listBukuKas(
        requestFor(superadmin, { unit_id: unit.id, ...currentPeriod }),
        client,
      );
      const pagePrevious = await listBukuKas(
        requestFor(superadmin, { unit_id: unit.id, ...previous }),
        client,
      );
      const dashboard = await getDashboardSpecificUnit(client, {
        tenantId: TENANT_ID,
        unitId: unit.id,
        year: currentPeriod.tahun,
        permissions: PERMISSIONS,
      });

      assert.strictEqual(pageCurrent.summary.saldo, canonical.saldo, `Page current mismatch unit ${unit.id}`);
      assert.strictEqual(pagePrevious.summary.saldo, canonical.saldo, `Previous filter changed running balance unit ${unit.id}`);
      assert.strictEqual(dashboard.finance.cash_balance, canonical.saldo, `Dashboard mismatch unit ${unit.id}`);
      assert.strictEqual(independent, canonical.saldo, `Independent DB mismatch unit ${unit.id}`);
      assert.strictEqual(
        pageCurrent.summary.saldo_periode,
        pageCurrent.summary.pemasukan - pageCurrent.summary.pengeluaran,
        `Current period summary mismatch unit ${unit.id}`,
      );
      assert.strictEqual(
        pagePrevious.summary.saldo_periode,
        pagePrevious.summary.pemasukan - pagePrevious.summary.pengeluaran,
        `Previous period summary mismatch unit ${unit.id}`,
      );

      reconciliation.push({
        unit_id: Number(unit.id),
        unit_name: unit.nama,
        buku_kas: pageCurrent.summary.saldo,
        dashboard: dashboard.finance.cash_balance,
        db_canonical: independent,
        mismatch: pageCurrent.summary.saldo - dashboard.finance.cash_balance,
        current_period_balance: pageCurrent.summary.saldo_periode,
        previous_period_balance: pagePrevious.summary.saldo_periode,
      });
    }

    const allUnits = await getDashboardAllUnitsV1(client, {
      tenantId: TENANT_ID,
      year: currentPeriod.tahun,
    });
    const canonicalTotal = reconciliation.reduce((sum, row) => sum + row.db_canonical, 0);
    assert.strictEqual(allUnits.finance.cash.total_balance, canonicalTotal, "All-unit cash total mismatch");

    const sourceNet = (await client.query(
      `SELECT COALESCE(source,'<null>') AS source,
              SUM(CASE WHEN jenis='Masuk' THEN nominal ELSE -nominal END)::bigint AS net,
              COUNT(*)::int AS rows
       FROM buku_kas WHERE tenant_id=$1
         AND tanggal < (CURRENT_DATE + INTERVAL '1 day')
       GROUP BY source ORDER BY source`,
      [TENANT_ID],
    )).rows.map((row) => ({ source: row.source, net: Number(row.net), rows: Number(row.rows) }));
    assert.strictEqual(sourceNet.reduce((sum, row) => sum + row.net, 0), canonicalTotal);

    let unitSwitch = { status: "NOT_APPLICABLE_SINGLE_UNIT" };
    if (units.length >= 2) {
      const unitA = units[0];
      const unitB = units[1];
      const [firstA, middleB, finalA] = await Promise.all([
        getDashboardSpecificUnit(client, {
          tenantId: TENANT_ID, unitId: unitA.id, year: currentPeriod.tahun, permissions: PERMISSIONS,
        }),
        getDashboardSpecificUnit(client, {
          tenantId: TENANT_ID, unitId: unitB.id, year: currentPeriod.tahun, permissions: PERMISSIONS,
        }),
        getDashboardSpecificUnit(client, {
          tenantId: TENANT_ID, unitId: unitA.id, year: currentPeriod.tahun, permissions: PERMISSIONS,
        }),
      ]);
      const expectedA = reconciliation.find((row) => row.unit_id === Number(unitA.id)).db_canonical;
      const expectedB = reconciliation.find((row) => row.unit_id === Number(unitB.id)).db_canonical;
      assert.strictEqual(firstA.finance.cash_balance, expectedA);
      assert.strictEqual(middleB.finance.cash_balance, expectedB);
      assert.strictEqual(finalA.finance.cash_balance, expectedA);
      unitSwitch = {
        status: "PASS",
        sequence: [Number(unitA.id), Number(unitB.id), Number(unitA.id)],
        balances: [
          firstA.finance.cash_balance,
          middleB.finance.cash_balance,
          finalA.finance.cash_balance,
        ],
      };
    }

    const operatorFixture = (await client.query(
      `SELECT usr.id,usr.role,own_scope.unit_id AS own_unit,
              foreign_unit.id AS foreign_unit
       FROM users usr
       JOIN user_unit_scope own_scope ON own_scope.user_id=usr.id
         AND own_scope.tenant_id=usr.tenant_id AND own_scope.status='active'
       JOIN LATERAL (
         SELECT u.id FROM unit_pendidikan u
         WHERE u.tenant_id=usr.tenant_id AND u.is_active=true
           AND NOT EXISTS (
             SELECT 1 FROM user_unit_scope denied
             WHERE denied.user_id=usr.id AND denied.tenant_id=usr.tenant_id
               AND denied.unit_id=u.id AND denied.status='active'
           )
         ORDER BY u.id LIMIT 1
       ) foreign_unit ON TRUE
       WHERE usr.tenant_id=$1 AND usr.role<>'superadmin'
         AND LOWER(TRIM(usr.status)) IN ('aktif','active')
       ORDER BY usr.id LIMIT 1`,
      [TENANT_ID],
    )).rows[0];
    let crossUnit = "NOT_APPLICABLE_NO_OPERATOR_FIXTURE";
    if (operatorFixture) {
      await assert.rejects(
        listBukuKas(
          requestFor(operatorFixture, {
            unit_id: operatorFixture.foreign_unit,
            ...currentPeriod,
          }),
          client,
        ),
        (error) => error.status === 403 && error.code === "UNIT_ACCESS_DENIED",
      );
      crossUnit = "PASS_403";
    }

    const futureRows = Number((await client.query(
      "SELECT COUNT(*)::int AS total FROM buku_kas WHERE tenant_id=$1 AND tanggal>=CURRENT_DATE+INTERVAL '1 day'",
      [TENANT_ID],
    )).rows[0].total);
    const dashboardSource = fs.readFileSync(
      path.join(__dirname, "..", "frontend", "src", "pages", "DashboardPage.jsx"),
      "utf8",
    );
    assert(dashboardSource.includes("summaryRequestRef.current.controller?.abort()"));
    assert(dashboardSource.includes("summaryRequestRef.current.sequence !== sequence"));
    const bukuKasSource = fs.readFileSync(
      path.join(__dirname, "..", "frontend", "src", "pages", "BukuKasPage.jsx"),
      "utf8",
    );
    assert(bukuKasSource.includes("params: { ...readScopeParams, bulan, tahun }"));
    assert(bukuKasSource.includes("const saldoKas = Number(summary.saldo || 0)"));
    assert(bukuKasSource.includes("dataRequestRef.current.controller?.abort()"));
    assert(bukuKasSource.includes("dataRequestRef.current.sequence !== sequence"));

    console.log(JSON.stringify({
      status: "PASS",
      mode: "PRODUCTION_READ_ONLY",
      reconciliation,
      all_unit: {
        canonical_total: canonicalTotal,
        dashboard_total: allUnits.finance.cash.total_balance,
        mismatch: canonicalTotal - allUnits.finance.cash.total_balance,
      },
      source_net: sourceNet,
      future_rows_excluded_from_current_balance: futureRows,
      unit_switch: unitSwitch,
      cross_unit: crossUnit,
      frontend_stale_guard: "PASS",
    }, null, 2));
    await client.query("ROLLBACK");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* best effort */ }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", reason: error.message, stack: error.stack }, null, 2));
  process.exit(1);
});
