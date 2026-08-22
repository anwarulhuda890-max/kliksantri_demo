const assert = require("assert/strict");
const fs = require("fs");
const path = require("path");
const dashboardRoutes = require("../routes/dashboardRoutes");
const { resolveActiveUnit } = require("../services/unitAccessService");

const {
  buildDashboardErrorResponse,
  queryDashboardKelasCount,
  queryDashboardSantriCounts,
} = dashboardRoutes._test;

const fixtures = {
  santri: [
    { id: 1, tenant_id: 1, status: "Aktif" },
    { id: 2, tenant_id: 1, status: "aktif" },
    { id: 3, tenant_id: 1, status: "active" },
    { id: 4, tenant_id: 1, status: "nonaktif" },
    { id: 99, tenant_id: 2, status: "aktif" },
  ],
  memberships: [
    { tenant_id: 1, santri_id: 1, unit_id: 10, status: "active", left_at: null },
    { tenant_id: 1, santri_id: 2, unit_id: 10, status: "active", left_at: null },
    { tenant_id: 1, santri_id: 2, unit_id: 20, status: "active", left_at: null },
    { tenant_id: 1, santri_id: 3, unit_id: 20, status: "active", left_at: null },
    { tenant_id: 1, santri_id: 4, unit_id: 10, status: "inactive", left_at: null },
    { tenant_id: 2, santri_id: 99, unit_id: 10, status: "active", left_at: null },
  ],
  kelas: [
    { id: 100, tenant_id: 1, unit_id: 10 },
    { id: 101, tenant_id: 1, unit_id: 10 },
    { id: 200, tenant_id: 1, unit_id: 20 },
    { id: 900, tenant_id: 2, unit_id: 10 },
  ],
  units: [
    { id: 10, tenant_id: 1, kode: "A", nama: "Unit A", is_active: true },
    { id: 20, tenant_id: 1, kode: "B", nama: "Unit B", is_active: true },
    { id: 30, tenant_id: 1, kode: "C", nama: "Unit C", is_active: false },
    { id: 99, tenant_id: 2, kode: "X", nama: "Other Tenant", is_active: true },
  ],
};

function isActiveStatus(status) {
  return ["aktif", "active", ""].includes(String(status || "aktif").trim().toLowerCase());
}

