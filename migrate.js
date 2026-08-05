require("dotenv").config();

const pool = require("./db");
const {
  applyMigrationPolicy,
  getMigrationStatus,
  ledgerExists,
  listMigrationFiles,
  printMigrationStatus,
  recordMigration,
  readMigration,
} = require("./utils/migrationLedger");

async function run() {
  const command = String(process.argv[2] || "up").trim().toLowerCase();
  const toFlagIndex = process.argv.indexOf("--to");
  const targetFilename = toFlagIndex >= 0 ? String(process.argv[toFlagIndex + 1] || "").trim() : null;
  const statusOnly = command === "status";
  const dryRun = command === "dry-run" || command === "dryrun";

  if (!["up", "status", "dry-run", "dryrun"].includes(command)) {
    throw new Error("Command migration harus: up, status, atau dry-run");
  }

  if (statusOnly || dryRun) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const status = applyMigrationPolicy(await getMigrationStatus(client));
      printMigrationStatus(status, { dryRun });
      if (status.some((item) => item.state === "drift")) process.exitCode = 1;
      await client.query("ROLLBACK");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch (_) { /* best effort only */ }
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  const hadLedger = await ledgerExists(pool);
  if (!hadLedger) {
    throw new Error(
      "schema_migrations belum ada. Jalankan audit/plan dan baseline berkonfirmasi; migration up tidak membuat ledger otomatis.",
    );
  }
  const status = applyMigrationPolicy(await getMigrationStatus(pool));
  const drift = status.filter((item) => item.state === "drift");
  if (drift.length) {
    throw new Error(
      `Checksum migration berubah setelah applied: ${drift.map((item) => item.filename).join(", ")}`,
    );
  }

  const blocked = status.filter((item) => ["blocked", "baseline-missing"].includes(item.state));
  if (blocked.length) {
    throw new Error(
      `Migration plan diblokir policy: ${blocked.map((item) => `${item.filename}:${item.state}`).join(", ")}`,
    );
  }

  let pending = status
    .filter((item) => item.state === "pending")
    .sort((a, b) => a.execution_order - b.execution_order || a.filename.localeCompare(b.filename));
  if (targetFilename) {
    const targetIndex = pending.findIndex((item) => item.filename === targetFilename);
    if (targetIndex < 0) {
      throw new Error(`Target --to tidak ditemukan dalam execution plan pending: ${targetFilename}`);
    }
    pending = pending.slice(0, targetIndex + 1);
    console.log(`Migration target: ${targetFilename}`);
  }
  if (!pending.length) {
    console.log("Tidak ada migration pending.");
    return;
  }

  for (const item of pending) {
    const migration = readMigration(item.filename);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migration.executionSql);
      await recordMigration(client, migration);
      await client.query("COMMIT");
      console.log(`APPLIED ${item.filename}`);
    } catch (error) {
      await client.query("ROLLBACK");
      error.message = `Migration gagal (${item.filename}): ${error.message}`;
      throw error;
    } finally {
      client.release();
    }
  }
}

run()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
