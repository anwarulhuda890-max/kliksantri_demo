const pool = require('../db');
const { isUnitFeatureEnabled } = require('../services/unitFeatureService');

function waliUnitError(message, status = 403, code = 'UNIT_ACCESS_DENIED') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

async function resolveWaliUnit(req, client = pool) {
  if (!req.santriId || !req.tenantId) {
    throw waliUnitError('Profil anak belum dipilih', 400, 'SANTRI_REQUIRED');
  }

  const rawUnitId = req.headers['x-unit-id'];
  const requestedUnitId = rawUnitId == null || rawUnitId === '' ? null : Number(rawUnitId);
  if (requestedUnitId != null && (!Number.isInteger(requestedUnitId) || requestedUnitId <= 0)) {
    throw waliUnitError('Unit tidak valid', 400, 'INVALID_UNIT');
  }

  const { rows } = await client.query(
    `SELECT su.id AS santri_unit_id, su.unit_id, u.kode AS unit_kode,
            u.nama AS unit_nama, u.unit_type, u.preset_key
     FROM santri_units su
     JOIN unit_pendidikan u
       ON u.id = su.unit_id AND u.tenant_id = su.tenant_id AND u.is_active = true
     WHERE su.tenant_id = $1
       AND su.santri_id = $2
       AND su.status = 'active'
       AND su.left_at IS NULL
       AND ($3::integer IS NULL OR su.unit_id = $3)
     ORDER BY su.is_primary DESC, su.id ASC
     LIMIT 2`,
    [req.tenantId, req.santriId, requestedUnitId],
  );

  if (requestedUnitId != null && rows.length === 0) {
    throw waliUnitError('Santri tidak terdaftar pada unit aktif', 403, 'UNIT_ACCESS_DENIED');
  }
  if (rows.length === 0) {
    throw waliUnitError('Santri belum memiliki unit aktif', 403, 'UNIT_SCOPE_UNASSIGNED');
  }
  if (requestedUnitId == null && rows.length > 1) {
    throw waliUnitError('Pilih unit aktif', 400, 'UNIT_REQUIRED');
  }
  return rows[0];
}

function requireWaliUnitFeature(featureKey) {
  return async (req, res, next) => {
    try {
      const unit = await resolveWaliUnit(req);
      const enabled = await isUnitFeatureEnabled(req.tenantId, unit.unit_id, featureKey);
      if (!enabled) {
        return res.status(403).json({
          success: false,
          error: 'Fitur tidak aktif untuk unit ini',
          feature: featureKey,
          code: 'UNIT_FEATURE_DISABLED',
        });
      }
      req.waliUnit = unit;
      return next();
    } catch (error) {
      return res.status(error.status || 500).json({
        success: false,
        error: error.status ? error.message : 'Validasi unit anak gagal',
        code: error.code,
      });
    }
  };
}

async function requireWaliUnit(req, res, next) {
  try {
    req.waliUnit = await resolveWaliUnit(req);
    return next();
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.status ? error.message : 'Validasi unit anak gagal',
      code: error.code,
    });
  }
}

module.exports = { requireWaliUnit, requireWaliUnitFeature, resolveWaliUnit };
