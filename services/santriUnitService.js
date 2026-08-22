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

async function getActiveMembership(tenantId, santriId, unitId, client = pool) {
  const { rows } = await client.query(
    `SELECT su.*, u.kode AS unit_kode, u.nama AS unit_nama
     FROM santri_units su
     JOIN unit_pendidikan u
       ON u.id = su.unit_id AND u.tenant_id = su.tenant_id
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

async function assertSantriUnitAccess(tenantId, santriId, unitId, client = pool) {
  const membership = await getActiveMembership(tenantId, santriId, unitId, client);
  if (!membership) {
    const error = new Error("Santri tidak ditemukan pada unit aktif");
    error.status = 404;
    error.code = "SANTRI_UNIT_NOT_FOUND";
    throw error;
  }
  return membership;
}

async function getClassInUnit(tenantId, kelasId, unitId, client = pool) {
  if (kelasId === null || kelasId === undefined || kelasId === "") return null;
  const { rows } = await client.query(
    `SELECT id, tenant_id, unit_id, nama_kelas
     FROM kelas
     WHERE id = $1 AND tenant_id = $2 AND unit_id = $3
     LIMIT 1`,
    [kelasId, tenantId, unitId],
  );
  if (!rows[0]) {
    const error = new Error("Kelas tidak berada pada unit aktif");
    error.status = 403;
    error.code = "CROSS_UNIT_CLASS";
    throw error;
  }
  return rows[0];
}

async function assignClassEnrollment({ tenantId, membership, kelasId }, client = pool) {
  if (!membership?.id || Number(membership.tenant_id) !== Number(tenantId)) {
    throw Object.assign(new Error("Membership santri tidak valid"), {
      status: 400,
      code: "INVALID_SANTRI_MEMBERSHIP",
    });
  }

  const kelas = await getClassInUnit(tenantId, kelasId, membership.unit_id, client);
  const active = await client.query(
    `SELECT e.id, e.kelas_id
     FROM santri_kelas_enrollments e
     WHERE e.tenant_id = $1
       AND e.santri_unit_id = $2
       AND e.status = 'active'
       AND e.end_date IS NULL
     FOR UPDATE`,
    [tenantId, membership.id],
  );

  if (!kelas) {
    if (active.rows.length) {
      await client.query(
        `UPDATE santri_kelas_enrollments
         SET status = 'moved', end_date = CURRENT_DATE, updated_at = NOW()
         WHERE tenant_id = $1 AND santri_unit_id = $2
           AND status = 'active' AND end_date IS NULL`,
        [tenantId, membership.id],
      );
    }
    return null;
  }

  if (active.rows.some((row) => Number(row.kelas_id) === Number(kelas.id))) {
    return active.rows.find((row) => Number(row.kelas_id) === Number(kelas.id));
  }

  if (active.rows.length) {
    await client.query(
      `UPDATE santri_kelas_enrollments
       SET status = 'moved', end_date = CURRENT_DATE, updated_at = NOW()
       WHERE tenant_id = $1 AND santri_unit_id = $2
         AND status = 'active' AND end_date IS NULL`,
      [tenantId, membership.id],
    );
  }

  const { rows } = await client.query(
    `INSERT INTO santri_kelas_enrollments
       (tenant_id, santri_unit_id, kelas_id, start_date, status)
     VALUES ($1, $2, $3, CURRENT_DATE, 'active')
     RETURNING *`,
    [tenantId, membership.id, kelas.id],
  );
  return rows[0];
}

async function syncLegacyClass(tenantId, santriId, membership, kelasId, client = pool) {
  const current = await client.query(
    `SELECT s.kelas_id, legacy.unit_id AS legacy_unit_id
     FROM santri s
     LEFT JOIN kelas legacy
       ON legacy.id = s.kelas_id AND legacy.tenant_id = s.tenant_id
     WHERE s.id = $1 AND s.tenant_id = $2
     FOR UPDATE OF s`,
    [santriId, tenantId],
  );
  const row = current.rows[0];
  if (!row) return false;

  const mayOwnCompatibilityField = membership.is_primary === true || row.kelas_id == null ||
    Number(row.legacy_unit_id) === Number(membership.unit_id);
  if (!mayOwnCompatibilityField) return false;

  await client.query(
    `UPDATE santri SET kelas_id = $1 WHERE id = $2 AND tenant_id = $3`,
    [kelasId || null, santriId, tenantId],
  );
  return true;
}

async function createMembershipWithEnrollment(payload, client = pool) {
  const membership = await createMembership(payload, client);
  await assignClassEnrollment({
    tenantId: payload.tenant_id,
    membership,
    kelasId: payload.kelas_id || null,
  }, client);
  await syncLegacyClass(
    payload.tenant_id,
    payload.santri_id,
    membership,
    payload.kelas_id || null,
    client,
  );
  return membership;
}

module.exports = {
  assertSantriUnitAccess,
  assignClassEnrollment,
  createMembership,
  createMembershipWithEnrollment,
  getActiveMembership,
  getClassInUnit,
  syncLegacyClass,
};
