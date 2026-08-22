const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { resolveActiveUnit } = require('../services/unitAccessService');
const { resolveWaliUnit } = require('../middleware/waliUnitFeatureGuard');

const generatedUnitId = 10000 + crypto.randomInt(800000);
const foreignUnitId = generatedUnitId + 1;
const tenantId = 7000 + crypto.randomInt(2000);
const userId = 9000 + crypto.randomInt(2000);

function accessDb({ role = 'operator_unit', allowed = [generatedUnitId] } = {}) {
  return {
    async query(sql, params = []) {
      if (sql.includes('FROM users WHERE')) {
        return { rows: [{ id: userId, tenant_id: tenantId, role, status: 'active' }] };
      }
      if (sql.includes('FROM user_unit_scope')) {
        return { rows: allowed.map((unit_id) => ({ unit_id })) };
      }
      if (sql.includes('FROM unit_pendidikan WHERE')) {
        const id = Number(params[0]);
        return id === generatedUnitId || id === foreignUnitId
          ? { rows: [{ id, tenant_id: tenantId, kode: `DYNAMIC-${id}`, nama: `Dynamic ${id}`, unit_type: 'CUSTOM', preset_key: 'CUSTOM', is_active: true }] }
          : { rows: [] };
      }
      throw new Error(`Unexpected access SQL: ${sql}`);
    },
  };
}

function waliDb(rows) {
  return {
    async query(sql, params) {
      assert.match(sql, /FROM santri_units su/);
      assert.equal(params[0], tenantId);
      return { rows };
    },
  };
}

function scanRuntimeForFixedUnits() {
  const root = path.resolve(__dirname, '..');
  const roots = ['controllers', 'routes', 'services', 'middleware', 'frontend/src', 'wali-app/src'];
  const extensions = new Set(['.js', '.jsx', '.ts', '.tsx']);
  const violations = [];
  const fixedIds = '(?:2|3|179)';
  const unitVar = '(?:unit_id|unitId|activeUnitId|requestedUnitId)';
  const patterns = [
    new RegExp(`${unitVar}\\s*(?:===|==|=)\\s*${fixedIds}\\b`, 'i'),
    new RegExp(`\\b${fixedIds}\\s*(?:===|==)\\s*${unitVar}`, 'i'),
    /UPPER\s*\(\s*kode\s*\)\s*=\s*['"]PESANTREN['"]/i,
    /(?:unit_kode|unit_nama|unit\.kode|unit\.nama).*?(?:===|==|includes\().*?['"](?:MADINAH|SMP|PESANTREN)['"]/i,
    /PESANTREN_CODES|isPesantrenUnit|name\.includes\(['"]pesantren['"]\)/,
    /DEFAULT_UNITS|DEFAULT_UNIT_USERS/,
  ];

  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', 'dist', 'build', '__tests__'].includes(entry.name)) walk(full);
        continue;
      }
      if (!extensions.has(path.extname(entry.name)) || /\.(?:test|spec)\./.test(entry.name)) continue;
      fs.readFileSync(full, 'utf8').split(/\r?\n/).forEach((line, index) => {
        if (patterns.some((pattern) => pattern.test(line))) {
          violations.push(`${path.relative(root, full)}:${index + 1}`);
        }
      });
    }
  }

  roots.forEach((relative) => walk(path.join(root, relative)));
  assert.deepEqual(violations, [], `Fixed-unit runtime dependency found: ${violations.join(', ')}`);
}

async function run() {
  const operator = { id: userId, tenant_id: tenantId, role: 'operator_unit' };
  const own = await resolveActiveUnit(
    { user: operator, tenantId, query: { unit_id: String(generatedUnitId) }, body: {}, params: {}, headers: {} },
    accessDb(),
  );
  assert.equal(own.mode, 'UNIT');
  assert.equal(own.unitId, generatedUnitId);

  await assert.rejects(
    () => resolveActiveUnit(
      { user: operator, tenantId, query: { unit_id: String(foreignUnitId) }, body: {}, params: {}, headers: {} },
      accessDb(),
    ),
    (error) => error.status === 403 && error.code === 'UNIT_ACCESS_DENIED',
  );

  await assert.rejects(
    () => resolveActiveUnit(
      { user: operator, tenantId, query: {}, body: {}, params: {}, headers: {} },
      accessDb({ allowed: [] }),
    ),
    (error) => error.status === 403,
  );

  const superadmin = { id: userId, tenant_id: tenantId, role: 'superadmin' };
  const selected = await resolveActiveUnit(
    { user: superadmin, tenantId, query: { unit_id: String(generatedUnitId) }, body: {}, params: {}, headers: {} },
    accessDb({ role: 'superadmin' }),
  );
  assert.equal(selected.unitId, generatedUnitId);
  const all = await resolveActiveUnit(
    { user: superadmin, tenantId, query: { scope: 'all' }, body: {}, params: {}, headers: {} },
    accessDb({ role: 'superadmin' }),
  );
  assert.equal(all.mode, 'ALL');

  const waliUnit = await resolveWaliUnit(
    { santriId: 12345, tenantId, headers: { 'x-unit-id': String(generatedUnitId) } },
    waliDb([{ santri_unit_id: 55, unit_id: generatedUnitId, unit_kode: 'DYNAMIC', unit_nama: 'Generated', unit_type: 'CUSTOM' }]),
  );
  assert.equal(waliUnit.unit_id, generatedUnitId);
  await assert.rejects(
    () => resolveWaliUnit(
      { santriId: 12345, tenantId, headers: { 'x-unit-id': String(foreignUnitId) } },
      waliDb([]),
    ),
    (error) => error.status === 403 && error.code === 'UNIT_ACCESS_DENIED',
  );

  scanRuntimeForFixedUnits();
  console.log(`PASS universal unit architecture with randomized unit ${generatedUnitId}`);
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
