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

async function getOrCreateWalletAccountForSantri(client, { tenantId, unitId, santriId }) {
  const membership = await client.query(
    `SELECT s.id AS santri_id, s.nama, s.status AS santri_status
     FROM santri_units su
     JOIN santri s
       ON s.id = su.santri_id
      AND s.tenant_id = su.tenant_id
     WHERE su.tenant_id = $1
       AND su.unit_id = $2
       AND su.santri_id = $3
       AND su.status = 'active'
       AND su.left_at IS NULL
     LIMIT 1`,
    [tenantId, unitId, santriId],
  );

  if (membership.rows.length === 0) return null;

  const { rows } = await client.query(
    `INSERT INTO wallet_accounts (tenant_id, unit_id, santri_id, current_balance, status)
     VALUES ($1, $2, $3, 0, 'active')
     ON CONFLICT (tenant_id, unit_id, santri_id) DO UPDATE
       SET updated_at = wallet_accounts.updated_at
     RETURNING id, tenant_id, unit_id, santri_id, current_balance, status`,
    [tenantId, unitId, santriId],
  );

  return {
    ...rows[0],
    nama: membership.rows[0].nama,
    santri_status: membership.rows[0].santri_status,
  };
}

function isSantriAktif(status) {
  const normalized = String(status ?? "aktif").trim().toLowerCase();
  return normalized === "" || normalized === "aktif" || normalized === "active";
}

module.exports = {
  getWalletAccountForSantri,
  getOrCreateWalletAccountForSantri,
  isSantriAktif,
  resolveWalletAccess,
  sendUnitError,
};
