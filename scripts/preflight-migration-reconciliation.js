const db = require("../db");

const REQUIRED_SCHEMA = {
  user_kelas_scope: ["tenant_id", "user_id", "kelas_id"],
  wali_home_links: ["tenant_id", "title", "url", "type", "is_active", "sort_order"],
  platform_website_settings: ["id", "content", "published_content", "status"],
  tenant_domains: ["tenant_id", "hostname", "domain_type", "dns_managed", "dns_status", "vercel_status", "ssl_status", "overall_status"],
  mata_pelajaran: ["tenant_id", "nama", "aktif"],
  kelas_mata_pelajaran: ["tenant_id", "kelas_id", "mata_pelajaran_id", "urutan"],
  alumni: ["tenant_id", "santri_id", "nama", "status_kelulusan", "kelas_terakhir"],
  wali_akun: ["token_version"],
  santri: ["kamar"],
};

async function tableExists(client, table) {
  const result = await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [`public.${table}`]);
  return result.rows[0].present;
}

async function count(client, sql, params = []) {
  const result = await client.query(sql, params);
  return Number(result.rows[0]?.count || 0);
}

function add(results, name, value, severity, evidence = null) {
  results.push({ name, count: Number(value), severity, ...(evidence ? { evidence } : {}) });
}

async function run() {
  const client = await db.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const checks = [];

    const columns = await client.query(
      `SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='public'`,
    );
    const columnSet = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
    const missingSchema = [];
    for (const [table, requiredColumns] of Object.entries(REQUIRED_SCHEMA)) {
      if (!(await tableExists(client, table))) {
        missingSchema.push(`${table}.*`);
        continue;
      }
      for (const column of requiredColumns) {
        if (!columnSet.has(`${table}.${column}`)) missingSchema.push(`${table}.${column}`);
      }
    }

    add(checks, "missing_active_source_schema", missingSchema.length, "RECONCILIATION_REQUIRED", missingSchema);

    add(checks, "users_status_noncanonical", await count(client,
      `SELECT COUNT(*) FROM users WHERE status IS NULL OR status NOT IN ('Aktif','Nonaktif')`), "RECONCILIATION_REQUIRED");
    add(checks, "users_status_unknown", await count(client,
      `SELECT COUNT(*) FROM users WHERE status IS NULL OR LOWER(TRIM(status)) NOT IN ('aktif','active','nonaktif','inactive')`), "BLOCKER");
    add(checks, "guru_status_noncanonical", await count(client,
      `SELECT COUNT(*) FROM guru WHERE status IS NULL OR status NOT IN ('Aktif','Nonaktif')`), "RECONCILIATION_REQUIRED");
    add(checks, "guru_status_unknown", await count(client,
      `SELECT COUNT(*) FROM guru WHERE status IS NULL OR LOWER(TRIM(status)) NOT IN ('aktif','active','nonaktif','inactive')`), "BLOCKER");
    add(checks, "guru_name_null_or_blank", await count(client,
      `SELECT COUNT(*) FROM guru WHERE nama IS NULL OR TRIM(nama)=''`), "BLOCKER");

    add(checks, "absensi_duplicate_key", await count(client,
      `SELECT COUNT(*) FROM (SELECT santri_id,tanggal,sesi FROM absensi GROUP BY 1,2,3 HAVING COUNT(*)>1) duplicate_rows`), "BLOCKER");
    add(checks, "absensi_orphan_or_cross_tenant", await count(client,
      `SELECT COUNT(*) FROM absensi a LEFT JOIN santri s ON s.id=a.santri_id
       WHERE s.id IS NULL OR a.tenant_id IS DISTINCT FROM s.tenant_id`), "BLOCKER");
    add(checks, "absensi_guru_null_or_orphan_or_cross_tenant", await count(client,
      `SELECT COUNT(*) FROM absensi_guru ag LEFT JOIN guru g ON g.id=ag.guru_id
       WHERE ag.guru_id IS NULL OR ag.bulan IS NULL OR ag.tahun IS NULL OR g.id IS NULL
          OR ag.tenant_id IS DISTINCT FROM g.tenant_id`), "BLOCKER");
    add(checks, "absensi_guru_duplicate_key", await count(client,
      `SELECT COUNT(*) FROM (SELECT guru_id,bulan,tahun FROM absensi_guru GROUP BY 1,2,3 HAVING COUNT(*)>1) duplicate_rows`), "BLOCKER");

    add(checks, "wali_legacy_62_phone", await count(client,
      `SELECT COUNT(*) FROM wali_akun WHERE status='active' AND nomor_hp LIKE '62%'`), "RECONCILIATION_REQUIRED");
    add(checks, "wali_phone_normalization_collision", await count(client,
      `SELECT COUNT(*) FROM wali_akun source JOIN wali_akun target
       ON target.tenant_id=source.tenant_id
      AND target.nomor_hp='0'||SUBSTRING(source.nomor_hp FROM 3)
      AND target.id<>source.id AND target.status='active'
      WHERE source.status='active' AND source.nomor_hp LIKE '62%'`), "BLOCKER");
    add(checks, "wali_phone_without_account", await count(client,
      `SELECT COUNT(*) FROM (
         SELECT DISTINCT ws.tenant_id,ws.nomor_hp FROM wali_santri ws
         JOIN tenants t ON t.id=ws.tenant_id AND t.status='active'
         JOIN santri s ON s.id=ws.santri_id AND s.tenant_id=ws.tenant_id
         LEFT JOIN wali_akun wa ON wa.tenant_id=ws.tenant_id AND wa.nomor_hp=ws.nomor_hp
           AND wa.status='active'
         WHERE LOWER(TRIM(COALESCE(s.status,'')))='aktif'
           AND ws.nomor_hp IS NOT NULL AND TRIM(ws.nomor_hp)<>'' AND wa.id IS NULL
       ) missing_accounts`), "MANUAL_REVIEW");

    add(checks, "duplicate_canonical_unit_code", await count(client,
      `SELECT COUNT(*) FROM (
        SELECT tenant_id,CASE WHEN UPPER(TRIM(kode))='MADINAH' THEN 'MADIN' ELSE UPPER(TRIM(kode)) END code
        FROM unit_pendidikan GROUP BY 1,2 HAVING COUNT(*)>1
      ) duplicates`), "BLOCKER");
    add(checks, "madin_madinah_conflict", await count(client,
      `SELECT COUNT(*) FROM (
        SELECT tenant_id FROM unit_pendidikan WHERE UPPER(TRIM(kode)) IN ('MADIN','MADINAH')
        GROUP BY tenant_id HAVING COUNT(DISTINCT UPPER(TRIM(kode)))>1
      ) conflicts`), "BLOCKER");

    if (await tableExists(client, "user_kelas_scope")) {
      add(checks, "user_kelas_scope_orphan_or_cross_tenant", await count(client,
        `SELECT COUNT(*) FROM user_kelas_scope s
         LEFT JOIN users u ON u.id=s.user_id LEFT JOIN kelas k ON k.id=s.kelas_id
         WHERE u.id IS NULL OR k.id IS NULL OR s.tenant_id IS DISTINCT FROM u.tenant_id
            OR s.tenant_id IS DISTINCT FROM k.tenant_id`), "BLOCKER");
      add(checks, "user_kelas_scope_duplicate", await count(client,
        `SELECT COUNT(*) FROM (SELECT tenant_id,user_id,kelas_id FROM user_kelas_scope GROUP BY 1,2,3 HAVING COUNT(*)>1) d`), "BLOCKER");
    }

    if (await tableExists(client, "kelas_mata_pelajaran")) {
      add(checks, "kelas_mapel_orphan_or_cross_tenant", await count(client,
        `SELECT COUNT(*) FROM kelas_mata_pelajaran km
         LEFT JOIN kelas k ON k.id=km.kelas_id LEFT JOIN mata_pelajaran mp ON mp.id=km.mata_pelajaran_id
         WHERE k.id IS NULL OR mp.id IS NULL OR km.tenant_id IS DISTINCT FROM k.tenant_id
            OR km.tenant_id IS DISTINCT FROM mp.tenant_id`), "BLOCKER");
    }

    if (await tableExists(client, "alumni")) {
      add(checks, "alumni_orphan_or_cross_tenant", await count(client,
        `SELECT COUNT(*) FROM alumni a LEFT JOIN tenants t ON t.id=a.tenant_id
         LEFT JOIN santri s ON s.id=a.santri_id
         WHERE t.id IS NULL OR (a.santri_id IS NOT NULL AND (s.id IS NULL OR a.tenant_id IS DISTINCT FROM s.tenant_id))`), "BLOCKER");
      add(checks, "alumni_duplicate_santri", await count(client,
        `SELECT COUNT(*) FROM (SELECT tenant_id,santri_id FROM alumni WHERE santri_id IS NOT NULL GROUP BY 1,2 HAVING COUNT(*)>1) d`), "BLOCKER");
    }

    add(checks, "alumni_backfill_candidates", await count(client,
      `SELECT COUNT(*) FROM santri WHERE LOWER(TRIM(COALESCE(status,''))) IN ('lulus','keluar')`), "RECONCILIATION_REQUIRED");

    const expectedPermissionGrants = await count(client,
      `SELECT COUNT(*) FROM (VALUES
        ('superadmin','kesehatan.view'),('superadmin','kesehatan.manage'),
        ('superadmin','alumni.view'),('superadmin','alumni.manage'),
        ('superadmin','konten_pesantren.view'),('superadmin','konten_pesantren.manage'),
        ('superadmin','wallet.view'),('superadmin','wallet.manage'),
        ('sekretaris','alumni.view'),('sekretaris','alumni.manage'),
        ('sekretaris','konten_pesantren.view'),('sekretaris','konten_pesantren.manage'),
        ('pendidikan','wallet.view'),('pendidikan','wallet.manage'),
        ('keuangan','wallet.view'),('keuangan','wallet.manage')
      ) expected(role_name,permission_key)
      WHERE NOT EXISTS (
        SELECT 1 FROM roles r JOIN role_permissions rp ON rp.role_id=r.id
        JOIN permissions p ON p.id=rp.permission_id
        WHERE r.name=expected.role_name AND p.key=expected.permission_key
      )`);
    add(checks, "missing_active_permission_grants", expectedPermissionGrants, "RECONCILIATION_REQUIRED");
    add(checks, "pimpinan_unsafe_write_grants", await count(client,
      `SELECT COUNT(*) FROM role_permissions rp JOIN roles r ON r.id=rp.role_id
       JOIN permissions p ON p.id=rp.permission_id WHERE r.name='pimpinan_yayasan'
       AND (p.key LIKE '%.manage' OR p.key LIKE '%.create' OR p.key LIKE '%.update'
         OR p.key LIKE '%.delete' OR p.key IN ('role.manage','user.manage','rfid.manage'))`), "BLOCKER");

    if (await tableExists(client, "platform_settings")) {
      add(checks, "legacy_platform_brand", await count(client,
        `SELECT COUNT(*) FROM platform_settings WHERE id=1 AND settings->>'platform_name'='KlikSantri'`), "RECONCILIATION_REQUIRED");
    }

    const coreConstraintPresence = await client.query(`SELECT
      EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='absensi'::regclass AND contype='u'
        AND pg_get_constraintdef(oid)='UNIQUE (santri_id, tanggal, sesi)') AS absensi_unique,
      EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='guru'::regclass AND conname='guru_status_canonical_check') AS guru_status,
      EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='users'::regclass AND conname='users_status_canonical_check') AS users_status`);
    const missingCore = Object.values(coreConstraintPresence.rows[0]).filter((present) => !present).length;
    add(checks, "missing_canonical_core_constraints", missingCore, "RECONCILIATION_REQUIRED", coreConstraintPresence.rows[0]);

    await client.query("ROLLBACK");
    const blockers = checks.filter((item) => item.severity === "BLOCKER" && item.count > 0);
    const manual = checks.filter((item) => item.severity === "MANUAL_REVIEW" && item.count > 0);
    const required = checks.filter((item) => item.severity === "RECONCILIATION_REQUIRED" && item.count > 0);
    const status = blockers.length || manual.length
      ? "BLOCKED"
      : required.length ? "READY_FOR_RECONCILIATION" : "PASS";
    console.log(JSON.stringify({
      marker: "migration-reconciliation-preflight",
      mode: "READ_ONLY",
      status,
      active_source_dependencies: Object.keys(REQUIRED_SCHEMA),
      checks,
      blocker_count: blockers.length,
      manual_review_count: manual.length,
      reconciliation_required_count: required.length,
    }, null, 2));
    if (status === "BLOCKED") process.exitCode = 1;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* best effort */ }
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

run().catch((error) => {
  console.error(`[migration-reconciliation-preflight-error] ${error.message}`);
  process.exitCode = 1;
});
