const pool = require("../db");

const SESSION_EXPIRED_CODE = "SESSION_EXPIRED";
const SESSION_EXPIRED_MESSAGE = "Sesi telah diperbarui. Silakan login ulang.";

function normalizeTokenVersion(value) {
  const version = Number(value ?? 0);
  return Number.isSafeInteger(version) && version >= 0 ? version : null;
}

function sessionExpiredError() {
  return Object.assign(new Error(SESSION_EXPIRED_MESSAGE), {
    status: 401,
    code: SESSION_EXPIRED_CODE,
  });
}

function sendSessionExpired(res) {
  return res.status(401).json({
    success: false,
    error: SESSION_EXPIRED_MESSAGE,
    code: SESSION_EXPIRED_CODE,
  });
}

async function validateDecodedAdminSession(decoded, client = pool) {
  if (!decoded?.id) throw sessionExpiredError();

  const { rows } = await client.query(
    `SELECT id, nama, username, role, status, tenant_id, token_version
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [decoded.id],
  );
  const user = rows[0];
  if (!user) throw sessionExpiredError();

  const tokenVersion = normalizeTokenVersion(decoded.token_version);
  const databaseVersion = normalizeTokenVersion(user.token_version);
  const tokenTenantId = decoded.tenant_id == null ? null : Number(decoded.tenant_id);
  const databaseTenantId = user.tenant_id == null ? null : Number(user.tenant_id);
  const status = String(user.status || "").trim().toLowerCase();

  if (
    tokenVersion == null ||
    databaseVersion == null ||
    tokenVersion !== databaseVersion ||
    String(decoded.role || "") !== String(user.role || "") ||
    tokenTenantId !== databaseTenantId ||
    !["aktif", "active"].includes(status)
  ) {
    throw sessionExpiredError();
  }

  return {
    id: user.id,
    nama: user.nama,
    username: user.username,
    role: user.role,
    status: user.status,
    tenant_id: databaseTenantId,
    token_version: databaseVersion,
  };
}

module.exports = {
  SESSION_EXPIRED_CODE,
  SESSION_EXPIRED_MESSAGE,
  normalizeTokenVersion,
  sendSessionExpired,
  sessionExpiredError,
  validateDecodedAdminSession,
};
