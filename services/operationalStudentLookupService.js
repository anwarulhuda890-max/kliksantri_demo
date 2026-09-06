const pool = require("../db");
const { accessError } = require("./unitAccessService");
const { resolveOperationalAccess } = require("./operationalUnitService");

const ACTIVE_SANTRI_SQL =
  "LOWER(TRIM(COALESCE(s.status, 'aktif'))) IN ('aktif','active','')";

async function listOperationalStudents(
  req,
  client = pool,
  { resolveAccess = resolveOperationalAccess } = {},
) {
  const requestedUnitId = req.query?.unit_id ?? req.headers?.["x-unit-id"];
  if (requestedUnitId == null || requestedUnitId === "") {
    throw accessError("Pilih unit aktif", 400, "UNIT_REQUIRED");
  }
  const access = await resolveAccess(req, client, { requireSpecific: true });
  const search = String(req.query?.search || "").trim();
  const { rows } = await client.query(
    `SELECT DISTINCT ON (s.id)
            s.id, s.nama, s.nis,
            su.id AS santri_unit_id,
            enrollment.kelas_id,
            k.nama_kelas
     FROM santri_units su
     JOIN santri s ON s.id = su.santri_id AND s.tenant_id = su.tenant_id
     LEFT JOIN LATERAL (
       SELECT ske.kelas_id
       FROM santri_kelas_enrollments ske
       WHERE ske.tenant_id = su.tenant_id
         AND ske.santri_unit_id = su.id
         AND ske.status = 'active'
         AND ske.end_date IS NULL
       ORDER BY ske.id DESC LIMIT 1
     ) enrollment ON TRUE
     LEFT JOIN kelas k
       ON k.id = enrollment.kelas_id
      AND k.tenant_id = su.tenant_id
      AND k.unit_id = su.unit_id
     WHERE su.tenant_id = $1
       AND su.unit_id = $2
       AND su.status = 'active'
       AND su.left_at IS NULL
       AND ${ACTIVE_SANTRI_SQL}
       AND ($3::text = '' OR s.nama ILIKE '%' || $3 || '%' OR COALESCE(s.nis, '') ILIKE '%' || $3 || '%')
     ORDER BY s.id, su.id DESC`,
    [req.tenantId, access.unitId, search],
  );
  return { rows, access };
}

module.exports = { listOperationalStudents };
