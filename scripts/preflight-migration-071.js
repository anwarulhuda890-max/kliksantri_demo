const db = require("../db");

async function count(client, sql) {
  const { rows } = await client.query(sql);
  return Number(rows[0]?.count || 0);
}

async function run() {
  const client = await db.connect();
  try {
    await client.query("BEGIN READ ONLY");
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
          AND NOT EXISTS (SELECT 1 FROM santri_units su WHERE su.tenant_id=s.tenant_id AND su.santri_id=s.id)`),
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
    const blockers = [
      "invalid_or_cross_tenant_class",
      "duplicate_active_membership",
      "duplicate_active_primary",
      "multiple_active_enrollments",
      "cross_unit_enrollment",
    ].filter((key) => checks[key] > 0);
    console.log(JSON.stringify({
      marker: "multi-unit-migration-071-preflight",
      mode: "READ_ONLY",
      checks,
      review_required: checks.missing_legacy_class_review,
      blockers,
      status: blockers.length ? "BLOCKED" : "READY_FOR_CLONE_REHEARSAL",
    }, null, 2));
    await client.query("ROLLBACK");
    if (blockers.length) process.exitCode = 1;
  } finally {
    client.release();
    await db.end();
  }
}

run().catch((error) => {
  console.error("[multi-unit-migration-071-preflight]", error.code || error.message);
  process.exitCode = 1;
});
