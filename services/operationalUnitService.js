const pool = require("../db");
const { accessError, resolveActiveUnit } = require("./unitAccessService");

function sendUnitError(res, error, fallback = "Akses unit ditolak") {
  res.status(error.status || 500).json({
    success: false,
    error: error.status ? error.message : fallback,
    code: error.code,
  });
}

function requireSpecificUnit(access) {
  if (access.mode !== "UNIT") {
    throw accessError("Pilih unit aktif", 400, "UNIT_REQUIRED");
  }
}

async function resolveOperationalAccess(req, client = pool, { requireSpecific = false } = {}) {
  const access = await resolveActiveUnit(req, client);
  if (requireSpecific) requireSpecificUnit(access);
  return access;
}

async function getActiveSantriMembership(client, tenantId, santriId, unitId) {
  const { rows } = await client.query(
    `SELECT su.id AS santri_unit_id, su.unit_id
     FROM santri_units su
     JOIN santri s
       ON s.id = su.santri_id
      AND s.tenant_id = su.tenant_id
     WHERE su.tenant_id = $1
       AND su.santri_id = $2
       AND su.unit_id = $3
       AND su.status = 'active'
       AND su.left_at IS NULL
     LIMIT 1`,
    [tenantId, santriId, unitId],
  );
  return rows[0] || null;
}

async function requireSantriInActiveUnit(client, tenantId, santriId, unitId) {
  const membership = await getActiveSantriMembership(client, tenantId, santriId, unitId);
  if (!membership) {
    throw accessError("Santri berada di luar unit aktif", 403, "UNIT_ACCESS_DENIED");
  }
  return membership;
}

function accessResponse(access) {
  return {
    all_units: access.mode === "ALL",
    unit_id: access.mode === "UNIT" ? access.unitId : null,
  };
}

module.exports = {
  accessResponse,
  getActiveSantriMembership,
  requireSantriInActiveUnit,
  requireSpecificUnit,
  resolveOperationalAccess,
  sendUnitError,
};
