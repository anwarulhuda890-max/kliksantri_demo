const assert = require('node:assert/strict');
const { getDashboardFinanceSummary } = require('../services/dashboardFinanceSummaryService');

function fakeClient() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM buku_kas bk') && sql.includes('FILTER') && sql.includes('EXTRACT(MONTH')) {
        return { rows: [{ masuk: 500000, keluar: 125000 }] };
      }
      if (sql.includes('FROM buku_kas bk') && sql.includes('GROUP BY')) {
        return { rows: [{ bulan: 8, masuk: 500000, keluar: 125000 }] };
      }
      if (sql.includes('FROM buku_kas bk')) return { rows: [{ id: 1, unit_id: params[1] }] };
      if (sql.includes('FROM pembayaran p') && sql.includes('pembayaran_detail')) {
        return { rows: [{ nominal_tagihan: 500000, sudah_dibayar: 200000, sisa_belum_dibayar: 300000, pembayaran_hari_ini: 100000, tagihan_belum_lunas: 1 }] };
      }
      if (sql.includes('FROM pembayaran p')) return { rows: [{ id: 2, unit_id: params[1] }] };
      if (sql.includes('WITH scoped_memberships')) {
        return { rows: [{ total_santri: 3, lunas: 1, cicilan: 1, belum_bayar: 1, sudah_dibayar: 200000, sisa_belum_dibayar: 300000 }] };
      }
      if (sql.includes('FROM tagihan_sahriyah t')) return { rows: [{ unit_id: params[1], sisa_tagihan: 300000 }] };
      throw new Error(`Unexpected dashboard SQL: ${sql}`);
    },
  };
}

async function run() {
  const randomUnitId = Math.floor(Math.random() * 800000) + 10000;
  const unitDb = fakeClient();
  const unit = await getDashboardFinanceSummary(unitDb, {
    tenantId: 41,
    unitId: randomUnitId,
    month: 8,
    year: 2026,
  });

  assert.equal(unit.cash.saldo, 375000);
  assert.deepEqual(unit.payment, {
    nominal_tagihan: 500000,
    sudah_dibayar: 200000,
    sisa_belum_dibayar: 300000,
    pembayaran_hari_ini: 100000,
    tagihan_belum_lunas: 1,
  });
  assert.equal(unit.sahriyah.status.total_santri, 3);
  assert.equal(unit.sahriyah.sisa_belum_dibayar, 300000);
  assert.equal(unitDb.calls.length, 7);
  for (const call of unitDb.calls) {
    assert.equal(call.params[0], 41, 'tenant_id must be the first scope parameter');
    assert.equal(call.params[1], randomUnitId, 'every unit-owned query must use resolved unit_id');
    assert.match(call.sql, /\$2::int IS NULL OR [a-z]+\.unit_id = \$2/);
    assert.doesNotMatch(call.sql, /unit_id\s*=\s*(2|3|179)\b/);
  }

  const allDb = fakeClient();
  await getDashboardFinanceSummary(allDb, { tenantId: 41, unitId: null, month: 8, year: 2026 });
  assert.ok(allDb.calls.every((call) => call.params[1] === null), 'scope=all must be backend aggregation');
  assert.ok(allDb.calls.every((call) => call.sql.includes('unit_pendidikan')), 'all-unit queries must include canonical active units');

  console.log(`PASS dashboard finance scope with randomized unit ${randomUnitId}`);
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
