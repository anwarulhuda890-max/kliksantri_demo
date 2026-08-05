const pool = require("../db");
const { getAllowedUnitIds } = require("../services/unitAccessService");

async function getScopedKelasIds(req, client = pool) {
  const unitIds = await getAllowedUnitIds(req.user, req.tenantId, client);
  if (unitIds === null) return null;
  if (unitIds.length === 0) return [];
  const result = await client.query(
    `SELECT DISTINCT k.id AS kelas_id
     FROM kelas k
     WHERE k.tenant_id = $1 AND k.unit_id = ANY($2::int[])`,
    [req.tenantId, unitIds],
  );
  return result.rows.map((row) => Number(row.kelas_id));
}

async function getScopedUnitIds(req, client = pool) {
  return getAllowedUnitIds(req.user, req.tenantId, client);
}

async function assertSantriInScopedUnit(req, santriId, client = pool) {
  const kelasIds = await getScopedKelasIds(req, client);
  if (!kelasIds) return { ok: true };
  const result = await client.query(
    `SELECT s.id
     FROM santri s
     WHERE s.id = $1 AND s.tenant_id = $2 AND s.kelas_id = ANY($3::int[])`,
    [santriId, req.tenantId, kelasIds],
  );
  return result.rows.length
    ? { ok: true }
    : { ok: false, error: "Data berada di luar unit operator" };
}

async function assertKelasInScopedUnit(req, kelasId, client = pool) {
  if (kelasId === null || kelasId === undefined || kelasId === "") return { ok: true };
  const kelasIds = await getScopedKelasIds(req, client);
  if (!kelasIds || kelasIds.includes(Number(kelasId))) return { ok: true };
  return { ok: false, error: "Kelas berada di luar unit operator" };
}

module.exports = { getScopedKelasIds, getScopedUnitIds, assertSantriInScopedUnit, assertKelasInScopedUnit };
