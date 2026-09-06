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
const {
  canTenantEditRole,
  canTenantDeleteRole,
  validateRoleMutationBody,
} = require("../services/rolePolicy");

async function getRoleById(id, queryable = pool) {
  const { rows } = await queryable.query(
    `SELECT id, name, label, is_system FROM roles WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT r.id,
              r.name,
              CASE WHEN r.is_system THEN COALESCE(tro.label_override, r.label) ELSE r.label END AS label,
              r.is_system,
              COALESCE(tro.has_permission_override, false) AS has_permission_override,
              CASE
                WHEN r.is_system AND COALESCE(tro.has_permission_override, false)
                  THEN COUNT(DISTINCT trp.permission_id)
                ELSE COUNT(DISTINCT rp.permission_id)
              END AS total_permission
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN tenant_role_overrides tro
         ON tro.role_id = r.id
        AND tro.tenant_id = $3
        AND r.is_system = true
       LEFT JOIN tenant_role_permissions trp
         ON trp.tenant_id = tro.tenant_id
        AND trp.role_id = tro.role_id
       WHERE r.name = ANY($1::text[])
          OR (r.is_system = false AND r.name LIKE $2)
       GROUP BY r.id, tro.label_override, tro.has_permission_override
       ORDER BY r.id ASC`,
      [assignableRoles, `${getTenantCustomRolePrefix(req.tenantId)}%`, req.tenantId],
    );
    const data = result.rows.map((role) => ({
      ...role,
      can_manage: canTenantEditRole(role, req.tenantId),
      identity_locked: Boolean(role.is_system),
    }));

    res.json({ success: true, rbac_read_only: false, data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/permissions", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, key, label, grup
       FROM permissions
       WHERE grup <> 'platform'
       ORDER BY grup, key`,
    );
    res.json({ success: true, rbac_read_only: false, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const role = await getRoleById(req.params.id);
    const canView = role && !isPlatformRole(role.name) &&
      (isTenantAssignableRole(role.name) || isTenantCustomRole(role.name, req.tenantId));
    if (!canView) {
      return res.status(404).json({ success: false, error: "Role tidak ditemukan" });
    }

    const override = role.is_system
      ? await pool.query(
          `SELECT label_override, has_permission_override
           FROM tenant_role_overrides
           WHERE tenant_id = $1 AND role_id = $2`,
          [req.tenantId, role.id],
        )
      : { rows: [] };
    const overrideRow = override.rows[0] || null;
    const useOverride = role.is_system && overrideRow?.has_permission_override === true;
    const perms = useOverride
      ? await pool.query(
          `SELECT p.key
           FROM tenant_role_permissions trp
           JOIN permissions p ON p.id = trp.permission_id
           WHERE trp.tenant_id = $1 AND trp.role_id = $2 AND p.grup <> 'platform'`,
          [req.tenantId, role.id],
        )
      : await pool.query(
          `SELECT p.key
           FROM role_permissions rp
           JOIN permissions p ON p.id = rp.permission_id
           WHERE rp.role_id = $1 AND p.grup <> 'platform'`,
          [role.id],
        );

    res.json({
      success: true,
      data: {
        ...role,
        label: role.is_system ? (overrideRow?.label_override || role.label) : role.label,
        can_manage: canTenantEditRole(role, req.tenantId),
        identity_locked: Boolean(role.is_system),
        permission_source: useOverride ? "tenant_override" : "global_fallback",
        permissions: perms.rows.map((row) => row.key),
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
      [roleName, roleLabel],
    );
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_id)
       SELECT $1, id FROM permissions WHERE key = 'dashboard.view'
       ON CONFLICT DO NOTHING`,
      [result.rows[0].id],
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
  const validationError = validateRoleMutationBody(req.body);
  if (validationError) {
    return res.status(validationError.status).json({ success: false, ...validationError });
  }

  const client = await pool.connect();
  try {
    const permissionKeys = [...new Set(req.body.permissions.map((key) => String(key).trim()))];
    if (permissionKeys.some((key) => !key)) {
      return res.status(400).json({ success: false, code: "INVALID_PERMISSIONS", error: "Permission key tidak valid" });
    }

    await client.query("BEGIN");
    const role = await client.query(
      `SELECT id, name, label, is_system FROM roles WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    ).then((result) => result.rows[0] || null);
    if (!canTenantEditRole(role, req.tenantId)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, error: "Role tidak dapat diubah oleh tenant ini" });
    }

    const perms = permissionKeys.length
      ? await client.query(
          `SELECT id, key FROM permissions
           WHERE key = ANY($1::text[]) AND grup <> 'platform'`,
          [permissionKeys],
        )
      : { rows: [] };
    if (perms.rows.length !== permissionKeys.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        success: false,
        code: "INVALID_PERMISSIONS",
        error: "Terdapat permission tidak dikenal atau permission platform",
      });
    }

    const label = req.body.label === undefined ? undefined : String(req.body.label).trim();
    const requestedIds = perms.rows.map((row) => Number(row.id)).sort((a, b) => a - b);
    const currentPermissionRows = role.is_system
      ? await client.query(
          `SELECT tro.has_permission_override, tro.label_override, trp.permission_id
           FROM tenant_role_overrides tro
           LEFT JOIN tenant_role_permissions trp
             ON trp.tenant_id = tro.tenant_id AND trp.role_id = tro.role_id
           WHERE tro.tenant_id = $1 AND tro.role_id = $2`,
          [req.tenantId, role.id],
        )
      : await client.query(
          `SELECT permission_id FROM role_permissions WHERE role_id = $1`,
          [role.id],
        );
    const overrideExists = role.is_system && currentPermissionRows.rows[0]?.has_permission_override === true;
    const currentIds = currentPermissionRows.rows
      .map((row) => Number(row.permission_id))
      .filter(Number.isInteger)
      .sort((a, b) => a - b);
    const permissionSetDiffers = currentIds.length !== requestedIds.length ||
      currentIds.some((permissionId, index) => permissionId !== requestedIds[index]);
    const permissionsChanged = role.is_system
      ? !overrideExists || permissionSetDiffers
      : permissionSetDiffers;
    const currentLabel = role.is_system
      ? (currentPermissionRows.rows[0]?.label_override || role.label)
      : role.label;
    const labelChanged = label !== undefined && label !== currentLabel;

    if (!permissionsChanged && !labelChanged) {
      await client.query("COMMIT");
      return res.json({
        success: true,
        updated_count: requestedIds.length,
        permission_source: role.is_system ? "tenant_override" : "custom_role",
      });
    }

    if (role.is_system) {
      await client.query(
        `INSERT INTO tenant_role_overrides
           (tenant_id, role_id, label_override, has_permission_override, updated_by)
         VALUES ($1, $2, $3, true, $4)
         ON CONFLICT (tenant_id, role_id) DO UPDATE
         SET label_override = CASE
               WHEN $5::boolean THEN EXCLUDED.label_override
               ELSE tenant_role_overrides.label_override
             END,
             has_permission_override = true,
             updated_by = EXCLUDED.updated_by`,
        [req.tenantId, role.id, label ?? null, req.user.id, label !== undefined],
      );
      await client.query(
        `DELETE FROM tenant_role_permissions WHERE tenant_id = $1 AND role_id = $2`,
        [req.tenantId, role.id],
      );
      if (perms.rows.length) {
        await client.query(
          `INSERT INTO tenant_role_permissions (tenant_id, role_id, permission_id)
           SELECT $1, $2, UNNEST($3::int[])`,
          [req.tenantId, role.id, perms.rows.map((row) => row.id)],
        );
      }
    } else {
      if (label !== undefined) {
        await client.query(`UPDATE roles SET label = $1 WHERE id = $2`, [label, role.id]);
      }
      await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [role.id]);
      if (perms.rows.length) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id)
           SELECT $1, UNNEST($2::int[])`,
          [role.id, perms.rows.map((row) => row.id)],
        );
      }
    }

    await client.query("COMMIT");
    requirePermission.invalidateCache();
    res.json({
      success: true,
      updated_count: perms.rows.length,
      permission_source: role.is_system ? "tenant_override" : "custom_role",
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) { /* best effort */ }
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const role = await getRoleById(req.params.id);
    if (!canTenantDeleteRole(role, req.tenantId)) {
      return res.status(403).json({ success: false, error: "Role sistem tidak boleh dihapus" });
    }

    const used = await pool.query(
      `SELECT COUNT(*)::int AS total FROM users WHERE tenant_id = $1 AND role = $2`,
      [req.tenantId, role.name],
    );
    if (Number(used.rows[0]?.total || 0) > 0) {
      return res.status(400).json({
        success: false,
        error: "Role masih dipakai user. Pindahkan user ke role lain dulu.",
      });
    }

    await pool.query("DELETE FROM roles WHERE id = $1", [role.id]);
    requirePermission.invalidateCache();
    res.json({ success: true, message: "Role berhasil dihapus" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
