const express = require("express");
const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");
const {
  getClassInUnit,
  getMapelInUnit,
  resolveAcademicUnit,
  sendAcademicError,
} = require("../services/academicUnitService");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const kelasId = req.query.kelas_id ? Number(req.query.kelas_id) : null;
    const access = await resolveAcademicUnit(req);
    if (kelasId && access.mode === "UNIT") await getClassInUnit(req.tenantId, kelasId, access.unitId);
    const result = await pool.query(
      `SELECT mp.id, mp.nama, mp.aktif,
              CASE WHEN $2::int IS NULL THEN false ELSE EXISTS (
                SELECT 1 FROM kelas_mata_pelajaran kmp
                WHERE kmp.mata_pelajaran_id = mp.id
                  AND kmp.kelas_id = $2
                  AND kmp.tenant_id = $1
              ) END AS ditugaskan
       FROM mata_pelajaran mp
       WHERE mp.tenant_id = $1 AND mp.aktif = true
         AND ($3::integer IS NULL OR mp.unit_id = $3)
       ORDER BY mp.nama ASC`,
      [req.tenantId, kelasId, access.unitId],
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    sendAcademicError(res, err);
  }
});

router.post("/", requirePermission("nilai.manage"), async (req, res) => {
  try {
    const nama = String(req.body?.nama || "").trim();
    if (!nama || nama.length > 120) {
      return res.status(400).json({ success: false, error: "Nama mata pelajaran wajib diisi" });
    }
    const access = await resolveAcademicUnit(req);
    if (access.mode === "ALL") {
      return res.status(400).json({ success: false, error: "Pilih unit terlebih dahulu", code: "UNIT_REQUIRED" });
    }
    let result = await pool.query(
      `INSERT INTO mata_pelajaran (tenant_id, unit_id, nama)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [req.tenantId, access.unitId, nama],
    );
    if (!result.rows[0]) {
      result = await pool.query(
        `UPDATE mata_pelajaran SET aktif = true
         WHERE tenant_id = $1 AND unit_id = $2
           AND LOWER(TRIM(nama)) = LOWER(TRIM($3))
         RETURNING *`,
        [req.tenantId, access.unitId, nama],
      );
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    sendAcademicError(res, err);
  }
});

router.post("/assign", requirePermission("nilai.manage"), async (req, res) => {
  try {
    const kelasId = Number(req.body?.kelas_id);
    const mapelId = Number(req.body?.mata_pelajaran_id);
    if (!Number.isInteger(kelasId) || !Number.isInteger(mapelId)) {
      return res.status(400).json({ success: false, error: "Kelas dan mata pelajaran wajib dipilih" });
    }
    const access = await resolveAcademicUnit(req);
    if (access.mode === "ALL") {
      return res.status(400).json({ success: false, error: "Pilih unit terlebih dahulu", code: "UNIT_REQUIRED" });
    }
    await getClassInUnit(req.tenantId, kelasId, access.unitId);
    await getMapelInUnit(req.tenantId, mapelId, access.unitId);
    const result = await pool.query(
      `INSERT INTO kelas_mata_pelajaran (tenant_id, unit_id, kelas_id, mata_pelajaran_id, urutan)
       SELECT $1, $2, k.id, mp.id,
              COALESCE((SELECT MAX(urutan) + 1 FROM kelas_mata_pelajaran WHERE tenant_id = $1 AND kelas_id = k.id), 1)
       FROM kelas k JOIN mata_pelajaran mp ON mp.id = $4 AND mp.tenant_id = $1 AND mp.unit_id = $2
       WHERE k.id = $3 AND k.tenant_id = $1 AND k.unit_id = $2
       ON CONFLICT (tenant_id, kelas_id, mata_pelajaran_id) DO NOTHING
       RETURNING *`,
      [req.tenantId, access.unitId, kelasId, mapelId],
    );
    if (!result.rows.length) return res.status(404).json({ success: false, error: "Kelas atau mapel tidak ditemukan" });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    sendAcademicError(res, err);
  }
});

router.delete("/assign/:kelasId/:mapelId", requirePermission("nilai.manage"), async (req, res) => {
  try {
    const access = await resolveAcademicUnit(req);
    if (access.mode === "ALL") {
      return res.status(400).json({ success: false, error: "Pilih unit terlebih dahulu", code: "UNIT_REQUIRED" });
    }
    const result = await pool.query(
      `DELETE FROM kelas_mata_pelajaran
       WHERE tenant_id = $1 AND unit_id = $2 AND kelas_id = $3 AND mata_pelajaran_id = $4
       RETURNING id`,
      [req.tenantId, access.unitId, Number(req.params.kelasId), Number(req.params.mapelId)],
    );
    if (!result.rows.length) return res.status(404).json({ success: false, error: "Mapel belum ditugaskan" });
    res.json({ success: true });
  } catch (err) {
    sendAcademicError(res, err);
  }
});

module.exports = router;
