const express = require("express");
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const tenantMiddleware = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/requirePermission");
const { assertUnitAccess, resolveActiveUnit } = require("../services/unitAccessService");

const router = express.Router();
const withTenant = [authMiddleware, tenantMiddleware];

function sendError(res, error) {
  const status = Number(error.status) || 500;
  return res.status(status).json({
    success: false,
    error: status >= 500 ? "Gagal memproses kelas" : error.message,
    code: error.code,
  });
}

router.get("/", ...withTenant, requirePermission("kelas.view"), async (req, res) => {
  try {
    const workspace = await resolveActiveUnit(req);
    const result = await pool.query(
      `SELECT kelas.*, u.kode AS unit_kode, u.nama AS unit_nama
       FROM kelas
       INNER JOIN unit_pendidikan u ON u.id = kelas.unit_id AND u.tenant_id = kelas.tenant_id
       WHERE kelas.tenant_id = $1
         AND ($2::integer IS NULL OR kelas.unit_id = $2)
       ORDER BY id ASC`,
      [req.tenantId, workspace.unitId]
    );

    res.json({
      success: true,
      data: result.rows,
      access: { all_units: workspace.mode === "ALL", unit_id: workspace.unitId },
    });
  } catch (err) {
    console.log(err);
    sendError(res, err);
  }
});

router.get("/:id", ...withTenant, requirePermission("kelas.view"), async (req, res) => {
  try {
    const workspace = await resolveActiveUnit(req);
    const { rows } = await pool.query(
      `SELECT k.*, u.kode AS unit_kode, u.nama AS unit_nama
       FROM kelas k
       JOIN unit_pendidikan u ON u.id = k.unit_id AND u.tenant_id = k.tenant_id
       WHERE k.id = $1 AND k.tenant_id = $2
         AND ($3::integer IS NULL OR k.unit_id = $3)`,
      [req.params.id, req.tenantId, workspace.unitId],
    );
    if (!rows[0]) return res.status(404).json({ success: false, error: "Kelas tidak ditemukan" });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    sendError(res, error);
  }
});

router.post(
  "/",
  ...withTenant,
  requirePermission("kelas.manage"),
  async (req, res) => {
    try {
      const { nama_kelas, unit_id } = req.body;
      const workspace = await resolveActiveUnit(req);
      if (workspace.mode !== "UNIT") {
        const error = new Error("Pilih satu unit aktif untuk membuat kelas");
        error.status = 400;
        error.code = "UNIT_REQUIRED";
        throw error;
      }
      const unitValue = Number(unit_id || workspace.unitId);
      if (unitValue !== Number(workspace.unitId)) {
        await assertUnitAccess(req.user, unitValue, req.tenantId);
        const error = new Error("Unit body berbeda dari workspace aktif");
        error.status = 403;
        error.code = "UNIT_CONTEXT_MISMATCH";
        throw error;
      }

      const result = await pool.query(
        `INSERT INTO kelas (nama_kelas, tenant_id, unit_id)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [nama_kelas, req.tenantId, unitValue]
      );

      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      console.log(err);
      sendError(res, err);
    }
  }
);

router.put(
  "/:id",
  ...withTenant,
  requirePermission("kelas.manage"),
  async (req, res) => {
    try {
      const workspace = await resolveActiveUnit(req);
      if (workspace.mode !== "UNIT") {
        throw Object.assign(new Error("Pilih satu unit aktif untuk mengubah kelas"), {
          status: 400,
          code: "UNIT_REQUIRED",
        });
      }
      const requestedUnitId = Number(req.body.unit_id || workspace.unitId);
      if (requestedUnitId !== Number(workspace.unitId)) {
        throw Object.assign(new Error("Unit kelas tidak boleh dipindahkan melalui endpoint ini"), {
          status: 403,
          code: "UNIT_CONTEXT_MISMATCH",
        });
      }
      const { rows } = await pool.query(
        `UPDATE kelas SET nama_kelas = $1
         WHERE id = $2 AND tenant_id = $3 AND unit_id = $4
         RETURNING *`,
        [String(req.body.nama_kelas || "").trim(), req.params.id, req.tenantId, workspace.unitId],
      );
      if (!rows[0]) return res.status(404).json({ success: false, error: "Kelas tidak ditemukan" });
      res.json({ success: true, data: rows[0] });
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.delete(
  "/:id",
  ...withTenant,
  requirePermission("kelas.manage"),
  async (req, res) => {
    try {
      const workspace = await resolveActiveUnit(req);
      if (workspace.mode !== "UNIT") {
        throw Object.assign(new Error("Pilih satu unit aktif untuk menghapus kelas"), {
          status: 400,
          code: "UNIT_REQUIRED",
        });
      }
      const result = await pool.query(
        `DELETE FROM kelas
         WHERE id = $1 AND tenant_id = $2 AND unit_id = $3
         RETURNING id`,
        [req.params.id, req.tenantId, workspace.unitId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Kelas tidak ditemukan" });
      }

      res.json({ success: true });
    } catch (err) {
      console.log(err);
      sendError(res, err);
    }
  }
);

module.exports = router;
