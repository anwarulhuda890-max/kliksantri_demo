/**
 * Smoke test — Step 3.4 Tenant Suspension Enforcement
 * Usage: node scripts/smoke-step3-4-suspension-enforcement.js
 * Requires server on SMOKE_BASE_URL (default http://localhost:3018)
 */
require("dotenv").config();
const bcrypt = require("bcryptjs");
const pool = require("../db");

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3018";
const TEST_SLUG = "tenant-smoke-3b4";
const ADMIN_USER = "admin_smoke_3b4";
const ADMIN_PASS = "test123456";
const WALI_HP = "081234567890";
const WALI_PIN = "456789";
const INACTIVE_MSG =
  "Layanan KlikPesantren untuk pesantren ini sedang tidak aktif.";

let passed = 0;
let failed = 0;
let skipped = 0;
let tenantId = null;
let adminToken = null;
let waliToken = null;
let deviceSecret = "smoke-dev-secret-3b4";
let waliAvailable = false;
let rfidAvailable = false;

function ok(label) {
  passed++;
  console.log("  PASS:", label);
}

function fail(label, detail) {
  failed++;
  console.error("  FAIL:", label, detail !== undefined ? detail : "");
}

function skip(label, reason) {
  skipped++;
  console.log("  SKIP:", label, reason ? `— ${reason}` : "");
}

async function fetchJson(urlPath, opts = {}) {
  const res = await fetch(`${BASE}${urlPath}`, opts);
  const body = await res.json().catch(() => ({}));
  return { res, body };
}

