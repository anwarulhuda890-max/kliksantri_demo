require("dotenv").config();

const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { WALI_JWT_SECRET } = require("../config/authSecrets");

const WALI_JWT_EXPIRES = process.env.WALI_JWT_EXPIRES || "30d";
const WALI_JWT_ISSUER = "kliksantri-wali";
const WALI_JWT_AUDIENCE = "klikpesantren-wali-app";
const WALI_JWT_ALGORITHM = "HS256";
const ALLOW_LEGACY_WALI_TOKEN_WITHOUT_AUDIENCE =
  process.env.WALI_JWT_ALLOW_LEGACY_NO_AUD !== "false";
const WALI_TOKEN_VERSION_ENABLED =
  process.env.WALI_TOKEN_VERSION_ENABLED === "true";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const BLOCKED_PINS = ["000000", "123456", "111111", "456789", "654321"];

const normalizePhone = (raw) => {
  if (raw === undefined || raw === null || raw === "") {
    return null;
  }

  let digits = String(raw).replace(/\D/g, "");
  if (digits.length === 0) {
    return null;
  }

  if (digits.startsWith("62")) {
    digits = "0" + digits.slice(2);
  } else if (!digits.startsWith("0")) {
    digits = "0" + digits;
  }

  return digits;
};

const isValidPin = (pin) => {
  if (typeof pin !== "string" && typeof pin !== "number") {
    return false;
  }

  const value = String(pin);
  if (!/^\d{6}$/.test(value)) {
    return false;
  }

  if (BLOCKED_PINS.includes(value)) {
    return false;
  }

  return true;
};

const isValidPinFormat = (pin) => {
  if (typeof pin !== "string" && typeof pin !== "number") {
    return false;
  }

  return /^\d{6}$/.test(String(pin));
};

const hashPin = async (pin) => bcrypt.hash(String(pin), 10);

const verifyPin = async (plainPin, pinHash) =>
  bcrypt.compare(String(plainPin), pinHash);

const findAkunByPhone = async (nomorHp, tenantId) => {
  const result = await pool.query(
    `
    SELECT *
    FROM wali_akun
    WHERE nomor_hp = $1
      AND tenant_id = $2
    LIMIT 1
    `,
    [nomorHp, tenantId]
  );
  return result.rows[0] || null;
};

const isAccountLocked = (akun) => {
  if (!akun || !akun.locked_until) {
    return false;
  }
  return new Date(akun.locked_until) > new Date();
};

const registerFailedLogin = async (akunId) => {
  const result = await pool.query(
    `
    UPDATE wali_akun
    SET
      failed_attempts = failed_attempts + 1,
      locked_until = CASE
        WHEN failed_attempts + 1 >= $2
        THEN NOW() + ($3 || ' minutes')::INTERVAL
        ELSE locked_until
      END,
      updated_at = NOW()
    WHERE id = $1
    RETURNING failed_attempts, locked_until
    `,
    [akunId, MAX_FAILED_ATTEMPTS, String(LOCKOUT_MINUTES)]
  );
  return result.rows[0];
};

const registerSuccessfulLogin = async (akunId) => {
  await pool.query(
    `
    UPDATE wali_akun
    SET
      failed_attempts = 0,
      locked_until = NULL,
      last_login = NOW(),
      updated_at = NOW()
    WHERE id = $1
    `,
    [akunId]
  );
};

const getAkunStatus = async (waliAkunId) => {
  const tokenVersionField = WALI_TOKEN_VERSION_ENABLED
    ? ", token_version"
    : "";
  const result = await pool.query(
    `
    SELECT
      id,
      nomor_hp,
      nama,
      status,
      must_change_pin,
      tenant_id
      ${tokenVersionField}
    FROM wali_akun
    WHERE id = $1
    LIMIT 1
    `,
    [waliAkunId]
  );
  return result.rows[0] || null;
};

const getSantriIdsForPhone = async (nomorHp, tenantId) => {
  const result = await pool.query(
    `
    SELECT DISTINCT ws.santri_id
    FROM wali_santri ws
    INNER JOIN santri s
      ON s.id = ws.santri_id
     AND s.tenant_id = $2
    WHERE ws.nomor_hp = $1
      AND ws.tenant_id = $2
    ORDER BY ws.santri_id ASC
    `,
    [nomorHp, tenantId]
  );
  return result.rows.map((row) => row.santri_id);
};

