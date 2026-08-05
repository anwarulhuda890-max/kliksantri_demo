const pool = require("../db");

const ALL_UNIT_ROLES = new Set(["superadmin", "pimpinan_yayasan"]);

function accessError(message, status = 403, code = "UNIT_ACCESS_DENIED") {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function canAccessAllUnits(user) {
  return Boolean(user && ALL_UNIT_ROLES.has(String(user.role || "")));
}

async function loadVerifiedUser(user, tenantId, client = pool) {
  if (!user?.id || !tenantId) throw accessError("Tenant context tidak tersedia");
  const { rows } = await client.query(
    `SELECT id, tenant_id, role, status FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [user.id, tenantId],
  );
  const verified = rows[0];
  const status = String(verified?.status || "").trim().toLowerCase();
  if (!verified || !["aktif", "active"].includes(status)) {
    throw accessError("Akun tidak aktif atau berada di luar tenant");
  }
  return verified;
}

async function getAllowedUnitIds(user, tenantId = user?.tenant_id, client = pool) {
  const verified = await loadVerifiedUser(user, tenantId, client);
  if (canAccessAllUnits(verified)) return null;
  const { rows } = await client.query(
    `SELECT scope.unit_id
     FROM user_unit_scope scope
     JOIN unit_pendidikan unit
       ON unit.id = scope.unit_id AND unit.tenant_id = $2 AND unit.is_active = true
     WHERE scope.user_id = $1
       AND scope.tenant_id = $2
       AND scope.status = 'active'
     ORDER BY unit.sort_order, unit.id`,
    [verified.id, tenantId],
  );
  return rows.map((row) => Number(row.unit_id));
}

async function assertUnitAccess(user, unitId, tenantId = user?.tenant_id, client = pool) {
  const requestedUnitId = Number(unitId);
  if (!Number.isInteger(requestedUnitId) || requestedUnitId <= 0) {
    throw accessError("Unit tidak valid", 400, "INVALID_UNIT");
  }
  const verified = await loadVerifiedUser(user, tenantId, client);
  const { rows } = await client.query(
    `SELECT id, tenant_id, kode, nama, unit_type, preset_key, is_active
     FROM unit_pendidikan WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [requestedUnitId, tenantId],
  );
  const unit = rows[0];
  if (!unit) throw accessError("Unit tidak ditemukan", 404, "UNIT_NOT_FOUND");
  if (!unit.is_active) throw accessError("Unit tidak aktif", 403, "UNIT_INACTIVE");
  if (!canAccessAllUnits(verified)) {
    const allowed = await getAllowedUnitIds(verified, tenantId, client);
    if (!allowed.includes(requestedUnitId)) {
      throw accessError("Akses unit ditolak");
    }
  }
  return unit;
}

function requestedUnitValue(req) {
  return req.params?.unitId ?? req.params?.unit_id ?? req.body?.unit_id ??
    req.query?.unit_id ?? req.headers?.["x-unit-id"] ?? null;
}

async function resolveActiveUnit(req, client = pool) {
  const tenantId = Number(req.tenantId ?? req.user?.tenant_id);
  const verified = await loadVerifiedUser(req.user, tenantId, client);
  const requested = requestedUnitValue(req);
  const wantsAll = String(req.query?.scope || req.headers?.["x-unit-scope"] || "").toLowerCase() === "all";

  if (wantsAll) {
    if (!canAccessAllUnits(verified)) throw accessError("Scope semua unit ditolak");
    return { mode: "ALL", tenantId, unitId: null, unit: null };
  }
  if (requested != null && requested !== "") {
    const unit = await assertUnitAccess(verified, requested, tenantId, client);
    return { mode: "UNIT", tenantId, unitId: Number(unit.id), unit };
  }
  if (canAccessAllUnits(verified)) {
    return { mode: "ALL", tenantId, unitId: null, unit: null };
  }
  const allowed = await getAllowedUnitIds(verified, tenantId, client);
  if (allowed.length === 1) {
    const unit = await assertUnitAccess(verified, allowed[0], tenantId, client);
    return { mode: "UNIT", tenantId, unitId: allowed[0], unit };
  }
  if (allowed.length === 0) throw accessError("Unit scope belum diassign");
  throw accessError("Pilih unit aktif", 400, "UNIT_REQUIRED");
}

module.exports = {
  ALL_UNIT_ROLES,
  accessError,
  assertUnitAccess,
  canAccessAllUnits,
  getAllowedUnitIds,
  loadVerifiedUser,
  resolveActiveUnit,
};
