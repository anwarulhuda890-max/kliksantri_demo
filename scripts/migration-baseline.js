const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const workspacePool = require("../db");
const { auditMigrations } = require("../utils/migrationBaselineAudit");

const MANIFEST_PATH = path.join(__dirname, "..", "docs", "migration-baseline-manifest.json");
const RECOMMENDATIONS = new Set([
  "BASELINE_AS_APPLIED", "APPLY_ORIGINAL", "APPLY_RECONCILIATION", "SUPERSEDED", "MANUAL_REVIEW",
]);

function loadManifest() {
  const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  if (!Array.isArray(parsed.migrations)) throw new Error("Manifest migrations tidak valid");
  return parsed;
}

function compare(manifest, current) {
  const currentByFile = new Map(current.map((item) => [item.filename, item]));
  const differences = [];
  for (const expected of manifest.migrations) {
    const actual = currentByFile.get(expected.filename);
    if (!actual) differences.push(`${expected.filename}: file/schema audit tidak ditemukan`);
    else {
      if (actual.checksum !== expected.checksum) differences.push(`${expected.filename}: CHECKSUM_DRIFT`);
      if (actual.status !== expected.status) differences.push(`${expected.filename}: status ${expected.status} -> ${actual.status}`);
      const recommendation = expected.recommendation || expected.recommended_action;
      if (!RECOMMENDATIONS.has(recommendation)) differences.push(`${expected.filename}: recommendation tidak valid/kosong`);
    }
  }
  for (const item of current) {
    if (!manifest.migrations.some((entry) => entry.filename === item.filename)) {
      differences.push(`${item.filename}: belum tercantum di manifest`);
    }
  }
  return differences;
}

function printSummary(migrations) {
  const counts = {};
  for (const item of migrations) counts[item.status] = (counts[item.status] || 0) + 1;
  console.log("Migration baseline summary:");
  for (const key of ["VERIFIED_APPLIED", "PARTIALLY_APPLIED", "NOT_APPLIED", "DRIFTED", "CANNOT_VERIFY"]) {
    console.log(`  ${key}: ${counts[key] || 0}`);
  }
}

async function check(pool = workspacePool) {
  const manifest = loadManifest();
  const current = await auditMigrations(pool);
  const differences = compare(manifest, current);
  printSummary(current);
  if (differences.length) {
    console.error("Baseline check gagal:");
    differences.forEach((item) => console.error(`  - ${item}`));
    const error = new Error("Manifest baseline tidak cocok dengan schema/checksum saat ini");
    error.exitCode = 1;
    throw error;
  }
  console.log("Baseline check cocok dengan manifest; tidak ada database write.");
  return { manifest, current };
}

async function plan(pool = workspacePool) {
  const result = await check(pool);
  const manifestByFile = new Map(result.manifest.migrations.map((item) => [item.filename, item]));
  const byRecommendation = (value) => result.current.filter((item) => {
    const rule = manifestByFile.get(item.filename);
    return (rule?.recommendation || rule?.recommended_action) === value;
  });
  const eligible = byRecommendation("BASELINE_AS_APPLIED");
  const superseded = byRecommendation("SUPERSEDED");
  const replaced = byRecommendation("APPLY_RECONCILIATION");
  const pending = byRecommendation("APPLY_ORIGINAL").sort((a, b) =>
    Number(manifestByFile.get(a.filename)?.execution_order || 9999)
      - Number(manifestByFile.get(b.filename)?.execution_order || 9999));
  const blockers = byRecommendation("MANUAL_REVIEW");
  console.log(`Eligible baseline setelah approval manual: ${eligible.length}`);
  console.log(`Superseded (tidak dijalankan/tidak dibaseline): ${superseded.length}`);
  console.log(`Digantikan reconciliation: ${replaced.length}`);
  console.log(`Apply original/new sesuai execution_order: ${pending.length}`);
  console.log(`Manual blocker: ${blockers.length}`);
  if (blockers.length) {
    console.log("Blocker:");
    blockers.forEach((item) => console.log(`  - ${item.filename}: MANUAL_REVIEW`));
  }
  if (pending.length) {
    console.log("Execution order setelah baseline:");
    pending.forEach((item) => console.log(`  - ${manifestByFile.get(item.filename)?.execution_order}: ${item.filename}`));
  }
  console.log("PLAN ONLY: schema_migrations tidak diubah.");
  return { ...result, eligible, blockers, pending, replaced, superseded };
}

async function applyBaseline() {
  if (!process.argv.includes("--confirm-production-baseline")) {
    throw new Error("Flag --confirm-production-baseline wajib untuk baseline apply");
  }
  const connectionString = String(process.env.DATABASE_URL || "").trim();
  const useWorkspaceDb = process.argv.includes("--confirm-workspace-db");
  if (!connectionString && !useWorkspaceDb) {
    throw new Error("DATABASE_URL atau flag eksplisit --confirm-workspace-db wajib untuk baseline apply");
  }
  const explicitPool = connectionString ? new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  }) : null;
  const targetPool = explicitPool || workspacePool;
  try {
    const target = await targetPool.query(
      `SELECT current_database() AS database,inet_server_addr()::text AS host`,
    );
    console.log(`Baseline target host: ${target.rows[0]?.host || "local-socket"}`);
    console.log(`Baseline target database: ${target.rows[0]?.database || "unknown"}`);
    const result = await plan(targetPool);
    if (result.blockers.length) {
      throw new Error("Baseline apply ditolak: manifest masih memiliki MANUAL_REVIEW");
    }
    console.log(`Migration yang akan dibaseline: ${result.eligible.length}`);
    const client = await targetPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) PRIMARY KEY,
        checksum CHAR(64) NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`);
      for (const migration of result.eligible) {
        await client.query(
          `INSERT INTO schema_migrations(filename, checksum) VALUES ($1,$2)`,
          [migration.filename, migration.checksum],
        );
      }
      await client.query("COMMIT");
      console.log("Baseline ledger selesai; SQL migration lama tidak dijalankan.");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } finally {
    if (explicitPool) await explicitPool.end();
    else await workspacePool.end();
  }
}

async function main() {
  const command = String(process.argv[2] || "check").toLowerCase();
  try {
    if (command === "check") await check();
    else if (command === "plan") await plan();
    else if (command === "apply") await applyBaseline();
    else throw new Error("Command harus check, plan, atau apply");
  } finally {
    if (command !== "apply") await workspacePool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = error.exitCode || 1;
  });
}

module.exports = { RECOMMENDATIONS, check, compare, loadManifest, plan, printSummary };
