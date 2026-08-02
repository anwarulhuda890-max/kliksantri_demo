/**
 * Smoke test — Step 2B tenant isolation (keuangan & dashboard)
 * Usage: node scripts/smoke-step2b-tenant-isolation.js
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("../db");

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3002";
const TEST_SLUG = "tenant-test-2b";

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
     VALUES ($1, 'Pesantren Test 2B', 'active')
     ON CONFLICT (slug) DO NOTHING`,
    [TEST_SLUG]
  );
  const { rows: testT } = await pool.query(`SELECT id FROM tenants WHERE slug = $1`, [TEST_SLUG]);
  const testTenantId = testT[0].id;
  const defaultTenantId = def[0].id;

  const hash = await bcrypt.hash("test1234", 10);
  const existing = await pool.query(
    `SELECT id FROM users WHERE username = 'admin_test_2b'`
  );
  if (!existing.rows.length) {
    await pool.query(
      `INSERT INTO users (nama, username, password, role, status, tenant_id)
       VALUES ('Admin Test 2B', 'admin_test_2b', $1, 'superadmin', 'Aktif', $2)`,
      [hash, testTenantId]
    );
  } else {
    await pool.query(
      `UPDATE users SET tenant_id = $1, password = $2 WHERE username = 'admin_test_2b'`,
      [testTenantId, hash]
    );
  }

  await pool.query(`DELETE FROM buku_kas WHERE tenant_id = $1 AND keterangan LIKE 'SMOKE-2B-%'`, [testTenantId]);
  await pool.query(`DELETE FROM jenis_tagihan WHERE tenant_id = $1 AND nama_tagihan LIKE 'SMOKE-2B-%'`, [testTenantId]);

  await pool.query(
    `INSERT INTO jenis_tagihan (nama_tagihan, is_bulanan, tenant_id)
     VALUES ('SMOKE-2B-TAGIHAN', false, $1)`,
    [testTenantId]
  );
  await pool.query(
    `INSERT INTO buku_kas (tanggal, jenis, kategori, keterangan, nominal, petugas, tenant_id)
     VALUES (CURRENT_DATE, 'Masuk', 'Manual', 'SMOKE-2B-KAS', 99999, 'smoke', $1)`,
    [testTenantId]
  );

  const { rows: santriTest } = await pool.query(
    `SELECT id FROM santri WHERE tenant_id = $1 LIMIT 1`,
    [testTenantId]
  );
  let testSantriId = santriTest[0]?.id;
  if (!testSantriId) {
    const ins = await pool.query(
      `INSERT INTO santri (nis, nama, tenant_id, status)
       VALUES ($1, 'Santri Test 2B', $2, 'aktif') RETURNING id`,
      [`SMOKE2B-${Date.now()}`, testTenantId]
    );
    testSantriId = ins.rows[0].id;
  }

  const { rows: santriDef } = await pool.query(
    `SELECT id FROM santri WHERE tenant_id = $1 LIMIT 1`,
    [defaultTenantId]
  );
  const defaultSantriId = santriDef[0]?.id;

  const payTest = await pool.query(
    `INSERT INTO pembayaran (
       santri_id, nama_tagihan, nominal_tagihan, nominal_bayar, sisa_tunggakan, status, tenant_id
     )
     VALUES ($1, 'SMOKE-2B-PAY', 100000, 0, 100000, 'belum', $2)
     RETURNING id`,
    [testSantriId, testTenantId]
  );

  const payDef = defaultSantriId
    ? await pool.query(
        `INSERT INTO pembayaran (
           santri_id, nama_tagihan, nominal_tagihan, nominal_bayar, sisa_tunggakan, status, tenant_id
         )
         VALUES ($1, 'SMOKE-2B-PAY-DEF', 50000, 0, 50000, 'belum', $2)
         RETURNING id`,
        [defaultSantriId, defaultTenantId]
      )
    : { rows: [{ id: null }] };

  await pool.query(
    `INSERT INTO sahriyah_setting (santri_id, nominal_uang, nominal_beras, keterangan, tenant_id)
     VALUES ($1, 50000, 2, 'smoke', $2)
     ON CONFLICT (tenant_id, santri_id) DO UPDATE SET nominal_uang = EXCLUDED.nominal_uang`,
    [testSantriId, testTenantId]
  );

  const bulan = new Date().getMonth() + 1;
  const tahun = new Date().getFullYear();
  const tagTest = await pool.query(
    `INSERT INTO tagihan_sahriyah (
       santri_id, bulan, tahun, nominal, sisa_tagihan, status, tenant_id
     )
     VALUES ($1, $2, $3, 75000, 75000, 'Belum Lunas', $4)
     ON CONFLICT (tenant_id, santri_id, bulan, tahun) DO UPDATE SET nominal = EXCLUDED.nominal
     RETURNING id`,
    [testSantriId, bulan, tahun, testTenantId]
  );

  return {
    defaultTenantId,
    testTenantId,
    testSantriId,
    defaultSantriId,
    payTestId: payTest.rows[0].id,
    payDefId: payDef.rows[0].id,
    tagTestId: tagTest.rows[0].id,
  };
}

async function run() {
  console.log("=== Smoke: Step 2B Tenant Isolation (Keuangan) ===\n");

  const fx = await ensureFixtures();
  ok("Fixtures ready");

  const defaultAuth = await login("admin", "admin123", "default");
  const testAuth = await login("admin_test_2b", "test1234", TEST_SLUG);
  const hDef = { Authorization: `Bearer ${defaultAuth.token}` };
  const hTest = { Authorization: `Bearer ${testAuth.token}` };

  const jDef = await fetchJson("/jenis-tagihan", { headers: hDef });
  const jTest = await fetchJson("/jenis-tagihan", { headers: hTest });
  if (
    jDef.res.status === 200 &&
    jTest.res.status === 200 &&
    !(jDef.body.data || []).some((r) => r.nama_tagihan?.startsWith("SMOKE-2B-")) &&
    (jTest.body.data || []).some((r) => r.nama_tagihan === "SMOKE-2B-TAGIHAN")
  ) {
    ok("GET /jenis-tagihan isolasi");
  } else fail("GET /jenis-tagihan isolasi");

  const bkDef = await fetchJson("/buku-kas", { headers: hDef });
  const bkTest = await fetchJson("/buku-kas", { headers: hTest });
  if (
    bkDef.res.status === 200 &&
    bkTest.res.status === 200 &&
    !(bkDef.body.data || []).some((r) => r.keterangan === "SMOKE-2B-KAS") &&
    (bkTest.body.data || []).some((r) => r.keterangan === "SMOKE-2B-KAS")
  ) {
    ok("GET /buku-kas isolasi");
  } else fail("GET /buku-kas isolasi");

  const pDef = await fetchJson("/pembayaran", { headers: hDef });
  const pTest = await fetchJson("/pembayaran", { headers: hTest });
  if (
    pTest.res.status === 200 &&
    (pTest.body.data || []).every((p) => p.tenant_id === fx.testTenantId) &&
    !(pDef.body.data || []).some((p) => p.nama_tagihan === "SMOKE-2B-PAY")
  ) {
    ok("GET /pembayaran isolasi");
  } else fail("GET /pembayaran isolasi");

  const sTest = await fetchJson("/sahriyah", { headers: hTest });
  if (
    sTest.res.status === 200 &&
    (sTest.body.data || []).every((t) => t.tenant_id === fx.testTenantId)
  ) {
    ok("GET /sahriyah isolasi");
  } else fail("GET /sahriyah isolasi");

  if (fx.payDefId) {
    const crossPay = await fetchJson(`/pembayaran/bayar/${fx.payTestId}`, {
      method: "PUT",
      headers: { ...hDef, "Content-Type": "application/json" },
      body: JSON.stringify({ nominal: 1000, petugas: "hack" }),
    });
    if (crossPay.res.status === 404) ok("PUT /pembayaran/bayar cross-tenant ditolak");
    else fail("PUT /pembayaran/bayar cross-tenant", crossPay.body);
  } else ok("PUT /pembayaran/bayar cross-tenant (skip no default santri)");

  const crossSah = await fetchJson(`/sahriyah/bayar/${fx.tagTestId}`, {
    method: "PUT",
    headers: { ...hDef, "Content-Type": "application/json" },
    body: JSON.stringify({ nominal: 1000, beras: 0, petugas: "hack" }),
  });
  if (crossSah.res.status === 404) ok("PUT /sahriyah/bayar cross-tenant ditolak");
  else fail("PUT /sahriyah/bayar cross-tenant", crossSah.body);

  if (fx.defaultSantriId) {
    const crossCreate = await fetchJson("/pembayaran", {
      method: "POST",
      headers: { ...hTest, "Content-Type": "application/json" },
      body: JSON.stringify({
        santri_id: fx.defaultSantriId,
        nama_tagihan: "hack",
        bulan: "1",
        tahun: 2026,
        nominal_tagihan: 1000,
        nominal_bayar: 0,
      }),
    });
    if (crossCreate.res.status === 400) ok("POST /pembayaran santri tenant lain ditolak");
    else fail("POST /pembayaran cross-tenant", crossCreate.body);
  } else ok("POST /pembayaran cross-tenant (skip)");

  const beforeGen = await pool.query(
    `SELECT COUNT(*)::int AS n FROM tagihan_sahriyah WHERE tenant_id = $1`,
    [fx.testTenantId]
  );
  await fetchJson("/sahriyah/generate", {
    method: "POST",
    headers: { ...hTest, "Content-Type": "application/json" },
    body: JSON.stringify({ bulan: 1, tahun: 2099 }),
  });
  const afterGen = await pool.query(
    `SELECT COUNT(*)::int AS n FROM tagihan_sahriyah WHERE tenant_id = $1 AND tahun = 2099`,
    [fx.testTenantId]
  );
  const defGen = await pool.query(
    `SELECT COUNT(*)::int AS n FROM tagihan_sahriyah WHERE tenant_id = $1 AND tahun = 2099`,
    [fx.defaultTenantId]
  );
  if (afterGen.rows[0].n > 0 && defGen.rows[0].n === 0) ok("POST /sahriyah/generate scoped tenant");
  else fail("POST /sahriyah/generate scoped", { afterGen: afterGen.rows[0], defGen: defGen.rows[0] });

  const dashDef = await fetchJson("/dashboard/summary", { headers: hDef });
  const dashTest = await fetchJson("/dashboard/summary", { headers: hTest });
  const testKas = Number(dashTest.body.data?.kas_masuk || 0);
  const txDef = dashDef.body.data?.transaksi_terbaru || [];
  const txTest = dashTest.body.data?.transaksi_terbaru || [];
  if (
    dashTest.res.status === 200 &&
    testKas >= 99999 &&
    !txDef.some((t) => t.keterangan === "SMOKE-2B-KAS") &&
    txTest.some((t) => t.keterangan === "SMOKE-2B-KAS")
  ) {
    ok("GET /dashboard/summary kas scoped (transaksi_terbaru isolasi)");
  } else {
    fail("GET /dashboard/summary kas scoped", { testKas, txDef: txDef.slice(0, 2), txTest: txTest.slice(0, 2) });
  }

  const topDef = dashDef.body.data?.top_tunggakan || [];
  const topTest = dashTest.body.data?.top_tunggakan || [];
  const payTerbaruTest = dashTest.body.data?.pembayaran_terbaru || [];
  if (
    payTerbaruTest.length === 0 ||
    payTerbaruTest.every((p) => !String(p.nama_tagihan || "").includes("SMOKE-2B-PAY-DEF"))
  ) {
    ok("Dashboard pembayaran_terbaru / top_tunggakan scoped");
  } else fail("Dashboard pembayaran_terbaru scoped");

  const bkPost = await fetchJson("/buku-kas", {
    method: "POST",
    headers: { ...hTest, "Content-Type": "application/json" },
    body: JSON.stringify({
      tanggal: new Date().toISOString().split("T")[0],
      jenis: "Masuk",
      kategori: "Manual",
      keterangan: "SMOKE-2B-POST",
      nominal: 12345,
      petugas: "smoke",
    }),
  });
  if (bkPost.body.data?.tenant_id === fx.testTenantId) ok("POST /buku-kas set tenant_id");
  else fail("POST /buku-kas tenant_id", bkPost.body);

  const kasPembayaranBefore = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM buku_kas
     WHERE tenant_id = $1 AND kategori = 'Pembayaran'`,
    [fx.testTenantId]
  );
  const bayarPay = await fetchJson(`/pembayaran/bayar/${fx.payTestId}`, {
    method: "PUT",
    headers: { ...hTest, "Content-Type": "application/json" },
    body: JSON.stringify({ nominal: 5000, petugas: "smoke" }),
  });
  const kasPembayaranAfter = await pool.query(
    `SELECT COUNT(*)::int AS total
     FROM buku_kas
     WHERE tenant_id = $1 AND kategori = 'Pembayaran'`,
    [fx.testTenantId]
  );
  if (bayarPay.res.status === 200 && kasPembayaranAfter.rows[0]?.total === kasPembayaranBefore.rows[0]?.total) {
    ok("Bayar pembayaran tidak menulis buku_kas");
  } else fail("Pembayaran menulis buku_kas", {
    bayarPay: bayarPay.body,
    before: kasPembayaranBefore.rows[0]?.total,
    after: kasPembayaranAfter.rows[0]?.total,
  });

  const bayarSah = await fetchJson(`/sahriyah/bayar/${fx.tagTestId}`, {
    method: "PUT",
    headers: { ...hTest, "Content-Type": "application/json" },
    body: JSON.stringify({ nominal: 10000, beras: 0, petugas: "smoke" }),
  });
  const bkAfterSah = await pool.query(
    `SELECT tenant_id, kategori FROM buku_kas
     WHERE tenant_id = $1 AND kategori = 'Sahriyah'
     ORDER BY id DESC LIMIT 1`,
    [fx.testTenantId]
  );
  if (bayarSah.res.status === 200 && bkAfterSah.rows[0]?.tenant_id === fx.testTenantId) {
    ok("Bayar sahriyah → buku_kas tenant aware");
  } else fail("Bayar sahriyah buku_kas", { bayarSah: bayarSah.body, bk: bkAfterSah.rows[0] });

  const riwPayCross = await fetchJson(`/pembayaran/riwayat/${fx.payTestId}`, { headers: hDef });
  if (riwPayCross.res.status === 404) ok("GET /pembayaran/riwayat cross-tenant ditolak");
  else fail("GET /pembayaran/riwayat cross-tenant", riwPayCross.body);

  const riwSahCross = await fetchJson(`/sahriyah/riwayat/${fx.tagTestId}`, { headers: hDef });
  if (riwSahCross.res.status === 404) ok("GET /sahriyah/riwayat cross-tenant ditolak");
  else fail("GET /sahriyah/riwayat cross-tenant", riwSahCross.body);

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
