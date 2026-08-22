const pool = require("../db");
const { resolveActiveUnit } = require("../services/unitAccessService");

async function getScopedKelasIds(req, client = pool) {
  const unitIds = await getScopedUnitIds(req, client);
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
  const access = await resolveActiveUnit(req, client);
  return access.mode === "ALL" ? null : [access.unitId];
}

async function assertSantriInScopedUnit(req, santriId, client = pool) {
  const unitIds = await getScopedUnitIds(req, client);
  if (!unitIds) return { ok: true };
  const result = await client.query(
    `SELECT s.id
     FROM santri s
     JOIN santri_units su
       ON su.santri_id = s.id AND su.tenant_id = s.tenant_id
      AND su.status = 'active' AND su.left_at IS NULL
     WHERE s.id = $1 AND s.tenant_id = $2 AND su.unit_id = ANY($3::int[])
     LIMIT 1`,
    [santriId, req.tenantId, unitIds],
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
