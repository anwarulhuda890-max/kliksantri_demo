const pool = require("../db");
const { readMigration, recordMigration } = require("../utils/migrationLedger");

const FILENAME = "085_wallet_transaction_correction_audit.sql";

async function snapshot(client) {
  const exists = (await client.query(
    "SELECT to_regclass('public.wallet_transaction_correction_audits') IS NOT NULL AS value",
  )).rows[0].value;
  return {
    table_exists: exists,
    audit_rows: exists
      ? Number((await client.query("SELECT COUNT(*) AS value FROM wallet_transaction_correction_audits")).rows[0].value)
      : 0,
    wallet_transaction_rows: Number((await client.query("SELECT COUNT(*) AS value FROM wallet_transactions")).rows[0].value),
    wallet_transaction_hash: (await client.query(
      `SELECT MD5(COALESCE(STRING_AGG(ROW_TO_JSON(snapshot)::text, '|' ORDER BY id), '')) AS value
       FROM (SELECT * FROM wallet_transactions ORDER BY id) snapshot`,
    )).rows[0].value,
    wallet_balance_hash: (await client.query(
      `SELECT MD5(COALESCE(STRING_AGG(ROW_TO_JSON(snapshot)::text, '|' ORDER BY id), '')) AS value
       FROM (SELECT id,current_balance,updated_at FROM wallet_accounts ORDER BY id) snapshot`,
    )).rows[0].value,
    ledger_085: Number((await client.query(
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
    if (before.table_exists || before.ledger_085) {
      throw new Error(`BASELINE_NOT_CURRENT:${JSON.stringify(before)}`);
    }
    await client.query("BEGIN");
    const migration = readMigration(FILENAME);
    await client.query(migration.executionSql);
    await recordMigration(client, migration);
    const after = await snapshot(client);
    const checks = {
      table_created: after.table_exists,
      audit_empty: after.audit_rows === 0,
      wallet_rows_preserved: after.wallet_transaction_rows === before.wallet_transaction_rows,
      wallet_transactions_unchanged: after.wallet_transaction_hash === before.wallet_transaction_hash,
      wallet_balances_unchanged: after.wallet_balance_hash === before.wallet_balance_hash,
      ledger_recorded: after.ledger_085 === 1,
    };
    if (Object.values(checks).some((value) => !value)) {
      throw new Error(`PRODUCTION_CHECK_FAILED:${JSON.stringify(checks)}`);
    }
    if (rollbackRehearsal) {
      await client.query("ROLLBACK");
      const rollback = await snapshot(client);
      const rollbackPass = !rollback.table_exists
        && rollback.ledger_085 === 0
        && rollback.wallet_transaction_hash === before.wallet_transaction_hash
        && rollback.wallet_balance_hash === before.wallet_balance_hash;
      console.log(JSON.stringify({
        mode: "PRODUCTION_ROLLBACK_REHEARSAL", before, after, checks,
        rollback: rollbackPass ? "PASS" : "FAIL",
      }, null, 2));
      if (!rollbackPass) process.exitCode = 1;
      return;
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({
      mode: "PRODUCTION_APPLY", migration: FILENAME, before, after, checks, status: "PASS",
    }, null, 2));
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