async function cleanupTestTenant(slug) {
  const { rows } = await pool.query(`SELECT id FROM tenants WHERE slug = $1`, [
    slug,
  ]);
  if (!rows.length) return;
  const tid = rows[0].id;
  await pool.query(
    `DELETE FROM user_unit_scope s USING users u
     WHERE s.user_id = u.id AND u.tenant_id = $1`,
    [tid]
  );
  await pool.query(`DELETE FROM transaksi_rfid WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM devices WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM merchant_rfid WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM santri WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM wali_akun WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM kelas WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM users WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM unit_pendidikan WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM profil_pesantren WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [tid]);
}

async function ensureTenant(platformHeaders) {
  await cleanupTestTenant(TEST_SLUG);

  const created = await fetchJson("/platform/tenants", {
    method: "POST",
    headers: { ...platformHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      nama_pesantren: "Pesantren Smoke 3.4",
      slug: TEST_SLUG,
      alamat: "Jl. Smoke 3.4",
      telepon: "08111111112",
      admin_nama: "Admin Smoke 3.4",
      admin_username: ADMIN_USER,
      admin_password: ADMIN_PASS,
      create_default_unit_users: false,
    }),
  });

  if (created.res.status !== 201) {
    throw new Error(`Create tenant failed: ${JSON.stringify(created.body)}`);
  }

  tenantId = created.body.data.tenant.id;

  const pinHash = await bcrypt.hash(WALI_PIN, 10);
  await pool.query(
    `INSERT INTO wali_akun (nomor_hp, pin_hash, nama, status, must_change_pin, tenant_id)
     VALUES ($1, $2, 'Wali Smoke 3.4', 'active', false, $3)
     ON CONFLICT DO NOTHING`,
    [WALI_HP, pinHash, tenantId]
  );

  const kelas = await pool.query(
    `INSERT INTO kelas (nama_kelas, tenant_id) VALUES ('Smoke 3.4', $1) RETURNING id`,
    [tenantId]
  );

  await pool.query(
    `INSERT INTO santri (nis, nama, status, tenant_id, kelas_id, uid_rfid, saldo)
     VALUES ('SM34-001', 'Santri Smoke 3.4', 'aktif', $1, $2, 'UIDSM34', 50000)
     ON CONFLICT DO NOTHING`,
    [tenantId, kelas.rows[0].id]
  );

  const merch = await pool.query(
    `INSERT INTO merchant_rfid (nama_merchant, tenant_id, status)
     VALUES ('Merchant Smoke 3.4', $1, true) RETURNING id`,
    [tenantId]
  );

  await pool.query(
    `INSERT INTO devices (device_id, device_secret, nama_device, status, tenant_id, merchant_id)
     VALUES ('SMOKE-DEV-3B4', $1, 'Smoke Device 3.4', 'online', $2, $3)
     ON CONFLICT ON CONSTRAINT devices_tenant_device_id_key
     DO UPDATE SET device_secret = EXCLUDED.device_secret, status = 'online'`,
    [deviceSecret, tenantId, merch.rows[0].id]
  );

  waliAvailable = true;
  rfidAvailable = true;
}

async function run() {
  console.log("=== Smoke: Step 3.4 Tenant Suspension Enforcement ===\n");

  const platformLogin = await fetchJson("/platform/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "platform", password: "123456" }),
  });

  if (platformLogin.res.status === 200 && platformLogin.body.token) {
    ok("1. Platform login OK");
  } else {
    fail("1. Platform login OK", platformLogin.body);
  }

  const hPlatform = { Authorization: `Bearer ${platformLogin.body.token}` };

  try {
    await ensureTenant(hPlatform);
    ok("2. Tenant test created");
  } catch (err) {
    fail("2. Tenant test created", err.message);
  }

  const adminLoginActive = await fetchJson("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: ADMIN_USER,
      password: ADMIN_PASS,
      tenant_slug: TEST_SLUG,
    }),
  });

  if (adminLoginActive.res.status === 200 && adminLoginActive.body.token) {
    ok("3. Admin tenant login (active) OK");
    adminToken = adminLoginActive.body.token;
  } else {
    fail("3. Admin tenant login (active) OK", adminLoginActive.body);
  }

  const waliLoginActive = await fetchJson("/wali-app/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_slug: TEST_SLUG,
      nomor_hp: WALI_HP,
      pin: WALI_PIN,
    }),
  });

  if (waliLoginActive.res.status === 200 && waliLoginActive.body.token) {
    ok("4. Wali login (active) OK");
    waliToken = waliLoginActive.body.token;
  } else if (waliLoginActive.res.status === 401) {
    skip("4. Wali login (active) OK", "wali fixture unavailable");
    waliAvailable = false;
  } else {
    fail("4. Wali login (active) OK", waliLoginActive.body);
  }

  const rfidActive = await fetchJson("/rfid/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_slug: TEST_SLUG,
      device_id: "SMOKE-DEV-3B4",
      device_secret: deviceSecret,
      uid_rfid: "UIDSM34",
      nominal: 1000,
      trx_id: `smoke-active-${Date.now()}`,
    }),
  });

  if (rfidActive.res.status !== 403 || rfidActive.body.error !== INACTIVE_MSG) {
    if ([200, 201, 400, 402].includes(rfidActive.res.status)) {
      ok("5. RFID endpoint active tenant not blocked by suspend message");
    } else if (rfidActive.res.status === 403 && rfidActive.body.error === INACTIVE_MSG) {
      fail("5. RFID active tenant wrongly blocked", rfidActive.body);
    } else {
      ok("5. RFID endpoint reachable (non-suspend response)");
    }
  } else {
    fail("5. RFID active tenant wrongly blocked", rfidActive.body);
  }

  const suspend = await fetchJson(`/platform/tenants/${tenantId}/status`, {
    method: "PATCH",
    headers: { ...hPlatform, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "suspended", reason: "smoke 3.4" }),
  });

  if (suspend.res.status === 200 && suspend.body.data?.status === "suspended") {
    ok("6. Suspend tenant via platform OK");
  } else {
    fail("6. Suspend tenant via platform OK", suspend.body);
  }

  const adminLoginSuspended = await fetchJson("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: ADMIN_USER,
      password: ADMIN_PASS,
      tenant_slug: TEST_SLUG,
    }),
  });

  if (
    adminLoginSuspended.res.status === 403 &&
    adminLoginSuspended.body.error === INACTIVE_MSG
  ) {
    ok("7. Admin login suspended → 403");
  } else {
    fail("7. Admin login suspended", adminLoginSuspended.body);
  }

  const adminJwtBlocked = await fetchJson("/dashboard/summary", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  if (
    adminJwtBlocked.res.status === 403 &&
    adminJwtBlocked.body.error === INACTIVE_MSG
  ) {
    ok("8. Admin JWT lama → protected API 403");
  } else {
    fail("8. Admin JWT lama blocked", adminJwtBlocked.body);
  }

  const adminMeBlocked = await fetchJson("/auth/me", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  if (
    adminMeBlocked.res.status === 403 &&
    adminMeBlocked.body.error === INACTIVE_MSG
  ) {
    ok("8b. Admin JWT lama → GET /auth/me 403");
  } else {
    fail("8b. Admin JWT /auth/me blocked", adminMeBlocked.body);
  }

  const waliLoginSuspended = await fetchJson("/wali-app/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_slug: TEST_SLUG,
      nomor_hp: WALI_HP,
      pin: WALI_PIN,
    }),
  });

  if (
    waliLoginSuspended.res.status === 403 &&
    waliLoginSuspended.body.error === INACTIVE_MSG
  ) {
    ok("9. Wali login suspended → 403");
  } else if (!waliAvailable) {
    skip("9. Wali login suspended → 403", "wali fixture unavailable");
  } else {
    fail("9. Wali login suspended", waliLoginSuspended.body);
  }

  if (waliToken) {
    const waliJwtBlocked = await fetchJson("/wali-app/dashboard", {
      headers: { Authorization: `Bearer ${waliToken}` },
    });

    if (
      waliJwtBlocked.res.status === 403 &&
      waliJwtBlocked.body.error === INACTIVE_MSG
    ) {
      ok("10. Wali JWT lama → protected API 403");
    } else {
      fail("10. Wali JWT lama blocked", waliJwtBlocked.body);
    }
  } else {
    skip("10. Wali JWT lama → protected API 403", "no wali token");
  }

  const rfidPayment = await fetchJson("/rfid/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_slug: TEST_SLUG,
      device_id: "SMOKE-DEV-3B4",
      device_secret: deviceSecret,
      uid_rfid: "UIDSM34",
      nominal: 1000,
      trx_id: `smoke-suspend-${Date.now()}`,
    }),
  });

  const rfidSync = await fetchJson("/rfid/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_slug: TEST_SLUG,
      device_id: "SMOKE-DEV-3B4",
      device_secret: deviceSecret,
      transactions: [],
    }),
  });

  const rfidHeartbeat = await fetchJson("/rfid/device/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_slug: TEST_SLUG,
      device_id: "SMOKE-DEV-3B4",
      device_secret: deviceSecret,
    }),
  });

  const rfidBlocked =
    rfidPayment.res.status === 403 &&
    rfidPayment.body.error === INACTIVE_MSG &&
    rfidSync.res.status === 403 &&
    rfidSync.body.error === INACTIVE_MSG &&
    rfidHeartbeat.res.status === 403 &&
    rfidHeartbeat.body.error === INACTIVE_MSG;

  if (rfidBlocked) {
    ok("11. RFID payment/sync/heartbeat suspended → 403");
  } else if (!rfidAvailable) {
    skip("11. RFID suspended → 403", "rfid fixture unavailable");
  } else {
    fail("11. RFID suspended blocked", {
      payment: rfidPayment.body,
      sync: rfidSync.body,
      heartbeat: rfidHeartbeat.body,
    });
  }

  const pubProfile = await fetchJson(`/public/tenants/${TEST_SLUG}/profile`);
  if (
    pubProfile.res.status === 200 &&
    pubProfile.body.data?.status === "suspended" &&
    pubProfile.body.data?.service_available === false &&
    pubProfile.body.data?.message === INACTIVE_MSG &&
    pubProfile.body.data?.suspended_reason === undefined
  ) {
    ok("12. Public profile suspended → service_available=false");
  } else {
    fail("12. Public profile suspended", pubProfile.body);
  }

  const platformDash = await fetchJson(`/platform/tenants/${tenantId}/dashboard`, {
    headers: hPlatform,
  });

  if (platformDash.res.status === 200 && platformDash.body.success === true) {
    ok("13. Platform dashboard suspended tenant readable");
  } else {
    fail("13. Platform dashboard suspended tenant", platformDash.body);
  }

  const activate = await fetchJson(`/platform/tenants/${tenantId}/status`, {
    method: "PATCH",
    headers: { ...hPlatform, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "active" }),
  });

  if (activate.res.status === 200 && activate.body.data?.status === "active") {
    ok("14. Activate tenant OK");
  } else {
    fail("14. Activate tenant OK", activate.body);
  }

  const adminLoginAgain = await fetchJson("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: ADMIN_USER,
      password: ADMIN_PASS,
      tenant_slug: TEST_SLUG,
    }),
  });

  if (adminLoginAgain.res.status === 200 && adminLoginAgain.body.token) {
    ok("15. Admin login after reactivate OK");
  } else {
    fail("15. Admin login after reactivate OK", adminLoginAgain.body);
  }

  await cleanupTestTenant(TEST_SLUG);

  console.log(
    `\n=== Result: ${passed} passed, ${failed} failed, ${skipped} skipped ===`
  );
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