const getAnakList = async (nomorHp, tenantId) => {
  const result = await pool.query(
    `
    SELECT DISTINCT ON (s.id, su.unit_id)
      s.id AS santri_id,
      s.nis,
      s.nama,
      s.foto,
      k.nama_kelas,
      su.id AS santri_unit_id,
      su.unit_id,
      u.kode AS unit_kode,
      u.nama AS unit_nama,
      u.unit_type
    FROM wali_santri ws
    INNER JOIN santri s
      ON s.id = ws.santri_id
     AND s.tenant_id = $2
    INNER JOIN santri_units su
      ON su.santri_id = s.id
     AND su.tenant_id = s.tenant_id
     AND su.status = 'active'
     AND su.left_at IS NULL
    INNER JOIN unit_pendidikan u
      ON u.id = su.unit_id
     AND u.tenant_id = su.tenant_id
     AND u.is_active = true
    LEFT JOIN santri_kelas_enrollments e
      ON e.santri_unit_id = su.id
     AND e.tenant_id = su.tenant_id
     AND e.status = 'active'
    LEFT JOIN kelas k
      ON k.id = e.kelas_id
     AND k.tenant_id = e.tenant_id
    WHERE ws.nomor_hp = $1
      AND ws.tenant_id = $2
    ORDER BY s.id ASC, su.unit_id ASC, e.id DESC NULLS LAST, ws.id DESC
    `,
    [nomorHp, tenantId]
  );
  return result.rows;
};

const getSantriUnit = async (santriId, tenantId, unitId = null) => {
  const result = await pool.query(
    `
    SELECT
      su.id AS santri_unit_id,
      su.santri_id,
      su.unit_id,
      u.kode AS unit_kode,
      u.nama AS unit_nama,
      u.unit_type,
      u.preset_key
    FROM santri_units su
    JOIN unit_pendidikan u
      ON u.id = su.unit_id
     AND u.tenant_id = su.tenant_id
     AND u.is_active = true
    WHERE su.santri_id = $1
      AND su.tenant_id = $2
      AND su.status = 'active'
      AND su.left_at IS NULL
      AND ($3::integer IS NULL OR su.unit_id = $3)
    ORDER BY su.is_primary DESC, su.id ASC
    LIMIT 1
    `,
    [santriId, tenantId, unitId]
  );
  return result.rows[0] || null;
};

const ownsSantri = async (nomorHp, santriId, tenantId) => {
  const result = await pool.query(
    `
    SELECT 1
    FROM wali_santri ws
    INNER JOIN santri s
      ON s.id = ws.santri_id
     AND s.tenant_id = $3
    WHERE ws.nomor_hp = $1
      AND ws.santri_id = $2
      AND ws.tenant_id = $3
    LIMIT 1
    `,
    [nomorHp, santriId, tenantId]
  );
  return result.rows.length > 0;
};

const signWaliToken = (akun, santriIds, tenant) => {
  const santriProfiles = (santriIds || []).filter(
    (item) => item && typeof item === "object"
  );
  const normalizedSantriIds = (santriIds || []).map((item) =>
    typeof item === "object" ? item.santri_id : item
  );
  const payload = {
    typ: "wali",
    sub: akun.nomor_hp,
    wali_akun_id: akun.id,
    nomor_hp: akun.nomor_hp,
    tenant_id: tenant.id,
    tenant_slug: tenant.slug,
    santri_ids: normalizedSantriIds,
    // Metadata unit membantu aplikasi wali memilih fitur tanpa mengubah schema.
    // Otorisasi data tetap divalidasi ulang oleh waliSantriGuard.
    santri_units: (santriProfiles.length ? santriProfiles : santriIds || []).map((item) =>
      typeof item === "object"
        ? { santri_id: item.santri_id, unit_id: item.unit_id, unit_kode: item.unit_kode }
        : { santri_id: item, unit_id: null, unit_kode: null }
    ),
  };

  if (WALI_TOKEN_VERSION_ENABLED) {
    payload.token_version = Number(akun.token_version) || 0;
  }

  return jwt.sign(payload, WALI_JWT_SECRET, {
    algorithm: WALI_JWT_ALGORITHM,
    issuer: WALI_JWT_ISSUER,
    audience: WALI_JWT_AUDIENCE,
    expiresIn: WALI_JWT_EXPIRES,
  });
};

