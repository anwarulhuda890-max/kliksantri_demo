const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { execFileSync } = require("child_process");
const dotenv = require("dotenv");
const { Client } = require("pg");

const ROOT = path.join(__dirname, "..");
const ENV_PATH = path.join(ROOT, ".env.rehearsal");

function guardedConnectionString() {
  if (!fs.existsSync(ENV_PATH)) throw new Error(".env.rehearsal tidak tersedia");
  try {
    execFileSync("git", ["check-ignore", "--quiet", "--", ".env.rehearsal"], {
      cwd: ROOT,
      stdio: "ignore",
    });
  } catch (_) {
    throw new Error(".env.rehearsal tidak diabaikan Git");
  }
  const env = dotenv.parse(fs.readFileSync(ENV_PATH));
  const connectionString = String(env.DATABASE_URL || "").trim();
  const expected = String(env.EXPECTED_REHEARSAL_ENDPOINT_ID || "").trim().toLowerCase();
  if (!connectionString || !/^ep-[a-z0-9-]+$/.test(expected)) throw new Error("Guard rehearsal tidak lengkap");
  const hostname = new URL(connectionString).hostname.toLowerCase();
  if (!hostname.endsWith(".neon.tech")
      || !(hostname.startsWith(`${expected}.`) || hostname.startsWith(`${expected}-pooler.`))) {
    throw new Error("Endpoint bukan clone rehearsal yang diharapkan");
  }
  return connectionString;
}

function migrationBody(filename) {
  return fs.readFileSync(path.join(ROOT, "migrations", filename), "utf8")
    .replace(/^\s*BEGIN\s*;\s*/i, "")
    .replace(/\s*COMMIT\s*;\s*$/i, "");
}

async function present(client, table) {
  const result = await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [`public.${table}`]);
  return result.rows[0].present;
}

async function count(client, sql) {
  const result = await client.query(sql);
  return Number(result.rows[0]?.count || 0);
}

async function grouped(client, sql) {
  const result = await client.query(sql);
  return result.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    /^\d+$/.test(String(value)) ? Number(value) : value,
  ])));
}

async function preflight071(client) {
  const checks = {
    deterministic_memberships_to_backfill: await count(client, `
      SELECT COUNT(*) FROM santri s
      JOIN kelas k ON k.id=s.kelas_id AND k.tenant_id=s.tenant_id
      WHERE NOT EXISTS (
        SELECT 1 FROM santri_units su
        WHERE su.tenant_id=s.tenant_id AND su.santri_id=s.id AND su.unit_id=k.unit_id
      )`),
    missing_legacy_class_review: await count(client, `
      SELECT COUNT(*) FROM santri s
      WHERE s.kelas_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM santri_units su WHERE su.tenant_id=s.tenant_id AND su.santri_id=s.id
        )`),
    invalid_or_cross_tenant_class: await count(client, `
      SELECT COUNT(*) FROM santri s
      LEFT JOIN kelas k ON k.id=s.kelas_id AND k.tenant_id=s.tenant_id
      WHERE s.kelas_id IS NOT NULL AND k.id IS NULL`),
    duplicate_active_membership: await count(client, `
      SELECT COUNT(*) FROM (
        SELECT tenant_id,santri_id,unit_id FROM santri_units
        WHERE status='active' AND left_at IS NULL GROUP BY 1,2,3 HAVING COUNT(*)>1
      ) duplicate_rows`),
    duplicate_active_primary: await count(client, `
      SELECT COUNT(*) FROM (
        SELECT tenant_id,santri_id FROM santri_units
        WHERE status='active' AND left_at IS NULL AND is_primary=true GROUP BY 1,2 HAVING COUNT(*)>1
      ) duplicate_rows`),
    multiple_active_enrollments: await count(client, `
      SELECT COUNT(*) FROM (
        SELECT tenant_id,santri_unit_id FROM santri_kelas_enrollments
        WHERE status='active' AND end_date IS NULL GROUP BY 1,2 HAVING COUNT(*)>1
      ) duplicate_rows`),
    cross_unit_enrollment: await count(client, `
      SELECT COUNT(*) FROM santri_kelas_enrollments e
      JOIN santri_units su ON su.id=e.santri_unit_id AND su.tenant_id=e.tenant_id
      JOIN kelas k ON k.id=e.kelas_id AND k.tenant_id=e.tenant_id
      WHERE su.unit_id<>k.unit_id`),
  };
  const blockerNames = [
    "invalid_or_cross_tenant_class",
    "duplicate_active_membership",
    "duplicate_active_primary",
    "multiple_active_enrollments",
    "cross_unit_enrollment",
  ].filter((name) => checks[name] > 0);
  return { checks, blockers: blockerNames, status: blockerNames.length ? "BLOCKED" : "PASS" };
}

