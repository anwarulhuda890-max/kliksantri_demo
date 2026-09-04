const pool = require('../db');
const { readMigration, recordMigration } = require('../utils/migrationLedger');

const FILENAME = '087_app_brand_profiles.sql';

async function snapshot(client) {
  const exists = Boolean((await client.query("SELECT to_regclass('public.app_brand_profiles') AS name")).rows[0].name);
  return {
    table_exists: exists,
    profile_count: exists ? Number((await client.query('SELECT COUNT(*) AS value FROM app_brand_profiles')).rows[0].value) : 0,
    universal_count: exists ? Number((await client.query("SELECT COUNT(*) AS value FROM app_brand_profiles WHERE mode='universal'")).rows[0].value) : 0,
    universal_package: exists ? (await client.query("SELECT package_id FROM app_brand_profiles WHERE mode='universal' LIMIT 1")).rows[0]?.package_id || null : null,
    permission_count: Number((await client.query("SELECT COUNT(*) AS value FROM permissions WHERE key IN ('platform.brand.view','platform.brand.manage','platform.brand.approve')")).rows[0].value),
    role_grant_count: Number((await client.query("SELECT COUNT(*) AS value FROM role_permissions rp JOIN roles r ON r.id=rp.role_id JOIN permissions p ON p.id=rp.permission_id WHERE r.name='platform_superadmin' AND p.key IN ('platform.brand.view','platform.brand.manage','platform.brand.approve')")).rows[0].value),
    ledger_count: Number((await client.query('SELECT COUNT(*) AS value FROM schema_migrations WHERE filename=$1', [FILENAME])).rows[0].value),
  };
}

async function main() {
  const rehearsal = process.argv.includes('--rollback-rehearsal');
  const confirm = process.argv.includes('--confirm-production');
  if (!rehearsal && !confirm) throw new Error('Gunakan --rollback-rehearsal atau --confirm-production');
  const client = await pool.connect();
  try {
    const before = await snapshot(client);
    if (before.ledger_count) throw new Error(`ALREADY_APPLIED:${JSON.stringify(before)}`);
    await client.query('BEGIN');
    const migration = readMigration(FILENAME);
    await client.query(migration.executionSql);
    await recordMigration(client, migration);
    const after = await snapshot(client);
    const checks = {
      table_exists: after.table_exists,
      exactly_one_universal: after.universal_count === 1,
      universal_package_preserved: after.universal_package === 'com.klikpesantren.wali',
      permissions: after.permission_count === 3,
      platform_grants: after.role_grant_count === 3,
      ledger_recorded: after.ledger_count === 1,
    };
    if (Object.values(checks).some((value) => !value)) throw new Error(`PRODUCTION_CHECK_FAILED:${JSON.stringify(checks)}`);
    if (rehearsal) {
      await client.query('ROLLBACK');
      const rollback = await snapshot(client);
      const rollbackPass = JSON.stringify(rollback) === JSON.stringify(before);
      console.log(JSON.stringify({ mode: 'PRODUCTION_ROLLBACK_REHEARSAL', before, after, checks, rollback: rollbackPass ? 'PASS' : 'FAIL' }, null, 2));
      if (!rollbackPass) process.exitCode = 1;
      return;
    }
    await client.query('COMMIT');
    console.log(JSON.stringify({ mode: 'PRODUCTION_APPLY', migration: FILENAME, before, after, checks, status: 'PASS' }, null, 2));
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch {}
    throw error;
  } finally { client.release(); await pool.end(); }
}

main().catch((error) => { console.error(JSON.stringify({ status: 'FAIL', reason: error.message })); process.exit(1); });
