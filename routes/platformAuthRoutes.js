require("dotenv").config();

const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");
const platformAuthMiddleware = require("../middleware/platformAuthMiddleware");
const { JWT_SECRET } = require("../config/authSecrets");

const router = express.Router();

function buildPlatformJwtPayload(user) {
  return {
    id: user.id,
    username: user.username,
    nama: user.nama,
    role: "platform_superadmin",
    tenant_id: null,
    platform: true,
    token_version: Number(user.token_version) || 0,
  };
}

function buildPlatformUserResponse(user, permissions) {
  return {
    id: user.id,
    nama: user.nama,
    username: user.username,
    role: user.role,
    tenant_id: null,
    platform: true,
    permissions,
  };
}

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "Username dan password wajib diisi",
      });
    }

    const result = await pool.query(
      `SELECT *
       FROM users
       WHERE username = $1
         AND tenant_id IS NULL
         AND role = 'platform_superadmin'`,
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: "User platform tidak ditemukan",
      });
    }

    const user = result.rows[0];
    const stored = user.password || "";

    const isBcrypt =
      stored.startsWith("$2a$") ||
      stored.startsWith("$2b$") ||
      stored.startsWith("$2y$");

    const passwordValid = isBcrypt
      ? await bcrypt.compare(password, stored)
      : stored === password;

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        error: "Password salah",
      });
    }

    const token = jwt.sign(buildPlatformJwtPayload(user), JWT_SECRET, {
      expiresIn: "7d",
    });

    const permissions = await requirePermission.getPermissionList(user.role);

    res.json({
      success: true,
      token,
      user: buildPlatformUserResponse(user, permissions),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

router.get("/me", platformAuthMiddleware, async (req, res) => {
  try {
    const permissions = await requirePermission.getPermissionList(
      req.platformUser.role
    );

    res.json({
      success: true,
      user: buildPlatformUserResponse(req.platformUser, permissions),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

router.patch("/password", platformAuthMiddleware, async (req, res) => {
  try {
    const { current_password, new_password } = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({
        success: false,
        error: "Password lama dan password baru wajib diisi",
      });
    }

    if (String(new_password).length < 8) {
      return res.status(400).json({
        success: false,
        error: "Password baru minimal 8 karakter",
      });
    }

    if (String(current_password) === String(new_password)) {
      return res.status(400).json({
        success: false,
        error: "Password baru harus berbeda dari password lama",
      });
    }

    const result = await pool.query(
      `SELECT id, password
       FROM users
       WHERE id = $1
         AND tenant_id IS NULL
         AND role = 'platform_superadmin'`,
      [req.platformUser.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User platform tidak ditemukan",
      });
    }

    const stored = result.rows[0].password || "";
    const isBcrypt =
      stored.startsWith("$2a$") ||
      stored.startsWith("$2b$") ||
      stored.startsWith("$2y$");

    const passwordValid = isBcrypt
      ? await bcrypt.compare(current_password, stored)
      : stored === current_password;

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        error: "Password lama salah",
      });
    }

    const hash = await bcrypt.hash(new_password, 10);

    await pool.query(
      `UPDATE users
       SET password = $1
       WHERE id = $2
         AND tenant_id IS NULL
         AND role = 'platform_superadmin'`,
      [hash, req.platformUser.id]
    );

    res.json({
      success: true,
      message: "Password platform berhasil diganti",
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;
