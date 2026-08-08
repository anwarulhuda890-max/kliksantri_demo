const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const db = require("../db");

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const migrationPath = path.join(__dirname, "../migrations/071_backfill_canonical_santri_unit_membership.sql");
const migrationSql = fs.readFileSync(migrationPath, "utf8")
  .replace(/^\s*BEGIN\s*;/i, "")
  .replace(/COMMIT\s*;\s*$/i, "");

function requireLocalClone() {
  const host = String(process.env.DB_HOST || "").trim().toLowerCase();
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error("Rehearsal migration 071 hanya boleh dijalankan pada PostgreSQL lokal/clone");
  }
}

async function scalar(client, sql) {
  const { rows } = await client.query(sql);
  return Number(rows[0]?.count || 0);
}

async function grouped(client, sql) {
  const { rows } = await client.query(sql);
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, /^\d+$/.test(String(value)) ? Number(value) : value]),
  ));
}

async function reviewCount(client) {
  const exists = await client.query("SELECT to_regclass('public.multi_unit_backfill_review') IS NOT NULL AS present");
  if (!exists.rows[0]?.present) return 0;
  return scalar(client, "SELECT COUNT(*) FROM multi_unit_backfill_review WHERE status='REVIEW_REQUIRED'");
}

async function snapshot(client) {
  return {
    total_santri_per_tenant: await grouped(client, `
      SELECT tenant_id,COUNT(*)::integer AS count FROM santri GROUP BY tenant_id ORDER BY tenant_id`),
    unique_individuals_per_tenant: await grouped(client, `
      SELECT tenant_id,COUNT(DISTINCT id)::integer AS count FROM santri GROUP BY tenant_id ORDER BY tenant_id`),
    memberships_per_unit: await grouped(client, `
      SELECT tenant_id,unit_id,COUNT(*)::integer AS count
      FROM santri_units GROUP BY tenant_id,unit_id ORDER BY tenant_id,unit_id`),
    enrollments_per_class: await grouped(client, `
      SELECT e.tenant_id,e.kelas_id,COUNT(*)::integer AS count
      FROM santri_kelas_enrollments e GROUP BY e.tenant_id,e.kelas_id ORDER BY e.tenant_id,e.kelas_id`),
    santri_without_membership: await scalar(client, `
      SELECT COUNT(*) FROM santri s WHERE NOT EXISTS (
        SELECT 1 FROM santri_units su WHERE su.tenant_id=s.tenant_id AND su.santri_id=s.id
      )`),
    duplicate_active_membership: await scalar(client, `
      SELECT COUNT(*) FROM (
        SELECT tenant_id,santri_id,unit_id FROM santri_units
        WHERE status='active' AND left_at IS NULL GROUP BY 1,2,3 HAVING COUNT(*)>1
      ) duplicate_rows`),
    cross_unit_enrollment: await scalar(client, `
      SELECT COUNT(*) FROM santri_kelas_enrollments e
      JOIN santri_units su ON su.id=e.santri_unit_id AND su.tenant_id=e.tenant_id
      JOIN kelas k ON k.id=e.kelas_id AND k.tenant_id=e.tenant_id
      WHERE su.unit_id<>k.unit_id`),
    cross_tenant_relation: await scalar(client, `
      SELECT COUNT(*) FROM santri_units su
      LEFT JOIN santri s ON s.id=su.santri_id
      LEFT JOIN unit_pendidikan u ON u.id=su.unit_id
      WHERE s.id IS NULL OR u.id IS NULL
         OR s.tenant_id IS DISTINCT FROM su.tenant_id
         OR u.tenant_id IS DISTINCT FROM su.tenant_id`),
    review_required: await reviewCount(client),
  };
}

async function run() {
  requireLocalClone();
  const client = await db.connect();
  let before;
  try {
    before = await snapshot(client);
    await client.query("BEGIN");
    await client.query(migrationSql);
    await client.query(migrationSql);
    const after = await snapshot(client);

    assert.deepEqual(after.total_santri_per_tenant, before.total_santri_per_tenant, "migration must preserve santri counts");
    assert.deepEqual(after.unique_individuals_per_tenant, before.unique_individuals_per_tenant, "migration must preserve unique identities");
    assert.equal(after.santri_without_membership, after.review_required, "only REVIEW_REQUIRED santri may remain without membership");
    assert.equal(after.duplicate_active_membership, 0);
    assert.equal(after.cross_unit_enrollment, 0);
    assert.equal(after.cross_tenant_relation, 0);

    await client.query("ROLLBACK");
    const persisted = await snapshot(client);
    assert.deepEqual(persisted, before, "rollback rehearsal must leave local clone unchanged");
    console.log(JSON.stringify({
      marker: "migration-071-clone-rehearsal",
      target: "LOCAL_CLONE",
      applied_twice: true,
      before,
      after,
      rollback_preserved_before_state: true,
      status: "PASS",
    }, null, 2));
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* best effort */ }
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

run().catch((error) => {
  console.error("[migration-071-clone-rehearsal]", error.code || error.message);
  process.exitCode = 1;
});
