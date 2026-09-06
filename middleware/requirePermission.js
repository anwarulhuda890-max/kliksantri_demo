const pool = require("../db");
const {
  isPlatformPermission,
  isPlatformRole,
  filterTenantPermissionKeys,
} = require("../utils/platformRbac");
const { expandWalletPermissions } = require("../config/walletAccessConfig");

let globalCache = null;
let cacheAt = 0;
const TTL = 60 * 1000;

async function loadGlobalMatrix() {
  const { rows } = await pool.query(
    `SELECT r.name AS role, p.key AS perm
     FROM role_permissions rp
     JOIN roles r       ON r.id = rp.role_id
     JOIN permissions p ON p.id = rp.permission_id`
  );

  const map = {};
  for (const { role, perm } of rows) {
    if (!map[role]) map[role] = new Set();
    map[role].add(perm);
  }

  globalCache = map;
  cacheAt = Date.now();
}

async function getTenantSystemOverride(role, tenantId) {
  const { rows } = await pool.query(
    `SELECT tro.has_permission_override, p.key AS perm
     FROM tenant_role_overrides tro
     JOIN roles r
       ON r.id = tro.role_id
      AND r.is_system = true
     LEFT JOIN tenant_role_permissions trp
       ON trp.tenant_id = tro.tenant_id
      AND trp.role_id = tro.role_id
     LEFT JOIN permissions p ON p.id = trp.permission_id
     WHERE tro.tenant_id = $1
       AND r.name = $2
       AND tro.has_permission_override = true`,
    [tenantId, role],
  );

  const override = rows.length
    ? new Set(rows.map((row) => row.perm).filter(Boolean))
    : null;
  return override;
}

async function getPermissions(role, tenantId = null) {
  if (!globalCache || Date.now() - cacheAt > TTL) {
    await loadGlobalMatrix();
  }

  let resolved = globalCache[role] || new Set();
  if (tenantId != null) {
    const override = await getTenantSystemOverride(role, tenantId);
    if (override !== null) resolved = override;
  }
  return expandWalletPermissions(resolved);
}

function requestTenantId(req) {
  return req.tenantId ?? req.user?.tenant_id ?? null;
}

function denyPlatformPermissionForTenant(req, res, permKey) {
  if (requestTenantId(req) && isPlatformPermission(permKey)) {
    res.status(403).json({
      success: false,
      error: "Akses ditolak",
      required: permKey,
    });
    return true;
  }
  return false;
}

function requireAnyPermission(permKeys) {
  return async (req, res, next) => {
    try {
      const role = req.user?.role;
      if (!role) {
        return res.status(401).json({ success: false, error: "Tidak terautentikasi" });
      }
      if (permKeys.some((key) => denyPlatformPermissionForTenant(req, res, key))) return;

      const perms = await getPermissions(role, requestTenantId(req));
      if (!permKeys.some((key) => perms.has(key))) {
        return res.status(403).json({
          success: false,
          error: "Akses ditolak",
          required: permKeys,
        });
      }
      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  };
}

function requirePermission(permKey) {
  return async (req, res, next) => {
    try {
      const role = req.user?.role;
      if (!role) {
        return res.status(401).json({ success: false, error: "Tidak terautentikasi" });
      }
      if (denyPlatformPermissionForTenant(req, res, permKey)) return;

      const perms = await getPermissions(role, requestTenantId(req));
      if (!perms.has(permKey)) {
        return res.status(403).json({
          success: false,
          error: "Akses ditolak",
          required: permKey,
        });
      }
      next();
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  };
}

requirePermission.invalidateCache = () => {
  globalCache = null;
};

requirePermission.getPermissionList = async (
  role,
  { tenantScoped = false, tenantId = null } = {},
) => {
  const perms = await getPermissions(role, tenantId);
  const list = [...perms];
  if (tenantScoped || !isPlatformRole(role)) {
    return filterTenantPermissionKeys(list);
  }
  return list;
};

requirePermission.requireAnyPermission = requireAnyPermission;
requirePermission._getPermissionsForTest = getPermissions;

module.exports = requirePermission;
