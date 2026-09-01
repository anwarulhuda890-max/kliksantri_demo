/**
 * Smoke test — Step 3.5 Tenant Branding + Login Slug
 * Usage: node scripts/smoke-step3-5-tenant-branding.js
 * Requires server on SMOKE_BASE_URL (default http://localhost:3019)
 */
require("dotenv").config();
const pool = require("../db");

const BASE = process.env.SMOKE_BASE_URL || "http://localhost:3019";
const TEST_SLUG = "tenant-smoke-3b5";
const ADMIN_USER = "admin_smoke_3b5";
const ADMIN_PASS = "test123456";
const INACTIVE_MSG =
  "Layanan KlikPesantren untuk pesantren ini sedang tidak aktif.";

let passed = 0;
let failed = 0;
let tenantId = null;
let adminToken = null;

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
  await pool.query(`DELETE FROM kelas WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM users WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM unit_pendidikan WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM profil_pesantren WHERE tenant_id = $1`, [tid]);
  await pool.query(`DELETE FROM tenants WHERE id = $1`, [tid]);
}

async function run() {
  console.log("=== Smoke: Step 3.5 Tenant Branding + Login Slug ===\n");

  const platformLogin = await fetchJson("/platform/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "platform", password: "123456" }),
  });
  const hPlatform = { Authorization: `Bearer ${platformLogin.body.token}` };

  await cleanupTestTenant(TEST_SLUG);

  const created = await fetchJson("/platform/tenants", {
    method: "POST",
    headers: { ...hPlatform, "Content-Type": "application/json" },
    body: JSON.stringify({
      nama_pesantren: "Pesantren Smoke 3.5",
      slug: TEST_SLUG,
      alamat: "Jl. Branding Smoke",
      telepon: "08123456781",
      admin_nama: "Admin Smoke 3.5",
      admin_username: ADMIN_USER,
      admin_password: ADMIN_PASS,
      create_default_unit_users: false,
    }),
  });

  if (created.res.status === 201) {
    tenantId = created.body.data.tenant.id;
    ok("Setup: tenant test created");
  } else {
    fail("Setup: tenant test created", created.body);
  }

  const pubActive = await fetchJson(`/public/tenants/${TEST_SLUG}/profile`);
  if (
    pubActive.res.status === 200 &&
    pubActive.body.data?.service_available === true &&
    pubActive.body.data?.nama &&
    pubActive.body.data?.suspended_reason === undefined &&
    pubActive.body.data?.created_by === undefined &&
    !pubActive.body.data?.id
  ) {
    ok("1. Public profile active → service_available=true");
  } else {
    fail("1. Public profile active", pubActive.body);
  }

  await fetchJson(`/platform/tenants/${tenantId}/status`, {
    method: "PATCH",
    headers: { ...hPlatform, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "suspended", reason: "internal smoke" }),
  });

  const pubSuspended = await fetchJson(`/public/tenants/${TEST_SLUG}/profile`);
  if (
    pubSuspended.res.status === 200 &&
    pubSuspended.body.data?.service_available === false &&
    pubSuspended.body.data?.message === INACTIVE_MSG &&
    pubSuspended.body.data?.suspended_reason === undefined
  ) {
    ok("2. Public profile suspended → service_available=false");
  } else {
    fail("2. Public profile suspended", pubSuspended.body);
  }

  await fetchJson(`/platform/tenants/${tenantId}/status`, {
    method: "PATCH",
    headers: { ...hPlatform, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "active" }),
  });

  const pubInvalid = await fetchJson("/public/tenants/slug-tidak-ada-xyz/profile");
  if (pubInvalid.res.status === 404) {
    ok("3. Public profile invalid slug → 404");
  } else {
    fail("3. Public profile invalid slug", pubInvalid.body);
  }

  const loginOk = await fetchJson("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_slug: TEST_SLUG,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    }),
  });

  if (
    loginOk.res.status === 200 &&
    loginOk.body.token &&
    loginOk.body.user?.tenant_slug === TEST_SLUG &&
    loginOk.body.user?.tenant_name
  ) {
    ok("4. Login with valid tenant_slug OK");
    ok("7. Login response has tenant_slug + tenant_name");
    adminToken = loginOk.body.token;
  } else {
    fail("4. Login with valid tenant_slug", loginOk.body);
    fail("7. Login response tenant fields", loginOk.body);
  }

  const loginWrongSlug = await fetchJson("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_slug: "slug-salah-total",
      username: ADMIN_USER,
      password: ADMIN_PASS,
    }),
  });

  if (loginWrongSlug.res.status === 404) {
    ok("5. Login wrong slug fails");
  } else {
    fail("5. Login wrong slug", loginWrongSlug.body);
  }

  await fetchJson(`/platform/tenants/${tenantId}/status`, {
    method: "PATCH",
    headers: { ...hPlatform, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "suspended", reason: "smoke" }),
  });

  const loginSuspended = await fetchJson("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_slug: TEST_SLUG,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    }),
  });

  if (
    loginSuspended.res.status === 403 &&
    !loginSuspended.body.token &&
    loginSuspended.body.error === INACTIVE_MSG
  ) {
    ok("6. Login suspended tenant fails before token");
  } else {
    fail("6. Login suspended tenant", loginSuspended.body);
  }

  await fetchJson(`/platform/tenants/${tenantId}/status`, {
    method: "PATCH",
    headers: { ...hPlatform, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "active" }),
  });

  const profilNoToken = await fetchJson("/profil-pesantren");
  if (profilNoToken.res.status === 401) {
    ok("8. /profil-pesantren without token → 401");
  } else {
    fail("8. /profil-pesantren without token", profilNoToken.body);
  }

  const relogin = await fetchJson("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_slug: TEST_SLUG,
      username: ADMIN_USER,
      password: ADMIN_PASS,
    }),
  });
  adminToken = relogin.body.token;

  const profilWithToken = await fetchJson("/profil-pesantren", {
    headers: { Authorization: `Bearer ${adminToken}` },
  });

  if (
    profilWithToken.res.status === 200 &&
    profilWithToken.body.data?.tenant_id === tenantId
  ) {
    ok("9. /profil-pesantren with token → tenant scoped profil");
  } else {
    fail("9. /profil-pesantren with token", profilWithToken.body);
  }

  const platformTenants = await fetchJson("/platform/tenants", {
    headers: hPlatform,
  });

  if (platformTenants.res.status === 200 && platformTenants.body.success) {
    ok("10. Platform routes unaffected");
  } else {
    fail("10. Platform routes", platformTenants.body);
  }

  await cleanupTestTenant(TEST_SLUG);

  console.log(`\n=== Result: ${passed} passed, ${failed} failed ===`);
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