async function snapshot(client) {
  const hasMembership = await present(client, "santri_units");
  const hasEnrollment = await present(client, "santri_kelas_enrollments");
  const hasReview = await present(client, "multi_unit_backfill_review");
  const totalSantri = await count(client, "SELECT COUNT(*) FROM santri");
  const crossTenantMembership = hasMembership ? await count(client, `
    SELECT COUNT(*) FROM santri_units su
    LEFT JOIN santri s ON s.id=su.santri_id
    LEFT JOIN unit_pendidikan u ON u.id=su.unit_id
    WHERE s.id IS NULL OR u.id IS NULL
       OR s.tenant_id IS DISTINCT FROM su.tenant_id
       OR u.tenant_id IS DISTINCT FROM su.tenant_id`) : 0;
  const crossTenantEnrollment = hasEnrollment ? await count(client, `
    SELECT COUNT(*) FROM santri_kelas_enrollments e
    LEFT JOIN santri_units su ON su.id=e.santri_unit_id
    LEFT JOIN kelas k ON k.id=e.kelas_id
    WHERE su.id IS NULL OR k.id IS NULL
       OR su.tenant_id IS DISTINCT FROM e.tenant_id
       OR k.tenant_id IS DISTINCT FROM e.tenant_id`) : 0;
  return {
    table_presence: {
      santri_units: hasMembership,
      santri_kelas_enrollments: hasEnrollment,
      multi_unit_backfill_review: hasReview,
    },
    total_santri: totalSantri,
    unique_individuals: await count(client, "SELECT COUNT(DISTINCT (tenant_id,id)) FROM santri"),
    membership: hasMembership ? await count(client, "SELECT COUNT(*) FROM santri_units") : 0,
    membership_per_unit: hasMembership ? await grouped(client,
      "SELECT tenant_id,unit_id,COUNT(*)::integer AS count FROM santri_units GROUP BY 1,2 ORDER BY 1,2") : [],
    enrollment: hasEnrollment ? await count(client, "SELECT COUNT(*) FROM santri_kelas_enrollments") : 0,
    enrollment_per_class: hasEnrollment ? await grouped(client,
      "SELECT tenant_id,kelas_id,COUNT(*)::integer AS count FROM santri_kelas_enrollments GROUP BY 1,2 ORDER BY 1,2") : [],
    santri_without_membership: hasMembership ? await count(client, `
      SELECT COUNT(*) FROM santri s WHERE NOT EXISTS (
        SELECT 1 FROM santri_units su WHERE su.tenant_id=s.tenant_id AND su.santri_id=s.id
      )`) : totalSantri,
    duplicate_membership: hasMembership ? await count(client, `
      SELECT COUNT(*) FROM (
        SELECT tenant_id,santri_id,unit_id FROM santri_units
        WHERE status='active' AND left_at IS NULL GROUP BY 1,2,3 HAVING COUNT(*)>1
      ) duplicate_rows`) : 0,
    review_required: hasReview ? await count(client,
      "SELECT COUNT(*) FROM multi_unit_backfill_review WHERE status='REVIEW_REQUIRED'") : 0,
    cross_unit_enrollment: hasEnrollment ? await count(client, `
      SELECT COUNT(*) FROM santri_kelas_enrollments e
      JOIN santri_units su ON su.id=e.santri_unit_id AND su.tenant_id=e.tenant_id
      JOIN kelas k ON k.id=e.kelas_id AND k.tenant_id=e.tenant_id
      WHERE su.unit_id<>k.unit_id`) : 0,
    cross_tenant_relation: crossTenantMembership + crossTenantEnrollment,
  };
}

async function run() {
  const client = new Client({
    connectionString: guardedConnectionString(),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 12000,
  });
  await client.connect();
  let transactionOpen = false;
  try {
    const before = await snapshot(client);
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query(migrationBody("064_multi_unit_foundation.sql"));
    const preflight071Before = await preflight071(client);
    assert.equal(preflight071Before.status, "PASS");
    await client.query(migrationBody("071_backfill_canonical_santri_unit_membership.sql"));
    await client.query(migrationBody("071_backfill_canonical_santri_unit_membership.sql"));
    const preflight071After = await preflight071(client);
    assert.equal(preflight071After.status, "PASS");
    const after = await snapshot(client);
    assert.equal(after.table_presence.santri_units, true);
    assert.equal(after.table_presence.santri_kelas_enrollments, true);
    assert.equal(after.table_presence.multi_unit_backfill_review, true);
    assert.equal(after.total_santri, before.total_santri);
    assert.equal(after.unique_individuals, before.unique_individuals);
    assert.equal(after.santri_without_membership, after.review_required);
    assert.equal(after.duplicate_membership, 0);
    assert.equal(after.cross_unit_enrollment, 0);
    assert.equal(after.cross_tenant_relation, 0);
    await client.query("ROLLBACK");
    transactionOpen = false;
    const persisted = await snapshot(client);
    assert.deepEqual(persisted, before);
    console.log(JSON.stringify({
      marker: "migration-064-071-neon-clone-rehearsal",
      target: "VERIFIED_REHEARSAL_ENDPOINT",
      migration_064_applied_in_transaction: true,
      preflight_071_after_064: preflight071Before,
      migration_071_applied_twice_for_idempotency: true,
      preflight_071_after_backfill: preflight071After,
      before,
      after,
      rollback_preserved_before_state: true,
      status: "PASS",
    }, null, 2));
  } catch (error) {
    if (transactionOpen) {
      try { await client.query("ROLLBACK"); } catch (_) { /* best effort */ }
    }
    throw error;
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(JSON.stringify({
    marker: "migration-064-071-neon-clone-rehearsal",
    status: "FAIL",
    code: error.code || null,
    error: error.message,
  }, null, 2));
  process.exitCode = 1;
});
