require("dotenv").config();

const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/authSecrets");
const {
  SESSION_EXPIRED_CODE,
  sendSessionExpired,
  validateDecodedAdminSession,
} = require("../services/adminSessionService");

function createAuthMiddleware({
  verifyToken = (token) => jwt.verify(token, JWT_SECRET),
  validateSession = validateDecodedAdminSession,
} = {}) {
  return async (req, res, next) => {
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
      decoded = verifyToken(token);
    } catch {
      return res.status(401).json({
        success: false,
        error: "Token tidak valid",
      });
    }

    try {
      const currentUser = await validateSession(decoded);

      req.user = {
        ...decoded,
        ...currentUser,
      };
      req.tenantId = currentUser.tenant_id ?? null;

      next();
    } catch (err) {
      if (err?.code === SESSION_EXPIRED_CODE) {
        return sendSessionExpired(res);
      }
      console.error("[authMiddleware] session validation failed", {
        name: err?.name,
        code: err?.code,
        message: err?.message,
        stack: err?.stack,
      });
      return res.status(500).json({
        success: false,
        error: "Gagal memverifikasi sesi",
      });
    }
  };
}

const authMiddleware = createAuthMiddleware();
authMiddleware.createAuthMiddleware = createAuthMiddleware;

module.exports = authMiddleware;
