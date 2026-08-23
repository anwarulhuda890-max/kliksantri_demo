const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { getDashboardUnitSummary } = require('../services/dashboardUnitSummaryService');

function fakeClient() {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('AS total_guru')) return { rows: [{ total_guru: 3, santri_hadir: 8, santri_absensi_total: 10, absensi_hari_ini: 2, guru_hadir: 7, guru_absensi_total: 10, total_hafalan: 4, nilai_terisi: 2, nilai_total: 170 }] };
      if (sql.includes('AS total_perizinan')) return { rows: [{ total_perizinan: 2, belum_kembali: 1, total_pelanggaran: 3, santri_melanggar: 2 }] };
      if (sql.includes('FROM perizinan p') && sql.includes('LIMIT 5')) return { rows: [{ id: 1, unit_id: params[1] }] };
      if (sql.includes('FROM pelanggaran p')) return { rows: [{ id: 2, unit_id: params[1], jumlah_pelanggaran: 3 }] };
      if (sql.includes('FROM pengumuman p')) return { rows: [{ id: 3, unit_id: params[1], is_active: true, total_count: 2, active_count: 1 }] };
      if (sql.includes('WITH scoped_memberships')) return { rows: [{ total: 5, sakit: 1, perlu: 1 }] };
      if (sql.includes('FROM tamu t')) return { rows: [{ hari_ini: 1, bulan_ini: 2, masih_didalam: 1 }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

async function run() {
  const randomUnitId = Math.floor(Math.random() * 800000) + 10000;
  const unitDb = fakeClient();
  const result = await getDashboardUnitSummary(unitDb, { tenantId: 41, unitId: randomUnitId, month: 8, year: 2026 });
  assert.equal(result.academic.total_guru, 3);
  assert.equal(result.academic.persentase_kehadiran_santri, 80);
  assert.equal(result.academic.persentase_kehadiran_guru, 70);
  assert.equal(result.academic.rata_nilai, 85);
  assert.equal(result.operational.total_pelanggaran, 3);
  assert.equal(result.health.sehat, 4);
  assert.equal(result.guests.ownership, 'TENANT');
  assert.equal(unitDb.calls.length, 7);
  for (const call of unitDb.calls.slice(0, 6)) {
    assert.equal(call.params[0], 41);
    assert.equal(call.params[1], randomUnitId);
    assert.match(call.sql, /\$2::int IS NULL OR [a-z]+\.unit_id=\$2/);
    assert.doesNotMatch(call.sql, /unit_id\s*=\s*(2|3|179)\b/);
  }
  assert.equal(unitDb.calls[6].params.length, 3, 'tenant-owned tamu must not accept unit scope');
  assert.doesNotMatch(unitDb.calls[6].sql, /unit_id/);

  const allDb = fakeClient();
  await getDashboardUnitSummary(allDb, { tenantId: 41, unitId: null, month: 8, year: 2026 });
  assert.ok(allDb.calls.slice(0, 6).every((call) => call.params[1] === null));

  const frontendFiles = [
    'frontend/src/components/dashboard/DashboardPendidikan.jsx',
    'frontend/src/components/dashboard/DashboardKeamanan.jsx',
    'frontend/src/components/dashboard/DashboardSekretaris.jsx',
  ].map((file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8')).join('\n');
  assert.doesNotMatch(frontendFiles, /api\.get\("\/(guru|perizinan|pengumuman)"/);
  const page = fs.readFileSync(path.join(__dirname, '../frontend/src/pages/DashboardPage.jsx'), 'utf8');
  assert.match(page, /new AbortController\(\)/);
  assert.match(page, /summaryRequestRef\.current\.sequence !== sequence/);
  assert.match(page, /!summaryLoading && !summaryError/);
  console.log(`PASS dashboard unit contract with randomized unit ${randomUnitId}`);
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
