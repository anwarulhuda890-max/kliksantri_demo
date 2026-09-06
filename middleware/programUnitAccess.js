const pool = require("../db");
const requirePermission = require("./requirePermission");
const { getAllowedUnitIds } = require("../services/unitAccessService");

/**
 * Resolve program unit access for authenticated user within active tenant.
 */
async function resolveProgramUnitAccess(req) {
  const role = req.user?.role;
  const userId = req.user?.id;
  const tenantId = req.tenantId;

  if (!role || !userId) {
    return {
      denied: true,
      status: 401,
      error: "Tidak terautentikasi",
    };
  }

  if (!tenantId) {
    return {
      denied: true,
      status: 403,
      error: "Tenant context tidak tersedia",
    };
  }

  const perms = await requirePermission.getPermissionList(role, { tenantScoped: true, tenantId });
  const canView = perms.includes("program_unit.view");
  const canManage = perms.includes("program_unit.manage");

  if (!canView && !canManage) {
    return {
      denied: true,
      status: 403,
      error: "Akses ditolak",
    };
  }

  const unitIds = await getAllowedUnitIds(req.user, tenantId);
  if (unitIds === null) {
    return {
      mode: "ALL",
      unitIds: null,
      canManage: role === "superadmin" || canManage,
      tenantId,
    };
  }

  if (unitIds.length === 0) {
    return {
      denied: true,
      status: 403,
      error: "Unit scope belum diassign",
    };
  }

  return {
    mode: "SCOPED",
    unitIds,
    canManage: canManage,
    tenantId,
  };
}

async function getUnitByKode(kode, tenantId) {
  const { rows } = await pool.query(
    `SELECT id, kode, nama, is_active, tenant_id
     FROM unit_pendidikan
     WHERE UPPER(kode) = UPPER($1)
       AND tenant_id = $2`,
    [kode, tenantId]
  );
  return rows[0] || null;
}

async function getUnitById(unitId, tenantId) {
  const { rows } = await pool.query(
    `SELECT id, kode, nama, is_active, tenant_id
     FROM unit_pendidikan
     WHERE id = $1
       AND tenant_id = $2`,
    [unitId, tenantId]
  );
  return rows[0] || null;
}

function isUnitAllowed(access, unitId) {
  if (access.mode === "ALL") {
    return true;
  }
  return Array.isArray(access.unitIds) && access.unitIds.includes(unitId);
}

function unitScopeSql(access, unitColumn, startParamIndex) {
  if (access.mode === "ALL") {
    return { clause: "", params: [], nextIndex: startParamIndex };
  }

  return {
    clause: ` AND ${unitColumn} = ANY($${startParamIndex}::int[])`,
    params: [access.unitIds],
    nextIndex: startParamIndex + 1,
  };
}

module.exports = {
  resolveProgramUnitAccess,
  getUnitByKode,
  getUnitById,
  isUnitAllowed,
  unitScopeSql,
};
