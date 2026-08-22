const pool = require("../db");
const { accessError, resolveActiveUnit } = require("./unitAccessService");

function sendUnitError(res, error, fallback = "Akses ditolak") {
  res.status(error.status || 500).json({
    success: false,
    error: error.status ? error.message : fallback,
    code: error.code,
  });
}

async function resolveWalletAccess(req, client = pool, { requireSpecific = false } = {}) {
  const access = await resolveActiveUnit(req, client);
  if (requireSpecific && access.mode !== "UNIT") {
    throw accessError("Pilih unit aktif", 400, "UNIT_REQUIRED");
  }
  return access;
}

async function getWalletAccountForSantri(client, { tenantId, unitId, santriId, lock = false }) {
  const { rows } = await client.query(
    `SELECT wa.id, wa.tenant_id, wa.unit_id, wa.santri_id, wa.current_balance, wa.status,
            s.nama, s.status AS santri_status
     FROM wallet_accounts wa
     JOIN santri s
       ON s.id = wa.santri_id
      AND s.tenant_id = wa.tenant_id
     WHERE wa.tenant_id = $1
       AND wa.unit_id = $2
       AND wa.santri_id = $3
     ${lock ? "FOR UPDATE OF wa" : ""}`,
    [tenantId, unitId, santriId],
  );
  return rows[0] || null;
}

function isSantriAktif(status) {
  const normalized = String(status ?? "aktif").trim().toLowerCase();
  return normalized === "" || normalized === "aktif" || normalized === "active";
}

module.exports = {
  getWalletAccountForSantri,
  isSantriAktif,
  resolveWalletAccess,
  sendUnitError,
};
