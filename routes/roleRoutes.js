const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const tenantMiddleware = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/requirePermission");
const {
  getTenantCustomRolePrefix,
  isPlatformRole,
  isTenantCustomRole,
  isTenantAssignableRole,
  normalizeTenantCustomRoleName,
  tenantAssignableRolesSqlList,
} = require("../utils/platformRbac");

router.use(authMiddleware, tenantMiddleware, requirePermission("role.manage"));

const assignableRoles = tenantAssignableRolesSqlList();

async function getRoleById(id) {
  const { rows } = await pool.query(
    `SELECT id, name, label, is_system FROM roles WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

function canTenantManageRole(role, tenantId) {
  return Boolean(
    role &&
      !role.is_system &&
      !isPlatformRole(role.name) &&
      isTenantCustomRole(role.name, tenantId)
  );
}

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id, r.name, r.label, r.is_system,
              COUNT(rp.permission_id) AS total_permission
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       WHERE r.name = ANY($1::text[])
          OR (r.is_system = false AND r.name LIKE $2)
       GROUP BY r.id
       ORDER BY r.id ASC`,
      [assignableRoles, `${getTenantCustomRolePrefix(req.tenantId)}%`],
    );
    const data = result.rows.map((role) => ({
      ...role,
      can_manage: canTenantManageRole(role, req.tenantId),
    }));

    res.json({
      success: true,
      rbac_read_only: false,
      data,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/permissions", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, key, label, grup
       FROM permissions
       WHERE grup <> 'platform'
       ORDER BY grup, key`,
    );
    res.json({
      success: true,
      rbac_read_only: false,
      data: result.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const role = await getRoleById(id);

    const canView =
      role &&
      !isPlatformRole(role.name) &&
      (isTenantAssignableRole(role.name) || isTenantCustomRole(role.name, req.tenantId));

    if (!canView) {
      return res.status(404).json({ success: false, error: "Role tidak ditemukan" });
    }

    const perms = await pool.query(
      `SELECT p.key
       FROM role_permissions rp
       JOIN permissions p ON p.id = rp.permission_id
       WHERE rp.role_id = $1
         AND p.grup <> 'platform'`,
      [id],
    );

    res.json({
      success: true,
      data: {
        ...role,
        can_manage: canTenantManageRole(role, req.tenantId),
        permissions: perms.rows.map((r) => r.key),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/", async (req, res) => {
  const client = await pool.connect();
  try {
    const { name, label } = req.body;
    const roleName = normalizeTenantCustomRoleName(req.tenantId, name);
    const roleLabel = String(label || name || "").trim();

    if (!roleName || !roleLabel) {
      return res.status(400).json({ success: false, error: "Nama dan label role wajib diisi" });
    }

    if (assignableRoles.includes(roleName) || isPlatformRole(roleName)) {
      return res.status(403).json({ success: false, error: "Nama role sistem tidak boleh dipakai" });
    }

    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO roles (name, label, is_system)
       VALUES ($1, $2, false)
       RETURNING id, name, label, is_system`,
      [roleName, roleLabel]
    );

    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id
       FROM permissions
       WHERE key = 'dashboard.view'
       ON CONFLICT DO NOTHING`,
      [result.rows[0].id]
    );

    await client.query("COMMIT");
    requirePermission.invalidateCache();
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      return res.status(400).json({ success: false, error: "Role sudah ada" });
    }
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

router.put("/:id/permissions", async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const role = await getRoleById(id);

    if (!canTenantManageRole(role, req.tenantId)) {
      return res.status(403).json({
        success: false,
        error: "Permission role sistem tidak boleh diubah dari tenant. Buat role custom untuk matrix khusus.",
      });
    }

    const permissionKeys = Array.isArray(req.body?.permissions) ? req.body.permissions : [];

    await client.query("BEGIN");
    const perms = await client.query(
      `SELECT id
       FROM permissions
       WHERE key = ANY($1::text[])
         AND grup <> 'platform'`,
      [permissionKeys]
    );

    const current = await client.query(
      `SELECT permission_id
       FROM role_permissions
       WHERE role_id = $1
       ORDER BY permission_id`,
      [id],
    );
    const currentIds = current.rows.map((item) => Number(item.permission_id));
    const requestedIds = perms.rows.map((item) => Number(item.id)).sort((a, b) => a - b);
    const permissionsChanged =
      currentIds.length !== requestedIds.length ||
      currentIds.some((permissionId, index) => permissionId !== requestedIds[index]);

    if (!permissionsChanged) {
      await client.query("COMMIT");
      return res.json({ success: true, updated_count: perms.rows.length });
    }

    await client.query("DELETE FROM role_permissions WHERE role_id = $1", [id]);

    for (const perm of perms.rows) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [id, perm.id]
      );
    }

    await client.query("COMMIT");
    requirePermission.invalidateCache();
    res.json({ success: true, updated_count: perms.rows.length });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const role = await getRoleById(id);

    if (!canTenantManageRole(role, req.tenantId)) {
      return res.status(403).json({ success: false, error: "Role sistem tidak boleh dihapus" });
    }

    const used = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM users
       WHERE tenant_id = $1
         AND role = $2`,
      [req.tenantId, role.name]
    );

    if (Number(used.rows[0]?.total || 0) > 0) {
      return res.status(400).json({
        success: false,
        error: "Role masih dipakai user. Pindahkan user ke role lain dulu.",
      });
    }

    await pool.query("DELETE FROM roles WHERE id = $1", [id]);
    requirePermission.invalidateCache();
    res.json({ success: true, message: "Role berhasil dihapus" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
