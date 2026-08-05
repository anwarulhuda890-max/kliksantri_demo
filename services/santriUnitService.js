const pool = require("../db");

async function createMembership(payload, client = pool) {
  const tenantId = Number(payload.tenant_id);
  const santriId = Number(payload.santri_id);
  const unitId = Number(payload.unit_id);
  if (![tenantId, santriId, unitId].every(Number.isInteger)) {
    throw Object.assign(new Error("Tenant, santri, dan unit wajib valid"), { status: 400 });
  }

  const ownership = await client.query(
    `SELECT s.id AS santri_id, u.id AS unit_id
     FROM santri s
     JOIN unit_pendidikan u ON u.id = $3 AND u.tenant_id = $1 AND u.is_active = true
     WHERE s.id = $2 AND s.tenant_id = $1`,
    [tenantId, santriId, unitId],
  );
  if (!ownership.rows.length) {
    throw Object.assign(new Error("Santri dan unit harus berada pada tenant yang sama"), {
      status: 400,
      code: "CROSS_TENANT_MEMBERSHIP",
    });
  }

  try {
    const { rows } = await client.query(
      `INSERT INTO santri_units
       (tenant_id, santri_id, unit_id, unit_student_number, status, joined_at, is_primary, metadata)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7::jsonb)
       RETURNING *`,
      [tenantId, santriId, unitId, payload.unit_student_number || null,
        payload.joined_at || null, payload.is_primary === true,
        JSON.stringify(payload.metadata || {})],
    );
    return rows[0];
  } catch (error) {
    if (error.code === "23505") {
      throw Object.assign(new Error("Membership aktif sudah ada"), {
        status: 409,
        code: "DUPLICATE_ACTIVE_MEMBERSHIP",
      });
    }
    throw error;
  }
}

module.exports = { createMembership };
