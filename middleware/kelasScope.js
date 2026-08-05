const pool = require("../db");
const requirePermission = require("./requirePermission");
const { getAllowedUnitIds } = require("../services/unitAccessService");

async function resolveKelasScopeAccess(req) {
  const role = req.user?.role;
  const userId = req.user?.id;
  const tenantId = req.tenantId;

  if (!role || !userId) {
    return { denied: true, status: 401, error: "Tidak terautentikasi" };
  }

  if (!tenantId) {
    return { denied: true, status: 403, error: "Tenant context tidak tersedia" };
  }

  const perms = await requirePermission.getPermissionList(role, {
    tenantScoped: true,
  });
  const canView = perms.includes("absensi.view");
  const canManage =
    perms.includes("absensi.manage") ||
    perms.includes("absensi.create") ||
    perms.includes("absensi.update");

  if (!canView && !canManage) {
    return { denied: true, status: 403, error: "Akses ditolak" };
  }

  const unitIds = await getAllowedUnitIds(req.user, tenantId);
  if (unitIds === null) {
    return {
      mode: "ALL",
      kelasIds: null,
      canManage,
      tenantId,
    };
  }

  const { rows } = await pool.query(
    `SELECT s.kelas_id
     FROM user_kelas_scope s
     INNER JOIN users usr ON usr.id = s.user_id AND usr.tenant_id = $2
     INNER JOIN kelas k ON k.id = s.kelas_id AND k.tenant_id = $2
     WHERE s.user_id = $1
       AND s.tenant_id = $2
       AND k.unit_id = ANY($3::int[])`,
    [userId, tenantId, unitIds]
  );

  if (rows.length > 0) {
    return {
      mode: "SCOPED",
      kelasIds: rows.map((r) => r.kelas_id),
      canManage,
      tenantId,
    };
  }

  const unitRows = unitIds.length
    ? await pool.query(
      `SELECT DISTINCT id AS kelas_id FROM kelas
       WHERE tenant_id = $1 AND unit_id = ANY($2::int[])`,
      [tenantId, unitIds],
    )
    : { rows: [] };
  if (unitRows.rows.length === 0) {
    return { denied: true, status: 403, error: "Unit atau kelas scope belum diassign" };
  }

  return {
    mode: "SCOPED",
    kelasIds: unitRows.rows.map((r) => r.kelas_id),
    canManage,
    tenantId,
  };
}

function isKelasAllowed(access, kelasId) {
  if (access.mode === "ALL") return true;
  return Array.isArray(access.kelasIds) && access.kelasIds.includes(Number(kelasId));
}

function kelasScopeSql(access, kelasColumn, startParamIndex) {
  if (access.mode === "ALL") {
    return { clause: "", params: [], nextIndex: startParamIndex };
  }

  return {
    clause: ` AND ${kelasColumn} = ANY($${startParamIndex}::int[])`,
    params: [access.kelasIds],
    nextIndex: startParamIndex + 1,
  };
}

module.exports = {
  resolveKelasScopeAccess,
  isKelasAllowed,
  kelasScopeSql,
};
