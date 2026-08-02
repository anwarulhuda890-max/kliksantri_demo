/**
 * Smoke test — Step 2E tenant isolation (pendidikan & keamanan)
 * Usage: node scripts/smoke-step2e-tenant-isolation.js
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("../db");

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3002";
const TEST_SLUG = "tenant-test-2e";
const MARKER = "SMOKE-2E";

let passed = 0;
let failed = 0;

function ok(label) {
  passed++;
  console.log("  PASS:", label);
}

function fail(label, detail) {
  failed++;
  console.error("  FAIL:", label, detail !== undefined ? detail : "");
}

async function fetchJson(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, opts);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function login(username, password, tenantSlug) {
  const { body } = await fetchJson("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, tenant_slug: tenantSlug }),
  });
  if (!body.token) throw new Error(`Login fail ${username}@${tenantSlug}`);
  return body;
}

async function ensureFixtures() {
  const { rows: def } = await pool.query(`SELECT id FROM tenants WHERE slug = 'default'`);
  await pool.query(
    `INSERT INTO tenants (slug, nama, status)
     VALUES ($1, 'Pesantren Test 2E', 'active')
     ON CONFLICT (slug) DO NOTHING`,
    [TEST_SLUG]
  );
  const { rows: testT } = await pool.query(`SELECT id FROM tenants WHERE slug = $1`, [TEST_SLUG]);
  const testTenantId = testT[0].id;
  const defaultTenantId = def[0].id;

  const hash = await bcrypt.hash("test1234", 10);
  const existing = await pool.query(`SELECT id FROM users WHERE username = 'admin_test_2e'`);
  if (!existing.rows.length) {
    await pool.query(
      `INSERT INTO users (nama, username, password, role, status, tenant_id)
       VALUES ('Admin Test 2E', 'admin_test_2e', $1, 'superadmin', 'Aktif', $2)`,
      [hash, testTenantId]
    );
  } else {
    await pool.query(
      `UPDATE users SET tenant_id = $1, password = $2 WHERE username = 'admin_test_2e'`,
      [testTenantId, hash]
    );
  }

  await pool.query(`DELETE FROM absensi WHERE tenant_id = $1 AND sesi LIKE $2`, [testTenantId, `${MARKER}-%`]);
  await pool.query(`DELETE FROM tamu WHERE tenant_id = $1 AND nama_tamu LIKE $2`, [testTenantId, `${MARKER}-%`]);
  await pool.query(`DELETE FROM pengumuman WHERE tenant_id = $1 AND judul LIKE $2`, [testTenantId, `${MARKER}-%`]);
  await pool.query(`DELETE FROM pelanggaran WHERE tenant_id = $1 AND jenis LIKE $2`, [testTenantId, `${MARKER}-%`]);
  await pool.query(`DELETE FROM perizinan WHERE tenant_id = $1 AND alasan LIKE $2`, [testTenantId, `${MARKER}-%`]);
  await pool.query(`DELETE FROM kesehatan_santri WHERE tenant_id = $1 AND keluhan LIKE $2`, [testTenantId, `${MARKER}-%`]);
  await pool.query(`DELETE FROM hafalan WHERE tenant_id = $1 AND kitab LIKE $2`, [testTenantId, `${MARKER}-%`]);
  await pool.query(`DELETE FROM nilai_mingguan WHERE tenant_id = $1 AND mapel LIKE $2`, [testTenantId, `${MARKER}-%`]);

  let { rows: santriTest } = await pool.query(
    `SELECT id FROM santri WHERE tenant_id = $1 LIMIT 1`,
    [testTenantId]
  );
  let testSantriId = santriTest[0]?.id;
  if (!testSantriId) {
    const ins = await pool.query(
      `INSERT INTO santri (nis, nama, tenant_id, status)
       VALUES ($1, 'Santri Test 2E', $2, 'aktif') RETURNING id`,
      [`SMOKE2E-${Date.now()}`, testTenantId]
    );
    testSantriId = ins.rows[0].id;
  }

  let { rows: guruTest } = await pool.query(
    `SELECT id FROM guru WHERE tenant_id = $1 LIMIT 1`,
    [testTenantId]
  );
  let testGuruId = guruTest[0]?.id;
  if (!testGuruId) {
    const ins = await pool.query(
      `INSERT INTO guru (nama, jabatan, tenant_id)
       VALUES ('Guru Test 2E', 'Ustadz', $1) RETURNING id`,
      [testTenantId]
    );
    testGuruId = ins.rows[0].id;
  }

  const { rows: santriDef } = await pool.query(
    `SELECT id FROM santri WHERE tenant_id = $1 LIMIT 1`,
    [defaultTenantId]
  );
  const defaultSantriId = santriDef[0]?.id;

  const { rows: guruDef } = await pool.query(
    `SELECT id FROM guru WHERE tenant_id = $1 LIMIT 1`,
    [defaultTenantId]
  );
  const defaultGuruId = guruDef[0]?.id;

  const bulan = new Date().getMonth() + 1;
  const tahun = new Date().getFullYear();
  const today = new Date().toISOString().split("T")[0];

  const absIns = await pool.query(
    `INSERT INTO absensi (santri_id, tanggal, sesi, status, tenant_id)
     VALUES ($1, $2, $3, 'Hadir', $4)
     ON CONFLICT (santri_id, tanggal, sesi) DO UPDATE SET status = EXCLUDED.status
     RETURNING id`,
    [testSantriId, today, `${MARKER}-SESI`, testTenantId]
  );

  const tamuIns = await pool.query(
    `INSERT INTO tamu (nama_tamu, tujuan, petugas, tenant_id)
     VALUES ($1, 'Test', 'smoke', $2) RETURNING id`,
    [`${MARKER}-TAMU`, testTenantId]
  );

  const pengIns = await pool.query(
    `INSERT INTO pengumuman (judul, isi, tenant_id, is_active)
     VALUES ($1, 'isi smoke', $2, true) RETURNING id`,
    [`${MARKER}-PENGUMUMAN`, testTenantId]
  );

  const pelIns = await pool.query(
    `INSERT INTO pelanggaran (santri_id, tanggal, jenis, poin, tenant_id)
     VALUES ($1, CURRENT_DATE, $2, 5, $3) RETURNING id`,
    [testSantriId, `${MARKER}-PELANGGARAN`, testTenantId]
  );

  const izinIns = await pool.query(
    `INSERT INTO perizinan (santri_id, tanggal, alasan, status, tenant_id)
     VALUES ($1, CURRENT_DATE, $2, 'keluar', $3) RETURNING id`,
    [testSantriId, `${MARKER}-IZIN`, testTenantId]
  );

  const kesIns = await pool.query(
    `INSERT INTO kesehatan_santri (santri_id, status_kesehatan, keluhan, tindakan_pertama, tenant_id)
     VALUES ($1, 'sakit', $2, 'istirahat', $3) RETURNING id`,
    [testSantriId, `${MARKER}-KES`, testTenantId]
  );

  const hafIns = await pool.query(
    `INSERT INTO hafalan (santri_id, tanggal, kitab, bulan, tahun, pekan, tenant_id)
     VALUES ($1, CURRENT_DATE, $2, $3, $4, 1, $5) RETURNING id`,
    [testSantriId, `${MARKER}-HAFALAN`, bulan, tahun, testTenantId]
  );

  const nilaiIns = await pool.query(
    `INSERT INTO nilai_mingguan (santri_id, tanggal, mapel, nilai, bulan, tahun, tenant_id)
     VALUES ($1, CURRENT_DATE, $2, 90, $3, $4, $5) RETURNING id`,
    [testSantriId, `${MARKER}-MAPEL`, bulan, tahun, testTenantId]
  );

  const agIns = await pool.query(
    `INSERT INTO absensi_guru (guru_id, bulan, tahun, total_hadir, tenant_id)
     VALUES ($1, $2, $3, 20, $4)
     ON CONFLICT (guru_id, bulan, tahun) DO UPDATE SET total_hadir = EXCLUDED.total_hadir
     RETURNING id`,
    [testGuruId, bulan, tahun, testTenantId]
  );

  return {
    defaultTenantId,
    testTenantId,
    testSantriId,
    defaultSantriId,
    testGuruId,
    defaultGuruId,
    absId: absIns.rows[0].id,
    tamuId: tamuIns.rows[0].id,
    pengId: pengIns.rows[0].id,
    pelId: pelIns.rows[0].id,
    izinId: izinIns.rows[0].id,
    kesId: kesIns.rows[0].id,
    hafId: hafIns.rows[0].id,
    nilaiId: nilaiIns.rows[0].id,
    agId: agIns.rows[0].id,
    bulan,
    tahun,
  };
}

async function run() {
  console.log("=== Smoke: Step 2E Tenant Isolation (Pendidikan & Keamanan) ===\n");

  const fx = await ensureFixtures();
  ok("Fixtures ready");

  const defaultAuth = await login("admin", "admin123", "default");
  const testAuth = await login("admin_test_2e", "test1234", TEST_SLUG);
  const hDef = { Authorization: `Bearer ${defaultAuth.token}` };
  const hTest = { Authorization: `Bearer ${testAuth.token}` };

  const absDef = await fetchJson("/absensi", { headers: hDef });
  const absTest = await fetchJson("/absensi", { headers: hTest });
  if (
    absTest.res.status === 200 &&
    !(absDef.body.data || []).some((r) => String(r.sesi || "").startsWith(MARKER)) &&
    (absTest.body.data || []).some((r) => String(r.sesi || "").startsWith(MARKER))
  ) {
    ok("GET /absensi read isolation");
  } else fail("GET /absensi read isolation");

  const tamuDef = await fetchJson("/tamu", { headers: hDef });
  const tamuTest = await fetchJson("/tamu", { headers: hTest });
  if (
    tamuTest.res.status === 200 &&
    !(tamuDef.body.data || []).some((r) => String(r.nama_tamu || "").startsWith(MARKER)) &&
    (tamuTest.body.data || []).some((r) => String(r.nama_tamu || "").startsWith(MARKER))
  ) {
    ok("GET /tamu read isolation");
  } else fail("GET /tamu read isolation");

  const pengDef = await fetchJson("/pengumuman", { headers: hDef });
  const pengTest = await fetchJson("/pengumuman", { headers: hTest });
  if (
    pengTest.res.status === 200 &&
    !(pengDef.body.data || []).some((r) => String(r.judul || "").startsWith(MARKER)) &&
    (pengTest.body.data || []).some((r) => String(r.judul || "").startsWith(MARKER))
  ) {
    ok("GET /pengumuman read isolation");
  } else fail("GET /pengumuman read isolation");

  const pelDef = await fetchJson("/pelanggaran", { headers: hDef });
  const pelTest = await fetchJson("/pelanggaran", { headers: hTest });
  if (
    pelTest.res.status === 200 &&
    !(pelDef.body.data || []).some((r) => String(r.jenis || "").startsWith(MARKER)) &&
    (pelTest.body.data || []).some((r) => String(r.jenis || "").startsWith(MARKER))
  ) {
    ok("GET /pelanggaran read isolation");
  } else fail("GET /pelanggaran read isolation");

  const izinDef = await fetchJson("/perizinan", { headers: hDef });
  const izinTest = await fetchJson("/perizinan", { headers: hTest });
  if (
    izinTest.res.status === 200 &&
    !(izinDef.body.data || []).some((r) => String(r.alasan || "").startsWith(MARKER)) &&
    (izinTest.body.data || []).some((r) => String(r.alasan || "").startsWith(MARKER))
  ) {
    ok("GET /perizinan read isolation");
  } else fail("GET /perizinan read isolation");

  const kesTest = await fetchJson("/kesehatan", { headers: hTest });
  const kesDef = await fetchJson("/kesehatan", { headers: hDef });
  if (
    kesTest.res.status === 200 &&
    (kesTest.body.data || []).some((r) => String(r.keluhan || "").startsWith(MARKER)) &&
    !(kesDef.body.data || []).some((r) => String(r.keluhan || "").startsWith(MARKER))
  ) {
    ok("GET /kesehatan read isolation");
  } else fail("GET /kesehatan read isolation");

  const hafTest = await fetchJson(`/hafalan?bulan=${fx.bulan}&tahun=${fx.tahun}`, { headers: hTest });
  const hafDef = await fetchJson(`/hafalan?bulan=${fx.bulan}&tahun=${fx.tahun}`, { headers: hDef });
  if (
    hafTest.res.status === 200 &&
    (hafTest.body.data || []).some((r) => String(r.kitab || "").startsWith(MARKER)) &&
    !(hafDef.body.data || []).some((r) => String(r.kitab || "").startsWith(MARKER))
  ) {
    ok("GET /hafalan read isolation");
  } else fail("GET /hafalan read isolation");

  const nilaiTest = await fetchJson(`/nilai?bulan=${fx.bulan}&tahun=${fx.tahun}`, { headers: hTest });
  const nilaiDef = await fetchJson(`/nilai?bulan=${fx.bulan}&tahun=${fx.tahun}`, { headers: hDef });
  if (
    nilaiTest.res.status === 200 &&
    (nilaiTest.body.data || []).some((r) => String(r.mapel || "").startsWith(MARKER)) &&
    !(nilaiDef.body.data || []).some((r) => String(r.mapel || "").startsWith(MARKER))
  ) {
    ok("GET /nilai read isolation");
  } else fail("GET /nilai read isolation");

  const agTest = await fetchJson("/absensi-guru", { headers: hTest });
  if (agTest.res.status === 200 && (agTest.body.data || []).every((r) => r.tenant_id === fx.testTenantId)) {
    ok("GET /absensi-guru tenant scoped");
  } else fail("GET /absensi-guru tenant scoped");

  const crossPel = await fetchJson(`/pelanggaran/${fx.pelId}`, {
    method: "PUT",
    headers: { ...hDef, "Content-Type": "application/json" },
    body: JSON.stringify({ tanggal: "2026-01-01", jenis: "hack", poin: 1 }),
  });
  if (crossPel.res.status === 404) ok("PUT /pelanggaran cross-tenant ditolak");
  else fail("PUT /pelanggaran cross-tenant", crossPel.body);

  const crossTamu = await fetchJson(`/tamu/${fx.tamuId}`, {
    method: "DELETE",
    headers: hDef,
  });
  if (crossTamu.res.status === 404) ok("DELETE /tamu cross-tenant ditolak");
  else fail("DELETE /tamu cross-tenant", crossTamu.body);

  const crossPeng = await fetchJson(`/pengumuman/${fx.pengId}`, {
    method: "DELETE",
    headers: hDef,
  });
  if (crossPeng.res.status === 404) ok("DELETE /pengumuman cross-tenant ditolak");
  else fail("DELETE /pengumuman cross-tenant", crossPeng.body);

  const crossIzin = await fetchJson(`/perizinan/kembali/${fx.izinId}`, {
    method: "PUT",
    headers: hDef,
  });
  if (crossIzin.res.status === 404) ok("PUT /perizinan/kembali cross-tenant ditolak");
  else fail("PUT /perizinan/kembali cross-tenant", crossIzin.body);

  const crossKes = await fetchJson(`/kesehatan/${fx.kesId}`, { headers: hDef });
  if (crossKes.res.status === 404) ok("GET /kesehatan/:id cross-tenant ditolak");
  else fail("GET /kesehatan/:id cross-tenant", crossKes.body);

  if (fx.defaultSantriId) {
    const crossAbs = await fetchJson("/absensi", {
      method: "POST",
      headers: { ...hTest, "Content-Type": "application/json" },
      body: JSON.stringify({
        santri_id: fx.defaultSantriId,
        tanggal: new Date().toISOString().split("T")[0],
        sesi: "hack",
        status: "Hadir",
      }),
    });
    if (crossAbs.res.status === 400) ok("POST /absensi santri tenant lain ditolak");
    else fail("POST /absensi cross-tenant", crossAbs.body);
  } else ok("POST /absensi cross-tenant (skip no default santri)");

  if (fx.defaultGuruId) {
    const crossAg = await fetchJson("/absensi-guru", {
      method: "POST",
      headers: { ...hTest, "Content-Type": "application/json" },
      body: JSON.stringify({
        guru_id: fx.defaultGuruId,
        bulan: fx.bulan,
        tahun: fx.tahun,
        total_hadir: 1,
      }),
    });
    if (crossAg.res.status === 400) ok("POST /absensi-guru guru tenant lain ditolak");
    else fail("POST /absensi-guru cross-tenant", crossAg.body);
  } else ok("POST /absensi-guru cross-tenant (skip)");

  if (fx.defaultSantriId) {
    const crossPelPost = await fetchJson("/pelanggaran", {
      method: "POST",
      headers: { ...hTest, "Content-Type": "application/json" },
      body: JSON.stringify({
        santri_id: fx.defaultSantriId,
        tanggal: new Date().toISOString().split("T")[0],
        jenis: "hack",
        poin: 1,
      }),
    });
    if (crossPelPost.res.status === 400) ok("POST /pelanggaran santri tenant lain ditolak");
    else fail("POST /pelanggaran cross-tenant", crossPelPost.body);
  } else ok("POST /pelanggaran cross-tenant (skip)");

  const tamuPost = await fetchJson("/tamu", {
    method: "POST",
    headers: { ...hTest, "Content-Type": "application/json" },
    body: JSON.stringify({
      nama_tamu: `${MARKER}-POST`,
      tujuan: "Test",
      jumlah_orang: 1,
      petugas: "smoke",
    }),
  });
  if (tamuPost.body.data?.tenant_id === fx.testTenantId) ok("POST /tamu set tenant_id");
  else fail("POST /tamu tenant_id", tamuPost.body);

  const pengPost = await fetchJson("/pengumuman", {
    method: "POST",
    headers: { ...hTest, "Content-Type": "application/json" },
    body: JSON.stringify({
      judul: `${MARKER}-POST-PENG`,
      isi: "body smoke",
    }),
  });
  if (pengPost.body.data?.tenant_id === fx.testTenantId) ok("POST /pengumuman set tenant_id");
  else fail("POST /pengumuman tenant_id", pengPost.body);

  const dashDef = await fetchJson("/dashboard/summary", { headers: hDef });
  const dashTest = await fetchJson("/dashboard/summary", { headers: hTest });
  const defTamu = Number(dashDef.body.data?.tamu_bulan_ini || 0);
  const testTamu = Number(dashTest.body.data?.tamu_bulan_ini || 0);
  if (
    dashTest.res.status === 200 &&
    testTamu >= 1 &&
    !(dashDef.body.data?.santri_poin_tertinggi || []).some((r) =>
      String(r.nama || "").includes("Test 2E")
    )
  ) {
    ok("Dashboard tamu & pelanggaran scoped");
  } else {
    fail("Dashboard operasional scoped", { defTamu, testTamu, dashTest: dashTest.body.data });
  }

  const kesStats = await fetchJson("/kesehatan/stats/hari-ini", { headers: hTest });
  if (kesStats.res.status === 200 && Number(kesStats.body.data?.sakit || 0) >= 1) {
    ok("GET /kesehatan/stats/hari-ini tenant scoped");
  } else fail("GET /kesehatan/stats/hari-ini", kesStats.body);

  const testSantriCount = await pool.query(
    `SELECT COUNT(*)::int AS n
     FROM santri
     WHERE tenant_id = $1
       AND LOWER(TRIM(COALESCE(status, 'aktif'))) IN ('aktif', 'active', '')`,
    [fx.testTenantId]
  );
  const testAlumniCount = await pool.query(
    `SELECT COUNT(*)::int AS n FROM alumni WHERE tenant_id = $1`,
    [fx.testTenantId]
  );
  const dashSantri = Number(dashTest.body.data?.total_santri || 0);
  const dashAlumni = Number(dashTest.body.data?.total_alumni || 0);
  if (dashSantri === testSantriCount.rows[0].n && dashAlumni === testAlumniCount.rows[0].n) {
    ok("Dashboard santri aktif dan alumni matches tenant");
  } else fail("Dashboard santri/alumni", {
    dashSantri,
    dbSantri: testSantriCount.rows[0].n,
    dashAlumni,
    dbAlumni: testAlumniCount.rows[0].n,
  });

  const crossTamuPatch = await fetchJson(`/tamu/${fx.tamuId}/keluar`, {
    method: "PATCH",
    headers: hDef,
  });
  if (crossTamuPatch.res.status === 404) ok("PATCH /tamu/keluar cross-tenant ditolak");
  else fail("PATCH /tamu/keluar cross-tenant", crossTamuPatch.body);

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
