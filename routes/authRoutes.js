require("dotenv").config();

const express = require("express");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");
const bcrypt = require("bcryptjs");
const authMiddleware = require("../middleware/authMiddleware");
const { resolveTenantForLogin, getTenantById, buildInactiveTenantPayload } = require("../services/tenantService");
const { getEnabledFeatureKeys } = require("../services/tenantFeatureService");
const { JWT_SECRET } = require("../config/authSecrets");

const router = express.Router();

function buildJwtPayload(user, tenant) {
  return {
    id: user.id,
    username: user.username,
    nama: user.nama,
    role: user.role,
    tenant_id: tenant.id,
    tenant_slug: tenant.slug,
    token_version: Number(user.token_version) || 0,
  };
}

async function buildUserResponse(user, tenant, permissions) {
  const tenant_features = await getEnabledFeatureKeys(tenant.id);
  return {
    id: user.id,
    nama: user.nama,
    username: user.username,
    role: user.role,
    permissions,
    tenant_id: tenant.id,
    tenant_slug: tenant.slug,
    tenant_nama: tenant.nama,
    tenant_name: tenant.nama,
    tenant_features,
  };
}

// =====================
// LOGIN
// =====================

router.post("/login", async (req, res) => {
  try {
    const { username, password, tenant_slug } = req.body;

    const tenantResult = await resolveTenantForLogin(tenant_slug);
    if (tenantResult.error) {
      return res.status(tenantResult.status).json({
        success: false,
        error: tenantResult.error,
        message: tenantResult.error,
      });
    }
    const { tenant } = tenantResult;

    const result = await pool.query(
      `
      SELECT *
      FROM users
      WHERE username = $1
        AND tenant_id = $2
      `,
      [username, tenant.id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: "User tidak ditemukan",
      });
    }

    const user = result.rows[0];

    if (user.role === "platform_superadmin" || user.tenant_id == null) {
      return res.status(403).json({
        success: false,
        error: "Akun platform tidak bisa login melalui portal tenant",
      });
    }

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

    const token = jwt.sign(buildJwtPayload(user, tenant), JWT_SECRET, {
      expiresIn: "7d",
    });

    const permissions = await requirePermission.getPermissionList(user.role, {
      tenantScoped: true,
      tenantId: user.tenant_id,
    });

    res.json({
      success: true,
      token,
      user: await buildUserResponse(user, tenant, permissions),
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// =====================
// VERIFY TOKEN
// =====================

router.get("/me", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT
        u.id,
        u.nama,
        u.username,
        u.role,
        u.tenant_id,
        t.slug AS tenant_slug,
        t.nama AS tenant_nama
      FROM users u
      LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = $1
      `,
      [req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "User tidak ditemukan",
      });
    }

    const me = result.rows[0];

    if (me.tenant_id) {
      const tenant = await getTenantById(me.tenant_id);
      if (!tenant) {
        return res.status(403).json({
          success: false,
          error: "Tenant tidak ditemukan",
        });
      }
      if (tenant.status !== "active") {
        return res.status(403).json(buildInactiveTenantPayload());
      }
    }

    const permissions = await requirePermission.getPermissionList(me.role, {
      tenantScoped: Boolean(me.tenant_id),
      tenantId: me.tenant_id,
    });

    const tenant_features = me.tenant_id
      ? await getEnabledFeatureKeys(me.tenant_id)
      : [];

    res.json({
      success: true,
      user: {
        id: me.id,
        nama: me.nama,
        username: me.username,
        role: me.role,
        permissions,
        tenant_id: me.tenant_id,
        tenant_slug: me.tenant_slug,
        tenant_nama: me.tenant_nama,
        tenant_name: me.tenant_nama,
        tenant_features,
      },
    });
  } catch (err) {
    console.log(err);
    res.status(401).json({
      success: false,
      error: "Token invalid",
    });
  }
});

// =====================
// REGISTER USER (legacy — assigns default tenant)
// =====================

router.post("/register", async (req, res) => {
  return res.status(403).json({
    success: false,
    error: "Registrasi publik dinonaktifkan. Hubungi admin platform.",
    message: "Registrasi publik dinonaktifkan. Hubungi admin platform.",
  });
});

module.exports = router;
