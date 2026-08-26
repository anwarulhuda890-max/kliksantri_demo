const assert = require("assert");
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const pool = require("../db");
const {
  buildExportWorkbook,
  commitImport,
  listScopedAlumni,
  previewImport,
} = require("../services/alumniExcelService");
const { resolveAlumniUnit } = require("../services/alumniUnitScopeService");

function workbook(rows) {
  const headers = ["Nama Lengkap", "NIS", "Jenis Kelamin", "Tahun Masuk", "Tahun Lulus", "Angkatan", "Status Kelulusan", "Kelas Terakhir", "Kontak", "Alamat", "Pekerjaan", "Catatan"];
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Data Alumni");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" });
}

async function expectScopedError(promise, status, code) {
  await assert.rejects(promise, (error) => error.status === status && error.code === code);
}

async function main() {
  const client = await pool.connect();
  const suffix = `${Date.now()}`;
  const existingNis = `ZZ-ALUMNI-EXISTING-${suffix}`;
  const newNis = `ZZ-ALUMNI-NEW-${suffix}`;
  const migration = fs.readFileSync(path.join(__dirname, "..", "migrations", "084_alumni_unit_scope.sql"), "utf8");
  try {
    await client.query("BEGIN");
    await client.query(migration);
    const unit = (await client.query(
      `SELECT id, tenant_id, nama FROM unit_pendidikan WHERE is_active=true ORDER BY tenant_id,id LIMIT 1`,
    )).rows[0];
    assert(unit, "active unit fixture tidak tersedia");

    const backfill = await client.query(
      `SELECT COUNT(1)::int AS scoped,
              COUNT(1) FILTER (WHERE a.santri_id IS NULL)::int AS scoped_manual
       FROM alumni_units au JOIN alumni a ON a.tenant_id=au.tenant_id AND a.id=au.alumni_id`,
    );
    const legacyManual = await client.query(
      `SELECT COUNT(1)::int AS total FROM alumni a
       WHERE a.santri_id IS NULL AND NOT EXISTS (
         SELECT 1 FROM alumni_units au WHERE au.tenant_id=a.tenant_id AND au.alumni_id=a.id
       )`,
    );

    const insertedSantri = await client.query(
      `INSERT INTO santri (tenant_id,nama,nis,status)
       VALUES ($1,'Fixture Existing Alumni',$2,'aktif') RETURNING id`,
      [unit.tenant_id, existingNis],
    );
    const santriId = insertedSantri.rows[0].id;
    await client.query(
      `INSERT INTO santri_units (tenant_id,santri_id,unit_id,status,is_primary)
       VALUES ($1,$2,$3,'active',false)`,
      [unit.tenant_id, santriId, unit.id],
    );
    await client.query(
      `INSERT INTO alumni (tenant_id,nama,nis,status_kelulusan)
       VALUES ($1,'Fixture Existing Alumni',$2,'lulus')`,
      [unit.tenant_id, existingNis],
    );
    const membershipBefore = Number((await client.query(
      `SELECT COUNT(1) AS total FROM santri_units WHERE tenant_id=$1 AND santri_id=$2`,
      [unit.tenant_id, santriId],
    )).rows[0].total);

    const buffer = workbook([
      ["Fixture Existing Alumni", existingNis, "L", "2016", "2019", "2016", "lulus", "Kelas Akhir", "081200000001", "Alamat A", "", "existing"],
      ["Fixture New Alumni", newNis, "P", "2015", "2018", "2015", "lulus", "Kelas Lama", "081200000002", "Alamat B", "", "new"],
      ["Nama Konflik", existingNis, "L", "2017", "2020", "2017", "lulus", "Kelas Konflik", "", "", "", "conflict"],
      ["Fixture Invalid", "", "L", "2018", "", "", "lulus", "", "", "", "", "invalid"],
    ]);
    const firstPreview = await previewImport(unit.tenant_id, unit.id, buffer, client);
    assert.strictEqual(firstPreview.summary.EXISTING_SANTRI, 1);
    assert.strictEqual(firstPreview.summary.NEW_ALUMNI, 1);
    assert.strictEqual(firstPreview.summary.CONFLICT, 1);
    assert.strictEqual(firstPreview.summary.INVALID, 1);

    const firstCommit = await commitImport(
      unit.tenant_id,
      unit.id,
      firstPreview.rows.filter((row) => row.status === "valid"),
      client,
    );
    assert.strictEqual(firstCommit.imported, 2);
    assert.strictEqual(Number((await client.query(
      `SELECT COUNT(1) AS total FROM santri WHERE tenant_id=$1 AND nis=$2`,
      [unit.tenant_id, existingNis],
    )).rows[0].total), 1, "existing Santri identity terduplikasi");
    const linkedSnapshot = await client.query(
      `SELECT COUNT(1)::int AS total, COUNT(1) FILTER (WHERE santri_id=$3)::int AS linked
       FROM alumni WHERE tenant_id=$1 AND nis=$2`,
      [unit.tenant_id, existingNis, santriId],
    );
    assert.deepStrictEqual(linkedSnapshot.rows[0], { total: 1, linked: 1 }, "Alumni manual tidak direkonsiliasi ke Santri identity");
    assert.strictEqual(Number((await client.query(
      `SELECT COUNT(1) AS total FROM santri WHERE tenant_id=$1 AND nis=$2`,
      [unit.tenant_id, newNis],
    )).rows[0].total), 0, "manual Alumni membuat Santri identity baru");
    const membershipAfter = Number((await client.query(
      `SELECT COUNT(1) AS total FROM santri_units WHERE tenant_id=$1 AND santri_id=$2`,
      [unit.tenant_id, santriId],
    )).rows[0].total);
    assert.strictEqual(membershipAfter, membershipBefore, "import archival mengubah membership Santri aktif");

    const secondPreview = await previewImport(unit.tenant_id, unit.id, buffer, client);
    assert.strictEqual(secondPreview.summary.ALREADY_ALUMNI, 2);
    const retry = await commitImport(
      unit.tenant_id,
      unit.id,
      firstPreview.rows.filter((row) => row.status === "valid"),
      client,
    );
    assert.strictEqual(retry.imported, 0);
    assert.strictEqual(retry.summary.ALREADY_ALUMNI, 2);

    const filtered = await listScopedAlumni({ tenantId: unit.tenant_id, unitId: unit.id, search: "ZZ-ALUMNI-", client });
    assert.strictEqual(filtered.rows.length, 2);
    const yearFiltered = await listScopedAlumni({ tenantId: unit.tenant_id, unitId: unit.id, search: "ZZ-ALUMNI-", tahunLulus: 2018, client });
    assert.strictEqual(yearFiltered.rows.length, 1);
    const exportBuffer = buildExportWorkbook(filtered.rows);
    const exportBook = XLSX.read(exportBuffer, { type: "buffer" });
    const exportedRows = XLSX.utils.sheet_to_json(exportBook.Sheets[exportBook.SheetNames[0]], { defval: "" });
    assert.strictEqual(exportedRows.length, filtered.rows.length);

    const operator = (await client.query(
      `SELECT usr.id, usr.tenant_id, usr.role, scope.unit_id,
              (SELECT other.id FROM unit_pendidikan other
               WHERE other.tenant_id=usr.tenant_id AND other.is_active=true AND other.id<>scope.unit_id
               ORDER BY other.id LIMIT 1) AS foreign_unit_id
       FROM users usr JOIN user_unit_scope scope ON scope.user_id=usr.id AND scope.tenant_id=usr.tenant_id
       WHERE usr.role<>'superadmin' AND LOWER(COALESCE(scope.status,''))='active'
         AND LOWER(COALESCE(usr.status,'')) IN ('aktif','active')
       ORDER BY usr.id LIMIT 1`,
    )).rows[0];
    if (operator?.foreign_unit_id) {
      const user = { id: operator.id, tenant_id: operator.tenant_id, role: operator.role };
      const own = await resolveAlumniUnit({ tenantId: operator.tenant_id, user, query: { unit_id: operator.unit_id }, params: {}, body: {}, headers: {} }, client);
      assert.strictEqual(own.unitId, Number(operator.unit_id));
      await expectScopedError(
        resolveAlumniUnit({ tenantId: operator.tenant_id, user, query: { unit_id: operator.foreign_unit_id }, params: {}, body: {}, headers: {} }, client),
        403,
        "UNIT_ACCESS_DENIED",
      );
    }

    const superadmin = (await client.query(
      `SELECT id,tenant_id,role FROM users
       WHERE role='superadmin' AND LOWER(COALESCE(status,'')) IN ('aktif','active')
       ORDER BY id LIMIT 1`,
    )).rows[0];
    assert(superadmin, "superadmin fixture tidak tersedia");
    await expectScopedError(
      resolveAlumniUnit({ tenantId: superadmin.tenant_id, user: superadmin, query: { scope: "all" }, params: {}, body: {}, headers: {} }, client),
      400,
      "UNIT_REQUIRED",
    );

    console.log(JSON.stringify({
      migration: "PASS",
      backfilled_scoped_rows: backfill.rows[0].scoped,
      unscoped_legacy_manual_preserved: legacyManual.rows[0].total,
      classifications: firstPreview.summary,
      first_imported: firstCommit.imported,
      retry_imported: retry.imported,
      export_rows: exportedRows.length,
      year_filter_rows: yearFiltered.rows.length,
      identity_duplicate: 0,
      membership_mutation: 0,
      cross_unit: operator?.foreign_unit_id ? "403" : "NO_OPERATOR_FIXTURE",
      scope_all_write: "UNIT_REQUIRED",
      rollback: true,
    }, null, 2));
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
