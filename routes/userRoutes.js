const express = require("express");
const router = express.Router();
const pool = require("../db");
const bcrypt = require("bcryptjs");
const authMiddleware = require("../middleware/authMiddleware");
const tenantMiddleware = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/requirePermission");
const { getAllowedUnitIds } = require("../services/unitAccessService");

const withTenant = [authMiddleware, tenantMiddleware];
const {
  getTenantCustomRolePrefix,
  validateTenantRoleForAssignment,
  tenantAssignableRolesSqlList,
} = require("../utils/platformRbac");

async function validateAssignableRoleForTenant(role, tenantId) {
  const roleCheck = validateTenantRoleForAssignment(role, tenantId);
  if (!roleCheck.ok) return roleCheck;

  const exists = await pool.query(
    `SELECT id
     FROM roles
     WHERE name = $1
       AND (
         name = ANY($2::text[])
         OR (is_system = false AND name LIKE $3)
       )`,
    [role, tenantAssignableRolesSqlList(), `${getTenantCustomRolePrefix(tenantId)}%`]
  );

  if (exists.rows.length === 0) {
    return { ok: false, status: 400, error: "Role tidak ditemukan" };
  }

  return { ok: true };
}

// ======================
// GET /users/meta/roles — daftar role untuk dropdown form
// ======================

