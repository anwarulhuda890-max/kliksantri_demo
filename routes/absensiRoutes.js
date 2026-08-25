const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  resolveKelasScopeAccess,
  isKelasAllowed,
  kelasScopeSql,
} = require("../middleware/kelasScope");
const {
  getActiveStudentContext,
  getAttendanceSessionInUnit,
} = require("../services/academicUnitService");

async function loadAccess(req, res) {
  const access = await resolveKelasScopeAccess(req);
  if (access.denied) {
    res.status(access.status || 403).json({
      success: false,
      error: access.error || "Akses ditolak",
    });
    return null;
  }
  return access;
}

async function assertSantriAllowed(access, santriId) {
  if (access.mode === "ALL") {
    return { ok: false, status: 400, error: "Pilih unit terlebih dahulu", code: "UNIT_REQUIRED" };
  }
  try {
    const context = await getActiveStudentContext(access.tenantId, santriId, access.unitId);
    if (!context.kelas_id || !isKelasAllowed(access, context.kelas_id)) {
      return { ok: false, status: 403, error: "Akses kelas ditolak" };
    }
    return { ok: true, context };
  } catch (error) {
    return { ok: false, status: error.status || 403, error: error.message, code: error.code };
  }
}

router.get("/kelas", async (req, res) => {
  try {
    const access = await loadAccess(req, res);
    if (!access) return;

    const params = [access.tenantId];
    let query = `SELECT id, nama_kelas
                 FROM kelas
                 WHERE tenant_id = $1`;

    const scope = kelasScopeSql(access, "id", 2);
    query += scope.clause;
    params.push(...scope.params);
    query += " ORDER BY id ASC";

    const { rows } = await pool.query(query, params);
    res.json({
      success: true,
      data: rows.map((row) => ({
        ...row,
        can_manage: Boolean(access.canManage),
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/santri", async (req, res) => {
  try {
    const access = await loadAccess(req, res);
    if (!access) return;

    const kelasId = req.query.kelas_id ? Number(req.query.kelas_id) : null;
    if (access.mode === "ALL") {
      return res.status(400).json({ success: false, error: "Pilih unit terlebih dahulu", code: "UNIT_REQUIRED" });
    }
    const params = [access.tenantId, access.unitId];
    let query = `SELECT s.id, s.nis, s.nama, e.kelas_id, s.kamar,
                        su.id AS santri_unit_id, e.id AS enrollment_id
                 FROM santri s
                 JOIN santri_units su
                   ON su.tenant_id = s.tenant_id AND su.santri_id = s.id
                  AND su.unit_id = $2 AND su.status = 'active' AND su.left_at IS NULL
                 JOIN LATERAL (
                   SELECT ske.id, ske.kelas_id
                   FROM santri_kelas_enrollments ske
                   WHERE ske.tenant_id = su.tenant_id
                     AND ske.santri_unit_id = su.id
                     AND ske.status = 'active' AND ske.end_date IS NULL
                   ORDER BY ske.id DESC LIMIT 1
                 ) e ON TRUE
                 WHERE s.tenant_id = $1`;
    let idx = 2;

    idx = 3;
    const scope = kelasScopeSql(access, "e.kelas_id", idx);
    query += scope.clause;
    params.push(...scope.params);
    idx = scope.nextIndex;

    if (kelasId) {
      if (!isKelasAllowed(access, kelasId)) {
        return res.status(403).json({ success: false, error: "Akses kelas ditolak" });
      }
      query += ` AND e.kelas_id = $${idx}`;
      params.push(kelasId);
    }

    query += " ORDER BY nama ASC, id ASC";

    const { rows } = await pool.query(query, params);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const access = await loadAccess(req, res);
    if (!access) return;

    const bulan = req.query.bulan ? Number(req.query.bulan) : null;
    const tahun = req.query.tahun ? Number(req.query.tahun) : null;

    let query = `SELECT a.id, a.santri_id, a.session_id,
                     COALESCE(a.session_name_snapshot, a.sesi, configured.display_name) AS sesi,
                     configured.display_name AS session_current_name,
                     a.status, a.unit_id, a.kelas_id, a.santri_unit_id, a.enrollment_id,
                     (SELECT kamar FROM santri WHERE id = a.santri_id AND tenant_id = a.tenant_id) AS kamar,
                     TO_CHAR(a.tanggal::date, 'YYYY-MM-DD') AS tanggal
                 FROM absensi a
                 LEFT JOIN attendance_sessions configured
                   ON configured.tenant_id = a.tenant_id
                  AND configured.unit_id = a.unit_id
                  AND configured.id = a.session_id
                 WHERE a.tenant_id = $1`;
    const params = [req.tenantId];
    let paramIdx = 2;

    if (access.mode !== "ALL") {
      query += ` AND a.unit_id = $${paramIdx}`;
      params.push(access.unitId);
      paramIdx += 1;
    }

    if (bulan && tahun) {
      query += ` AND EXTRACT(MONTH FROM a.tanggal::date) = $${paramIdx}`
             + ` AND EXTRACT(YEAR FROM a.tanggal::date) = $${paramIdx + 1}`;
      params.push(bulan, tahun);
      paramIdx += 2;
    } else if (bulan) {
      query += ` AND EXTRACT(MONTH FROM a.tanggal::date) = $${paramIdx}`;
      params.push(bulan);
      paramIdx += 1;
    } else if (tahun) {
      query += ` AND EXTRACT(YEAR FROM a.tanggal::date) = $${paramIdx}`;
      params.push(tahun);
    }

    query += " ORDER BY a.tanggal ASC, a.id ASC";

    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, error: err.message, code: err.code });
  }
});

router.post("/", async (req, res) => {
  try {
    const access = await loadAccess(req, res);
    if (!access) return;

    if (!access.canManage) {
      return res.status(403).json({
        success: false,
        error: "Role belum memiliki izin kelola absensi",
      });
    }
    if (access.mode === "ALL") {
      return res.status(400).json({
        success: false,
        error: "Pilih unit aktif untuk mengisi absensi",
        code: "UNIT_REQUIRED",
      });
    }

    const { santri_id, tanggal, session_id, status } = req.body;

    if (!status || status === "") {
      return res.status(400).json({
        success: false,
        error: "Status absensi wajib diisi",
      });
    }

    const session = await getAttendanceSessionInUnit(
      req.tenantId,
      session_id,
      access.unitId,
      { requireActive: true },
    );
    const santriCheck = await assertSantriAllowed(access, santri_id);
    if (!santriCheck.ok) {
      return res.status(santriCheck.status || 400).json({
        success: false,
        error: santriCheck.error,
        code: santriCheck.code,
      });
    }

    const result = await pool.query(
      `INSERT INTO absensi (
         santri_id, tanggal, sesi, session_id, session_name_snapshot, status, tenant_id,
         unit_id, santri_unit_id, enrollment_id, kelas_id, actor_user_id, source
       )
       VALUES ($1, $2, $3, $4, $3, $5, $6, $7, $8, $9, $10, $11, 'admin')
       ON CONFLICT (tenant_id, unit_id, santri_id, tanggal, session_id)
       WHERE unit_id IS NOT NULL AND session_id IS NOT NULL
       DO UPDATE SET status = EXCLUDED.status,
                     santri_unit_id = EXCLUDED.santri_unit_id,
                     enrollment_id = EXCLUDED.enrollment_id,
                     kelas_id = EXCLUDED.kelas_id,
                     actor_user_id = EXCLUDED.actor_user_id,
                     source = EXCLUDED.source
       RETURNING *`,
      [
        santri_id,
        tanggal,
        session.display_name,
        session.id,
        status,
        req.tenantId,
        access.unitId,
        santriCheck.context.santri_unit_id,
        santriCheck.context.enrollment_id,
        santriCheck.context.kelas_id,
        req.user?.id || null,
      ]
    );

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(err.status || 500).json({ success: false, error: err.message, code: err.code });
  }
});

module.exports = router;
