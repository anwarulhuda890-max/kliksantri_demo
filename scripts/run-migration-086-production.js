const pool = require("../db");
const { readMigration, recordMigration } = require("../utils/migrationLedger");

const FILENAME = "086_canonical_klikpesantren_branding.sql";

async function snapshot(client) {
  const row = (await client.query(
    "SELECT settings FROM platform_settings WHERE id=1",
  )).rows[0] || { settings: {} };
  const settings = row.settings || {};
  return {
    platform_name: settings.platform_name ?? null,
    tagline: settings.tagline ?? null,
    about_text: settings.about_text ?? null,
    website_url: settings.website_url ?? null,
    logo_url: settings.logo_url ?? null,
    ledger_086: Number((await client.query(
      "SELECT COUNT(*) AS value FROM schema_migrations WHERE filename=$1",
      [FILENAME],
    )).rows[0].value),
  };
}

async function main() {
  const rollbackRehearsal = process.argv.includes("--rollback-rehearsal");
  const confirm = process.argv.includes("--confirm-production");
  if (!rollbackRehearsal && !confirm) {
    throw new Error("Gunakan --rollback-rehearsal atau --confirm-production");
  }
  const client = await pool.connect();
  try {
    const before = await snapshot(client);
    if (before.ledger_086) throw new Error(`ALREADY_APPLIED:${JSON.stringify(before)}`);
    await client.query("BEGIN");
    const migration = readMigration(FILENAME);
    await client.query(migration.executionSql);
    await recordMigration(client, migration);
    const after = await snapshot(client);
    const checks = {
      platform_name: after.platform_name === "KlikPesantren",
      tagline: after.tagline === "Amanah Kita Bersama",
      website_url: after.website_url === "https://klikpesantren.com",
      no_legacy_about: !/KlikSantri|Klikpesantren/.test(after.about_text || ""),
      stable_logo_preserved: after.logo_url === before.logo_url,
      ledger_recorded: after.ledger_086 === 1,
    };
    if (Object.values(checks).some((value) => !value)) {
      throw new Error(`PRODUCTION_CHECK_FAILED:${JSON.stringify(checks)}`);
    }
    if (rollbackRehearsal) {
      await client.query("ROLLBACK");
      const rollback = await snapshot(client);
      const rollbackPass = JSON.stringify(rollback) === JSON.stringify(before);
      console.log(JSON.stringify({ mode: "PRODUCTION_ROLLBACK_REHEARSAL", before, after, checks, rollback: rollbackPass ? "PASS" : "FAIL" }, null, 2));
      if (!rollbackPass) process.exitCode = 1;
      return;
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ mode: "PRODUCTION_APPLY", migration: FILENAME, before, after, checks, status: "PASS" }, null, 2));
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* best effort */ }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", reason: error.message }));
  process.exit(1);
});