router.get(
  "/meta/roles",
  ...withTenant,
  requirePermission("user.view"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT name, label
         FROM roles
         WHERE name = ANY($1::text[])
            OR (is_system = false AND name LIKE $2)
         ORDER BY id ASC`,
        [tenantAssignableRolesSqlList(), `${getTenantCustomRolePrefix(req.tenantId)}%`],
      );
      res.json({ success: true, data: result.rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ======================
// GET /users/meta/units — master unit untuk assignment scope
// ======================

router.get(
  "/meta/units",
  ...withTenant,
  requirePermission.requireAnyPermission([
    "user.view",
    "santri.view",
    "kelas.view",
    "guru.view",
    "pembayaran.view",
    "nilai.view",
    "pengumuman.view",
  ]),
  async (req, res) => {
    try {
      const allowed = await getAllowedUnitIds(req.user, req.tenantId);
      const params = [req.tenantId];
      let scopeSql = "";
      if (allowed !== null) {
        params.push(allowed);
        scopeSql = " AND id = ANY($2::int[])";
      }
      const result = await pool.query(
        `SELECT id, kode, nama, is_active, sort_order
         FROM unit_pendidikan
         WHERE tenant_id = $1
           AND is_active = true
           ${scopeSql}
         ORDER BY sort_order ASC, id ASC`,
        params
      );

      res.json({ success: true, data: result.rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ======================
// GET /users/meta/kelas — master kelas untuk assignment scope
// ======================

router.get(
  "/meta/kelas",
  ...withTenant,
  requirePermission("user.view"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, nama_kelas
         FROM kelas
         WHERE tenant_id = $1
         ORDER BY id ASC`,
        [req.tenantId]
      );

      res.json({ success: true, data: result.rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ======================
// GET /users
// ======================

router.get(
  "/",
  ...withTenant,
  requirePermission("user.view"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT u.id, u.nama, u.username, u.role, u.status, u.created_at,
                u.tenant_id,
                r.label AS role_label
         FROM users u
         LEFT JOIN roles r ON r.name = u.role
         WHERE u.tenant_id = $1
         ORDER BY u.id ASC`,
        [req.tenantId]
      );
      res.json({ success: true, data: result.rows });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ======================
// POST /users
// ======================

router.post(
  "/",
  ...withTenant,
  requirePermission("user.create"),
  async (req, res) => {
    try {
      const { nama, username, password, role, status } = req.body;

      if (!nama || !username || !password || !role) {
        return res.status(400).json({ success: false, error: "Semua field wajib diisi" });
      }

      const roleCheck = await validateAssignableRoleForTenant(role, req.tenantId);
      if (!roleCheck.ok) {
        return res.status(roleCheck.status).json({ success: false, error: roleCheck.error });
      }

      const exists = await pool.query(
        "SELECT id FROM users WHERE username = $1 AND tenant_id = $2",
        [username, req.tenantId]
      );
      if (exists.rows.length > 0) {
        return res.status(400).json({ success: false, error: "Username sudah digunakan" });
      }

      const hash = await bcrypt.hash(password, 10);

      const result = await pool.query(
        `INSERT INTO users (nama, username, password, role, status, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, nama, username, role, status, tenant_id, created_at`,
        [nama, username, hash, role, status || "Aktif", req.tenantId]
      );

      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ======================
// PUT /users/:id
// ======================

router.put(
  "/:id",
  ...withTenant,
  requirePermission("user.update"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { nama, username, password, role, status } = req.body;

      if (!nama || !username || !role) {
        return res.status(400).json({ success: false, error: "Nama, username, dan role wajib diisi" });
      }

      const roleCheck = await validateAssignableRoleForTenant(role, req.tenantId);
      if (!roleCheck.ok) {
        return res.status(roleCheck.status).json({ success: false, error: roleCheck.error });
      }

      let result;
      if (password && password.trim()) {
        const hash = await bcrypt.hash(password, 10);
        result = await pool.query(
          `UPDATE users
           SET nama = $1, username = $2, password = $3, role = $4, status = $5
           WHERE id = $6 AND tenant_id = $7
           RETURNING id, nama, username, role, status, tenant_id, created_at`,
          [nama, username, hash, role, status || "Aktif", id, req.tenantId]
        );
      } else {
        result = await pool.query(
          `UPDATE users
           SET nama = $1, username = $2, role = $3, status = $4
           WHERE id = $5 AND tenant_id = $6
           RETURNING id, nama, username, role, status, tenant_id, created_at`,
          [nama, username, role, status || "Aktif", id, req.tenantId]
        );
      }

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: "User tidak ditemukan" });
      }

      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ======================
// PUT /users/:id/reset-password
// ======================

router.put(
  "/:id/reset-password",
  ...withTenant,
  requirePermission("user.update"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const { password } = req.body;

      if (!password || password.length < 4) {
        return res.status(400).json({ success: false, error: "Password minimal 4 karakter" });
      }

      const hash = await bcrypt.hash(password, 10);

      const result = await pool.query(
        `UPDATE users SET password = $1 WHERE id = $2 AND tenant_id = $3 RETURNING id, username`,
        [hash, id, req.tenantId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: "User tidak ditemukan" });
      }

      res.json({ success: true, message: "Password berhasil direset" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ======================
// GET /users/:id/unit-scope
// ======================

router.get(
  "/:id/unit-scope",
  ...withTenant,
  requirePermission("user.view"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const user = await pool.query(
        "SELECT id FROM users WHERE id = $1 AND tenant_id = $2",
        [id, req.tenantId]
      );

      if (user.rows.length === 0) {
        return res.status(404).json({ success: false, error: "User tidak ditemukan" });
      }

      const result = await pool.query(
        `SELECT s.unit_id
         FROM user_unit_scope s
         INNER JOIN unit_pendidikan u ON u.id = s.unit_id AND u.tenant_id = $2
         WHERE s.user_id = $1
           AND s.tenant_id = $2
           AND s.status = 'active'
         ORDER BY u.sort_order ASC, u.id ASC`,
        [id, req.tenantId]
      );

      res.json({
        success: true,
        data: result.rows.map((row) => row.unit_id),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ======================
// PUT /users/:id/unit-scope
// ======================

router.put(
  "/:id/unit-scope",
  ...withTenant,
  requirePermission("user.update"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const unitIds = Array.isArray(req.body?.unit_ids)
        ? [...new Set(req.body.unit_ids.map((v) => Number(v)).filter(Number.isFinite))]
        : [];

      const user = await client.query(
        "SELECT id FROM users WHERE id = $1 AND tenant_id = $2",
        [id, req.tenantId]
      );

      if (user.rows.length === 0) {
        return res.status(404).json({ success: false, error: "User tidak ditemukan" });
      }

      if (unitIds.length > 0) {
        const validUnits = await client.query(
          `SELECT id
           FROM unit_pendidikan
           WHERE tenant_id = $1
             AND id = ANY($2::int[])
             AND is_active = true`,
          [req.tenantId, unitIds]
        );

        if (validUnits.rows.length !== unitIds.length) {
          return res.status(400).json({
            success: false,
            error: "Ada unit yang tidak valid untuk tenant ini",
          });
        }
      }

      await client.query("BEGIN");
      await client.query(
        "DELETE FROM user_unit_scope WHERE user_id = $1 AND tenant_id = $2",
        [id, req.tenantId],
      );

      for (const unitId of unitIds) {
        await client.query(
          `INSERT INTO user_unit_scope (tenant_id, user_id, unit_id, status, updated_at)
           VALUES ($1, $2, $3, 'active', NOW())
           ON CONFLICT DO NOTHING`,
          [req.tenantId, id, unitId]
        );
      }

      await client.query("COMMIT");
      res.json({ success: true, data: unitIds });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  }
);

// ======================
// GET /users/:id/kelas-scope
// ======================

router.get(
  "/:id/kelas-scope",
  ...withTenant,
  requirePermission("user.view"),
  async (req, res) => {
    try {
      const { id } = req.params;

      const user = await pool.query(
        "SELECT id FROM users WHERE id = $1 AND tenant_id = $2",
        [id, req.tenantId]
      );

      if (user.rows.length === 0) {
        return res.status(404).json({ success: false, error: "User tidak ditemukan" });
      }

      const result = await pool.query(
        `SELECT s.kelas_id
         FROM user_kelas_scope s
         INNER JOIN kelas k ON k.id = s.kelas_id AND k.tenant_id = $2
         WHERE s.user_id = $1
           AND s.tenant_id = $2
         ORDER BY k.id ASC`,
        [id, req.tenantId]
      );

      res.json({
        success: true,
        data: result.rows.map((row) => row.kelas_id),
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// ======================
// PUT /users/:id/kelas-scope
// ======================

router.put(
  "/:id/kelas-scope",
  ...withTenant,
  requirePermission("user.update"),
  async (req, res) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const kelasIds = Array.isArray(req.body?.kelas_ids)
        ? [...new Set(req.body.kelas_ids.map((v) => Number(v)).filter(Number.isFinite))]
        : [];

      const user = await client.query(
        "SELECT id FROM users WHERE id = $1 AND tenant_id = $2",
        [id, req.tenantId]
      );

      if (user.rows.length === 0) {
        return res.status(404).json({ success: false, error: "User tidak ditemukan" });
      }

      if (kelasIds.length > 0) {
        const validKelas = await client.query(
          `SELECT id
           FROM kelas
           WHERE tenant_id = $1
             AND id = ANY($2::int[])`,
          [req.tenantId, kelasIds]
        );

        if (validKelas.rows.length !== kelasIds.length) {
          return res.status(400).json({
            success: false,
            error: "Ada kelas yang tidak valid untuk tenant ini",
          });
        }
      }

      await client.query("BEGIN");
      await client.query(
        "DELETE FROM user_kelas_scope WHERE user_id = $1 AND tenant_id = $2",
        [id, req.tenantId]
      );

      for (const kelasId of kelasIds) {
        await client.query(
          `INSERT INTO user_kelas_scope (tenant_id, user_id, kelas_id)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [req.tenantId, id, kelasId]
        );
      }

      await client.query("COMMIT");
      res.json({ success: true, data: kelasIds });
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  }
);

// ======================
// DELETE /users/:id
// ======================

router.delete(
  "/:id",
  ...withTenant,
  requirePermission("user.delete"),
  async (req, res) => {
    try {
      const { id } = req.params;

      if (String(req.user.id) === String(id)) {
        return res.status(400).json({ success: false, error: "Tidak dapat menghapus akun sendiri" });
      }

      const check = await pool.query(
        "SELECT id, role FROM users WHERE id = $1 AND tenant_id = $2",
        [id, req.tenantId]
      );
      if (check.rows.length === 0) {
        return res.status(404).json({ success: false, error: "User tidak ditemukan" });
      }

      const targetUser = check.rows[0];
      if (targetUser.role === "platform_superadmin") {
        return res.status(403).json({ success: false, error: "User platform tidak boleh dihapus dari tenant" });
      }

      if (targetUser.role === "superadmin") {
        const adminCount = await pool.query(
          `SELECT COUNT(*)::int AS total
           FROM users
           WHERE tenant_id = $1
             AND role = 'superadmin'
             AND id <> $2`,
          [req.tenantId, id]
        );

        if (Number(adminCount.rows[0]?.total || 0) < 1) {
          return res.status(400).json({
            success: false,
            error: "Tidak dapat menghapus admin terakhir di tenant ini",
          });
        }
      }

      await pool.query("DELETE FROM users WHERE id = $1 AND tenant_id = $2", [id, req.tenantId]);
      res.json({ success: true, message: "User berhasil dihapus" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

module.exports = router;
