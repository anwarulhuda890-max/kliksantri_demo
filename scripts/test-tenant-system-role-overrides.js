const assert = require("assert");
const fs = require("fs");
const path = require("path");

const state = {
  global: {
    superadmin: ["role.manage", "dashboard.view", "santri.view"],
    tenant_11_operator: ["dashboard.view"],
  },
  overrides: new Map(),
};

function normalized(sql) {
  return String(sql).replace(/\s+/g, " ").trim();
}

const fakePool = {
  async query(sql, params = []) {
    const query = normalized(sql);
    if (query.startsWith("SELECT r.name AS role, p.key AS perm")) {
      return {
        rows: Object.entries(state.global).flatMap(([role, permissions]) =>
          permissions.map((perm) => ({ role, perm }))),
      };
    }
    if (query.includes("FROM tenant_role_overrides tro") && query.includes("r.is_system = true")) {
      const [tenantId, role] = params;
      const override = state.overrides.get(`${tenantId}:${role}`);
      if (!override) return { rows: [] };
      if (!override.permissions.length) {
        return { rows: [{ has_permission_override: true, perm: null }] };
      }
      return {
        rows: override.permissions.map((perm) => ({ has_permission_override: true, perm })),
      };
    }
    throw new Error(`Unexpected mock SQL: ${query}`);
  },
};

const dbPath = require.resolve("../db");
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: fakePool };
const requirePermission = require("../middleware/requirePermission");
const {
  canTenantEditRole,
  canTenantDeleteRole,
  validateRoleMutationBody,
} = require("../services/rolePolicy");

function runMiddleware(middleware, req) {
  return new Promise((resolve, reject) => {
    let responseStatus = 200;
    const res = {
      status(status) { responseStatus = status; return this; },
      json(body) { resolve({ status: responseStatus, body, next: false }); },
    };
    Promise.resolve(middleware(req, res, () => resolve({ status: 200, next: true }))).catch(reject);
  });
}

async function run() {
  const tenantA = 11;
  const tenantB = 22;
  const globalBefore = JSON.stringify(state.global);

  const aFallback = await requirePermission.getPermissionList("superadmin", { tenantScoped: true, tenantId: tenantA });
  const bFallback = await requirePermission.getPermissionList("superadmin", { tenantScoped: true, tenantId: tenantB });
  assert.deepEqual(new Set(aFallback), new Set(state.global.superadmin));
  assert.deepEqual(new Set(bFallback), new Set(state.global.superadmin));

  state.overrides.set(`${tenantA}:superadmin`, {
    permissions: ["dashboard.view", "role.manage"],
  });
  requirePermission.invalidateCache();
  const aOverride = await requirePermission.getPermissionList("superadmin", { tenantScoped: true, tenantId: tenantA });
  const bUnchanged = await requirePermission.getPermissionList("superadmin", { tenantScoped: true, tenantId: tenantB });
  assert.deepEqual(new Set(aOverride), new Set(["dashboard.view", "role.manage"]));
  assert.deepEqual(new Set(bUnchanged), new Set(state.global.superadmin));
  assert.equal(JSON.stringify(state.global), globalBefore);
  assert.equal(canTenantEditRole({ name: "superadmin", is_system: true }, tenantA), true);
  assert.equal(canTenantDeleteRole({ name: "superadmin", is_system: true }, tenantA), false);
  assert.equal(canTenantEditRole({ name: "tenant_11_operator", is_system: false }, tenantA), true);
  assert.equal(canTenantEditRole({ name: "tenant_11_operator", is_system: false }, tenantB), false);
  assert.equal(validateRoleMutationBody({ permissions: [], name: "spoof" }).code, "PROTECTED_ROLE_FIELD");
  assert.equal(validateRoleMutationBody({ permissions: [], is_system: false }).code, "PROTECTED_ROLE_FIELD");
  assert.equal(validateRoleMutationBody({ permissions: [], tenant_id: tenantB }).code, "PROTECTED_ROLE_FIELD");
  assert.equal(validateRoleMutationBody({ permissions: [], label: "Label Tenant" }), null);

  state.overrides.set(`${tenantA}:superadmin`, { permissions: ["dashboard.view"] });
  requirePermission.invalidateCache();
  const deniedA = await runMiddleware(
    requirePermission("role.manage"),
    { user: { role: "superadmin", tenant_id: tenantA }, tenantId: tenantA },
  );
  const allowedB = await runMiddleware(
    requirePermission("role.manage"),
    { user: { role: "superadmin", tenant_id: tenantB }, tenantId: tenantB },
  );
  assert.equal(deniedA.status, 403);
  assert.equal(allowedB.next, true);

  state.overrides.set(`${tenantA}:superadmin`, {
    permissions: ["dashboard.view", "role.manage", "santri.view"],
  });
  requirePermission.invalidateCache();
  const aAdded = await requirePermission.getPermissionList("superadmin", { tenantScoped: true, tenantId: tenantA });
  assert(aAdded.includes("santri.view"));
  assert.deepEqual(
    new Set(await requirePermission.getPermissionList("tenant_11_operator", { tenantScoped: true, tenantId: tenantA })),
    new Set(["dashboard.view"]),
  );

  const migration = fs.readFileSync(path.join(__dirname, "../migrations/088_tenant_system_role_permission_overrides.sql"), "utf8");
  const roleRoute = fs.readFileSync(path.join(__dirname, "../routes/roleRoutes.js"), "utf8");
  const ui = fs.readFileSync(path.join(__dirname, "../frontend/src/pages/RolesPage.jsx"), "utf8");
  assert.match(migration, /PRIMARY KEY \(tenant_id, role_id\)/);
  assert.match(migration, /enforce_tenant_system_role_override/);
  assert.match(migration, /is_system IS DISTINCT FROM TRUE/);
  assert.match(migration, /bump_tenant_role_members_token_version/);
  const rolePolicy = fs.readFileSync(path.join(__dirname, "../services/rolePolicy.js"), "utf8");
  assert.match(rolePolicy, /MUTABLE_FIELDS = new Set\(\["permissions", "label"\]\)/);
  assert.match(rolePolicy, /PROTECTED_ROLE_FIELD/);
  assert.match(roleRoute, /tenant_role_permissions/);
  assert.match(roleRoute, /Role sistem tidak boleh dihapus/);
  assert.match(ui, /Nama Internal/);
  assert.match(ui, /disabled readOnly/);
  assert.match(ui, /hidden: rbacReadOnly \|\| r\.is_system/);

  console.log("PASS tenant system role overrides: 31 assertions");
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