const verifyWaliToken = (token) => {
  const baseOptions = {
    algorithms: [WALI_JWT_ALGORITHM],
    issuer: WALI_JWT_ISSUER,
  };

  let decoded;
  try {
    decoded = jwt.verify(token, WALI_JWT_SECRET, {
      ...baseOptions,
      audience: WALI_JWT_AUDIENCE,
    });
  } catch (strictError) {
    if (!ALLOW_LEGACY_WALI_TOKEN_WITHOUT_AUDIENCE) {
      throw strictError;
    }

    const legacyDecoded = jwt.verify(token, WALI_JWT_SECRET, baseOptions);
    if (legacyDecoded.aud !== undefined) {
      throw strictError;
    }
    decoded = legacyDecoded;
  }

  if (decoded.typ !== "wali") {
    throw new Error("Invalid token type");
  }
  return decoded;
};

const isTokenVersionEnabled = () => WALI_TOKEN_VERSION_ENABLED;

const writeAudit = async ({ nomorHp, event, ipAddress, userAgent }) => {
  try {
    await pool.query(
      `
      INSERT INTO wali_app_audit (nomor_hp, event, ip_address, user_agent)
      VALUES ($1, $2, $3, $4)
      `,
      [nomorHp || null, event, ipAddress || null, userAgent || null]
    );
  } catch (err) {
    console.log("WALI AUDIT ERROR:", err.message);
  }
};

const buildWaliProfile = (akun) => ({
  nomor_hp: akun.nomor_hp,
  nama: akun.nama || null,
  must_change_pin: akun.must_change_pin === true,
});

const buildLoginResponse = async (akun, tenant) => {
  const anak = await getAnakList(akun.nomor_hp, tenant.id);
  const santriIds = anak.map((item) => item.santri_id);
  const token = signWaliToken(akun, anak, tenant);

  return {
    token,
    expires_in: WALI_JWT_EXPIRES,
    tenant: {
      id: tenant.id,
      slug: tenant.slug,
      nama: tenant.nama,
    },
    wali: buildWaliProfile(akun),
    anak,
    must_change_pin: akun.must_change_pin === true,
  };
};

/** Tenant-wide pesantren stats for wali dashboard hero strip. */
async function getStatistikPesantren(tenantId) {
  const { rows } = await pool.query(
    `
    SELECT
      (
        SELECT COUNT(*)::int
        FROM santri
        WHERE tenant_id = $1
          AND LOWER(TRIM(COALESCE(status, 'aktif'))) = 'aktif'
      ) AS total_santri_aktif,
      (
        SELECT COUNT(*)::int
        FROM guru
        WHERE tenant_id = $1
      ) AS total_guru,
      (
        SELECT COUNT(*)::int
        FROM kelas
        WHERE tenant_id = $1
      ) AS total_kelas
    `,
    [tenantId]
  );

  const row = rows[0] || {};

  return {
    total_santri_aktif: Number(row.total_santri_aktif) || 0,
    total_guru: Number(row.total_guru) || 0,
    total_kelas: Number(row.total_kelas) || 0,
  };
}

module.exports = {
  normalizePhone,
  isValidPin,
  isValidPinFormat,
  hashPin,
  verifyPin,
  findAkunByPhone,
  isAccountLocked,
  registerFailedLogin,
  registerSuccessfulLogin,
  getAkunStatus,
  getSantriIdsForPhone,
    getAnakList,
  getSantriUnit,
  ownsSantri,
  signWaliToken,
  verifyWaliToken,
  writeAudit,
  buildWaliProfile,
  buildLoginResponse,
  getStatistikPesantren,
  WALI_JWT_SECRET,
  isTokenVersionEnabled,
  WALI_JWT_ISSUER,
  WALI_JWT_AUDIENCE,
  WALI_JWT_ALGORITHM,
};
