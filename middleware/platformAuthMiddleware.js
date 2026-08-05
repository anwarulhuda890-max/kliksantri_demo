require("dotenv").config();

const jwt = require("jsonwebtoken");
const pool = require("../db");
const { JWT_SECRET } = require("../config/authSecrets");
const {
  SESSION_EXPIRED_CODE,
  sendSessionExpired,
  validateDecodedAdminSession,
} = require("../services/adminSessionService");

/**
 * Authenticate platform superadmin JWT (tenant_id must be null).
 * Sets req.platformUser and req.user for permission checks.
 */
async function platformAuthMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        success: false,
        error: "Token tidak ada",
      });
    }

    const token = authHeader.split(" ")[1];
    let decoded;

    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return res.status(401).json({
        success: false,
        error: "Token tidak valid",
      });
    }

    if (decoded.platform !== true) {
      return res.status(403).json({
        success: false,
        error: "Token bukan platform admin",
      });
    }

    if (decoded.role !== "platform_superadmin") {
      return res.status(403).json({
        success: false,
        error: "Role platform tidak valid",
      });
    }

    if (decoded.tenant_id != null) {
      return res.status(403).json({
        success: false,
        error: "Token platform tidak valid",
      });
    }

    const user = await validateDecodedAdminSession(decoded, pool);

    req.platformUser = {
      id: user.id,
      nama: user.nama,
      username: user.username,
      role: user.role,
      tenant_id: null,
      platform: true,
      token_version: user.token_version,
    };

    req.user = req.platformUser;

    next();
  } catch (err) {
    if (err?.code === SESSION_EXPIRED_CODE) {
      return sendSessionExpired(res);
    }
    console.error("[platformAuthMiddleware]", err);
    return res.status(500).json({
      success: false,
      error: "Gagal memverifikasi token platform",
    });
  }
}

module.exports = platformAuthMiddleware;
