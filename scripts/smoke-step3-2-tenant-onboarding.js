/**
 * Smoke test — Step 3.2 Tenant Onboarding
 * Usage: node scripts/smoke-step3-2-tenant-onboarding.js
 */
require("dotenv").config();
const { execSync } = require("child_process");
const path = require("path");
const pool = require("../db");

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3016";
const TEST_SLUG = "tenant-test-3b2";
const INACTIVE_MSG =
  "Layanan KlikPesantren untuk pesantren ini sedang tidak aktif.";

const ADMIN_USER = "admin_test_3b2";
const ADMIN_PASS = "test123456";

let passed = 0;
let failed = 0;
let tenantId = null;

function ok(label) {
  passed++;
  console.log("  PASS:", label);
}

function fail(label, detail) {
  failed++;
  console.error("  FAIL:", label, detail !== undefined ? detail : "");
}

async function fetchJson(urlPath, opts = {}) {
  const res = await fetch(`${BASE}${urlPath}`, opts);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function cleanupTestTenant(slug) {
  const { rows } = await pool.query(`SELECT id FROM tenants WHERE slug = $1`, [slug]);
  if (!rows.length) return;
  const tid = rows[0].id;
  await pool.query(
    `DELETE FROM user_unit_scope s
     USING users u
     WHERE s.user_id = u.id AND u.tenant_id = $1`,
    [tid]
  );
  await pool.query(`DELETE FROM users WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM unit_pendidikan WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM profil_pesantren WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM devices WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM merchant_rfid WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [tid]);
}

async function run() {
  console.log("=== Smoke: Step 3.2 Tenant Onboarding ===\n");

  try {
    execSync("node scripts/run-migration-036.js", {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
    });
    ok("1. Migration 036 OK");
  } catch {
    fail("1. Migration 036 OK");
  }

  await cleanupTestTenant(TEST_SLUG);

  const platformLogin = await fetchJson("/platform/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "platform", password: "123456" }),
  });
  if (platformLogin.res.status === 200 && platformLogin.body.token) {
    ok("2. Platform login OK");
  } else {
    fail("2. Platform login OK", platformLogin.body);
  }

  const hPlatform = { Authorization: `Bearer ${platformLogin.body.token}` };

  const createBody = {
    nama_pesantren: "Pesantren Test 3B2",
    slug: TEST_SLUG,
    alamat: "Jl. Smoke Test",
    telepon: "08123456789",
    admin_nama: "Admin Test 3B2",
    admin_username: ADMIN_USER,
    admin_password: ADMIN_PASS,
    create_default_unit_users: true,
  };

  const created = await fetchJson("/platform/tenants", {
    method: "POST",
    headers: { ...hPlatform, "Content-Type": "application/json" },
    body: JSON.stringify(createBody),
  });

  if (created.res.status === 201 && created.body.data?.tenant?.slug === TEST_SLUG) {
    ok("3. POST /platform/tenants create OK");
    tenantId = created.body.data.tenant.id;
  } else {
    fail("3. POST /platform/tenants create OK", created.body);
  }

  const dbTenant = await pool.query(`SELECT * FROM tenants WHERE slug = $1`, [TEST_SLUG]);
  if (dbTenant.rows.length === 1 && dbTenant.rows[0].status === "active") {
    ok("4. DB tenant exists");
    tenantId = dbTenant.rows[0].id;
  } else fail("4. DB tenant exists");

  const dbProfil = await pool.query(
    `SELECT * FROM profil_pesantren WHERE tenant_id = $1`,
    [tenantId]
  );
  if (dbProfil.rows.length === 1) ok("5. DB profil_pesantren exists");
  else fail("5. DB profil_pesantren exists");

  const dbUnits = await pool.query(
    `SELECT kode FROM unit_pendidikan WHERE tenant_id = $1 ORDER BY sort_order`,
    [tenantId]
  );
  const unitKodes = dbUnits.rows.map((r) => r.kode);
  if (
    dbUnits.rows.length === 7 &&
    unitKodes.join(",") === "PAUD,TK,SD,MI,SMP,SMA,MADINAH"
  ) {
    ok("6. DB 7 unit default OK");
  } else fail("6. DB 7 unit default OK", unitKodes);

  const dbAdmin = await pool.query(
    `SELECT role FROM users WHERE tenant_id = $1 AND username = $2`,
    [tenantId, ADMIN_USER]
  );
  if (dbAdmin.rows[0]?.role === "superadmin") ok("7. DB admin tenant superadmin");
  else fail("7. DB admin tenant superadmin", dbAdmin.rows[0]);

  const defaultUsers = await pool.query(
    `SELECT username, role FROM users
     WHERE tenant_id = $1
       AND username IN ('pimpinan','paud','tk','sd','mi','smp','sma','madinah')
     ORDER BY username`,
    [tenantId]
  );
  if (defaultUsers.rows.length === 8) ok("8. Default unit users created (8)");
  else fail("8. Default unit users created", defaultUsers.rows);

  const scopes = await pool.query(
    `SELECT u.username, up.kode
     FROM user_unit_scope s
     JOIN users u ON u.id = s.user_id
     JOIN unit_pendidikan up ON up.id = s.unit_id
     WHERE u.tenant_id = $1
     ORDER BY u.username`,
    [tenantId]
  );
  if (scopes.rows.length === 7) ok("9. user_unit_scope OK (7 bendahara)");
  else fail("9. user_unit_scope OK", scopes.rows);

  const adminLoginNew = await fetchJson("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: ADMIN_USER,
      password: ADMIN_PASS,
      tenant_slug: TEST_SLUG,
    }),
  });
  if (adminLoginNew.res.status === 200 && adminLoginNew.body.token) {
    ok("10. Tenant admin login slug baru OK");
  } else fail("10. Tenant admin login slug baru OK", adminLoginNew.body);

  const adminLoginDefault = await fetchJson("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: ADMIN_USER,
      password: ADMIN_PASS,
      tenant_slug: "default",
    }),
  });
  if (adminLoginDefault.res.status === 401) {
    ok("11. Tenant admin tidak bisa login slug default");
  } else fail("11. Tenant admin tidak bisa login slug default", adminLoginDefault.body);

  const listTenants = await fetchJson("/platform/tenants?q=test-3b2", {
    headers: hPlatform,
  });
  if (
    listTenants.res.status === 200 &&
    (listTenants.body.data || []).some((t) => t.slug === TEST_SLUG)
  ) {
    ok("12. GET /platform/tenants list OK");
  } else fail("12. GET /platform/tenants list OK", listTenants.body);

  const detail = await fetchJson(`/platform/tenants/${tenantId}`, {
    headers: hPlatform,
  });
  if (
    detail.res.status === 200 &&
    detail.body.data?.unit_count === 7 &&
    detail.body.data?.user_count >= 9
  ) {
    ok("13. GET /platform/tenants/:id detail OK");
  } else fail("13. GET /platform/tenants/:id detail OK", detail.body.data);

  const dupSlug = await fetchJson("/platform/tenants", {
    method: "POST",
    headers: { ...hPlatform, "Content-Type": "application/json" },
    body: JSON.stringify(createBody),
  });
  if (dupSlug.res.status === 409) ok("14. Duplicate slug ditolak 409");
  else fail("14. Duplicate slug ditolak 409", dupSlug.body);

  const reserved = await fetchJson("/platform/tenants", {
    method: "POST",
    headers: { ...hPlatform, "Content-Type": "application/json" },
    body: JSON.stringify({ ...createBody, slug: "platform", admin_username: "x_admin" }),
  });
  if (reserved.res.status === 400) ok("15. Reserved slug ditolak 400");
  else fail("15. Reserved slug ditolak 400", reserved.body);

  const pubProfile = await fetchJson(`/public/tenants/${TEST_SLUG}/profile`);
  if (
    pubProfile.res.status === 200 &&
    pubProfile.body.data?.slug === TEST_SLUG &&
    pubProfile.body.data?.status === "active"
  ) {
    ok("16. GET /public/tenants/:slug/profile OK");
  } else fail("16. Public profile OK", pubProfile.body);

  const suspend = await fetchJson(`/platform/tenants/${tenantId}/status`, {
    method: "PATCH",
    headers: { ...hPlatform, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "suspended", reason: "smoke test" }),
  });
  if (suspend.res.status === 200 && suspend.body.data?.status === "suspended") {
    ok("17. PATCH suspend OK");
  } else fail("17. PATCH suspend OK", suspend.body);

  const loginSuspended = await fetchJson("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: ADMIN_USER,
      password: ADMIN_PASS,
      tenant_slug: TEST_SLUG,
    }),
  });
  if (
    loginSuspended.res.status === 403 &&
    loginSuspended.body.error === INACTIVE_MSG
  ) {
    ok("18. Tenant admin login suspended ditolak");
  } else fail("18. Tenant admin login suspended", loginSuspended.body);

  const waliSuspended = await fetchJson("/wali-app/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_slug: TEST_SLUG,
      nomor_hp: "08111111111",
      pin: "1234",
    }),
  });
  if (
    waliSuspended.res.status === 403 &&
    waliSuspended.body.error === INACTIVE_MSG
  ) {
    ok("19. Wali login tenant suspended ditolak");
  } else fail("19. Wali login suspended", waliSuspended.body);

  const merch = await pool.query(
    `INSERT INTO merchant_rfid (nama_merchant, tenant_id, status)
     VALUES ('Smoke 3B2 Merchant', $1, true) RETURNING id`,
    [tenantId]
  );
  const deviceSecret = "smoke-dev-secret-3b2";
  await pool.query(
    `INSERT INTO devices (device_id, device_secret, nama_device, status, tenant_id, merchant_id)
     VALUES ('SMOKE-DEV-3B2', $1, 'Smoke Device', true, $2, $3)
     ON CONFLICT ON CONSTRAINT devices_tenant_device_id_key
     DO UPDATE SET device_secret = EXCLUDED.device_secret`,
    [deviceSecret, tenantId, merch.rows[0].id]
  );

  const rfidSuspended = await fetchJson("/rfid/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_slug: TEST_SLUG,
      device_id: "SMOKE-DEV-3B2",
      device_secret: deviceSecret,
      uid_rfid: "SMOKEUID3B2",
      nominal: 1000,
      trx_id: `smoke-${Date.now()}`,
    }),
  });
  if (
    rfidSuspended.res.status === 403 &&
    rfidSuspended.body.error === INACTIVE_MSG
  ) {
    ok("20. RFID device auth tenant suspended ditolak");
  } else fail("20. RFID suspended", rfidSuspended.body);

  const reactivate = await fetchJson(`/platform/tenants/${tenantId}/status`, {
    method: "PATCH",
    headers: { ...hPlatform, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "active" }),
  });
  if (reactivate.res.status === 200 && reactivate.body.data?.status === "active") {
    ok("21. PATCH active OK");
  } else fail("21. PATCH active OK", reactivate.body);

  const loginActive = await fetchJson("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: ADMIN_USER,
      password: ADMIN_PASS,
      tenant_slug: TEST_SLUG,
    }),
  });
  if (loginActive.res.status === 200) ok("22. Tenant admin login setelah active OK");
  else fail("22. Tenant admin login setelah active OK", loginActive.body);

  const tenantToken = loginActive.body.token;
  const platformDash = await fetchJson("/dashboard/summary", {
    headers: { Authorization: `Bearer ${platformLogin.body.token}` },
  });
  if (platformDash.res.status === 403) {
    ok("23. Platform token tidak bisa /dashboard tenant");
  } else fail("23. Platform token /dashboard", platformDash.body);

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  console.log("\n--- Credential tenant test ---");
  console.log(`slug: ${TEST_SLUG}`);
  console.log(`admin: ${ADMIN_USER} / ${ADMIN_PASS}`);
  console.log(
    "unit users: pimpinan, paud, tk, sd, mi, smp, sma, madinah — password unik di response initial_password"
  );

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