function dashboardDb() {
  return {
    async query(sql, params) {
      if (sql.includes("FROM santri_units su")) {
        const [tenantId, unitId] = params;
        const seenActive = new Set();
        const seenInactive = new Set();
        for (const membership of fixtures.memberships) {
          if (membership.tenant_id !== tenantId || membership.unit_id !== unitId) continue;
          const santri = fixtures.santri.find((item) => (
            item.id === membership.santri_id && item.tenant_id === membership.tenant_id
          ));
          const active = membership.status === "active" && membership.left_at == null && isActiveStatus(santri?.status);
          (active ? seenActive : seenInactive).add(membership.santri_id);
        }
        return { rows: [{ total: seenActive.size, aktif: seenActive.size, non_aktif: seenInactive.size }] };
      }

      if (sql.includes("FROM santri") && sql.includes("COUNT(DISTINCT id)")) {
        const [tenantId] = params;
        const rows = fixtures.santri.filter((item) => item.tenant_id === tenantId);
        const active = new Set(rows.filter((item) => isActiveStatus(item.status)).map((item) => item.id));
        const inactive = new Set(rows.filter((item) => !isActiveStatus(item.status)).map((item) => item.id));
        return { rows: [{ total: active.size, aktif: active.size, non_aktif: inactive.size }] };
      }

      if (sql.includes("FROM kelas k")) {
        const [tenantId, unitId] = params;
        const activeUnitIds = new Set(
          fixtures.units
            .filter((unit) => unit.tenant_id === tenantId && unit.is_active)
            .map((unit) => unit.id),
        );
        const rows = fixtures.kelas.filter((kelas) => (
          kelas.tenant_id === tenantId &&
          activeUnitIds.has(kelas.unit_id) &&
          (unitId == null || kelas.unit_id === unitId)
        ));
        return { rows: [{ total: new Set(rows.map((kelas) => kelas.id)).size }] };
      }

      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

function accessDb({ role = "operator", allowed = [10] } = {}) {
  return {
    async query(sql, params) {
      if (sql.includes("FROM users WHERE")) {
        return { rows: [{ id: 7, tenant_id: 1, role, status: "Aktif" }] };
      }
      if (sql.includes("FROM user_unit_scope")) {
        return { rows: allowed.map((unit_id) => ({ unit_id })) };
      }
      if (sql.includes("FROM unit_pendidikan WHERE")) {
        const unit = fixtures.units.find((item) => item.id === Number(params[0]) && item.tenant_id === Number(params[1]));
        return { rows: unit ? [unit] : [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

function request(query = {}, user = { id: 7, tenant_id: 1 }) {
  return {
    user,
    tenantId: 1,
    query,
    params: {},
    body: {},
    headers: {},
  };
}

async function run() {
  const unitRoutes = fs.readFileSync(path.join(__dirname, "..", "routes", "unitRoutes.js"), "utf8");
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const profilRoutes = fs.readFileSync(path.join(__dirname, "..", "routes", "profilPesantrenRoutes.js"), "utf8");
  assert.match(unitRoutes, /router\.get\("\/", async \(req, res\)/, "GET /units must be an authenticated workspace bootstrap endpoint");
  assert.doesNotMatch(unitRoutes, /router\.get\("\/", requirePermission\("unit\.view"\)/, "GET /units must not require unit.view before resolving user_unit_scope");
  assert.match(unitRoutes, /getAllowedUnitIds\(req\.user, req\.tenantId\)/, "GET /units must still use central unit scope resolver");
  assert.doesNotMatch(server, /"\/profil-pesantren",\s*authMiddleware,\s*tenantMiddleware,\s*requirePermission\("profil\.view"\)/s, "GET /profil-pesantren must not be blocked by profil.view at the mount level");
  assert.match(profilRoutes, /pickSafeDisplayProfile/, "GET /profil-pesantren must expose only safe tenant display fields to users without profil.view");
  assert.match(profilRoutes, /requireAnyPermission\(\["profil\.view", "profil\.manage"\]\)/, "PUT /profil-pesantren must remain permission-protected");

  const db = dashboardDb();
  const allScope = { mode: "ALL", tenantId: 1, unitId: null, unit: null };
  const unitA = { mode: "UNIT", tenantId: 1, unitId: 10, unit: fixtures.units[0] };
  const unitB = { mode: "UNIT", tenantId: 1, unitId: 20, unit: fixtures.units[1] };

  assert.deepEqual(
    await queryDashboardSantriCounts(db, 1, allScope),
    { total: 3, aktif: 3, non_aktif: 1 },
    "Semua Unit must count unique santri identities, not memberships",
  );
  assert.deepEqual(
    await queryDashboardSantriCounts(db, 1, unitA),
    { total: 2, aktif: 2, non_aktif: 1 },
    "Unit A must count only Unit A active memberships",
  );
  assert.deepEqual(
    await queryDashboardSantriCounts(db, 1, unitB),
    { total: 2, aktif: 2, non_aktif: 0 },
    "Unit B must not leak Unit A data",
  );
  assert.equal(await queryDashboardKelasCount(db, 1, allScope), 3, "Semua Unit classes must aggregate active units");
  assert.equal(await queryDashboardKelasCount(db, 1, unitA), 2, "Unit A classes must be scoped");
  assert.equal(await queryDashboardKelasCount(db, 1, unitB), 1, "Unit B classes must be scoped");

  const superAll = await resolveActiveUnit(
    request({ scope: "all" }, { id: 7, tenant_id: 1 }),
    accessDb({ role: "superadmin", allowed: [] }),
  );
  assert.equal(superAll.mode, "ALL", "superadmin must receive Semua Unit without explicit unit scope");
  const superUnit = await resolveActiveUnit(
    request({ unit_id: "20" }, { id: 7, tenant_id: 1 }),
    accessDb({ role: "superadmin", allowed: [] }),
  );
  assert.equal(superUnit.unitId, 20, "superadmin must access MADINAH/unit workspace without explicit unit scope");

  const resolved = await resolveActiveUnit(request({}, { id: 7, tenant_id: 1 }), accessDb({ allowed: [10] }));
  assert.equal(resolved.unitId, 10, "single-unit operator should resolve to assigned unit");
  await assert.rejects(
    () => resolveActiveUnit(request({ unit_id: "20" }, { id: 7, tenant_id: 1 }), accessDb({ allowed: [10] })),
    (error) => error.status === 403 && error.code === "UNIT_ACCESS_DENIED",
    "operator must not request dashboard for another unit",
  );
  await assert.rejects(
    () => resolveActiveUnit(request({ unit_id: "99" }, { id: 7, tenant_id: 1 }), accessDb({ allowed: [99] })),
    (error) => error.status === 404 && error.code === "UNIT_NOT_FOUND",
    "cross-tenant unit must not be exposed",
  );
  await assert.rejects(
    () => resolveActiveUnit(request({}, { id: 7, tenant_id: 1 }), accessDb({ allowed: [] })),
    (error) => {
      const response = buildDashboardErrorResponse(error);
      assert.equal(response.status, 403, "operator without scope must return controlled 403, not 500");
      assert.equal(response.body.code, "UNIT_ACCESS_DENIED");
      assert.equal(response.body.meta.scope, "unresolved");
      return true;
    },
    "operator without scope must be controlled",
  );

  console.log("PASS dashboard unit scope: 13 count, isolation, and access assertions");
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
