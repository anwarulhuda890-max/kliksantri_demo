const crypto = require("crypto");
const express = require("express");
const pool = require("../db");
const { resolveKelasScopeAccess } = require("../middleware/kelasScope");
const {
  getAttendanceSessionInUnit,
  resolveAcademicUnit,
  sendAcademicError,
} = require("../services/academicUnitService");

const router = express.Router();

async function loadManageAccess(req, res, { write = false } = {}) {
  const access = await resolveKelasScopeAccess(req);
  if (access.denied) {
    res.status(access.status || 403).json({
      success: false,
      error: access.error || "Akses ditolak",
    });
    return null;
  }
  if (write && !access.canManage) {
    res.status(403).json({
      success: false,
      error: "Role belum memiliki izin kelola absensi",
    });
    return null;
  }
  return access;
}

async function requireSpecificUnit(req) {
  const unitAccess = await resolveAcademicUnit(req);
  if (unitAccess.mode !== "UNIT") {
    const error = new Error("Pilih satu unit aktif untuk mengatur sesi absensi");
    error.status = 400;
    error.code = "UNIT_REQUIRED";
    throw error;
  }
  return unitAccess;
}

function normalizeTime(value, fieldName) {
  if (value == null || value === "") return null;
  const time = String(value).trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    const error = new Error(`${fieldName} harus memakai format HH:MM`);
    error.status = 400;
    error.code = "INVALID_ATTENDANCE_SESSION_TIME";
    throw error;
  }
  return time;
}

function normalizeDisplayName(value) {
  const displayName = String(value || "").trim();
  if (!displayName || displayName.length > 120) {
    const error = new Error("Nama sesi wajib diisi dan maksimal 120 karakter");
    error.status = 400;
    error.code = "INVALID_ATTENDANCE_SESSION_NAME";
    throw error;
  }
  return displayName;
}

router.get("/", async (req, res) => {
  try {
    const access = await loadManageAccess(req, res);
    if (!access) return;
    const unitAccess = await requireSpecificUnit(req);
    const includeInactive = String(req.query.include_inactive) === "true";
    const { rows } = await pool.query(
      `SELECT id, code, display_name,
              TO_CHAR(start_time, 'HH24:MI') AS start_time,
              TO_CHAR(end_time, 'HH24:MI') AS end_time,
              sort_order, active
       FROM attendance_sessions
       WHERE tenant_id = $1 AND unit_id = $2
         AND ($3::boolean OR active = true)
       ORDER BY sort_order ASC, id ASC`,
      [req.tenantId, unitAccess.unitId, includeInactive],
    );
    res.json({ success: true, data: rows });
  } catch (error) {
    sendAcademicError(res, error);
  }
});

router.post("/", async (req, res) => {
  try {
    const access = await loadManageAccess(req, res, { write: true });
    if (!access) return;
    const unitAccess = await requireSpecificUnit(req);
    const displayName = normalizeDisplayName(req.body.display_name);
    const startTime = normalizeTime(req.body.start_time, "Jam mulai");
    const endTime = normalizeTime(req.body.end_time, "Jam selesai");
    const sortOrder = Number.isInteger(Number(req.body.sort_order)) ? Number(req.body.sort_order) : 0;
    const code = `session-${crypto.randomUUID()}`;
    const { rows } = await pool.query(
      `INSERT INTO attendance_sessions (
         tenant_id, unit_id, code, display_name, start_time, end_time, sort_order, active
       ) VALUES ($1, $2, $3, $4, $5::time, $6::time, $7, true)
       RETURNING id, code, display_name,
                 TO_CHAR(start_time, 'HH24:MI') AS start_time,
                 TO_CHAR(end_time, 'HH24:MI') AS end_time,
                 sort_order, active`,
      [req.tenantId, unitAccess.unitId, code, displayName, startTime, endTime, sortOrder],
    );
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    sendAcademicError(res, error);
  }
});

router.patch("/:sessionId", async (req, res) => {
  try {
    const access = await loadManageAccess(req, res, { write: true });
    if (!access) return;
    const unitAccess = await requireSpecificUnit(req);
    const current = await getAttendanceSessionInUnit(
      req.tenantId,
      req.params.sessionId,
      unitAccess.unitId,
      { requireActive: false },
    );
    const displayName = req.body.display_name === undefined
      ? current.display_name
      : normalizeDisplayName(req.body.display_name);
    const startTime = req.body.start_time === undefined
      ? current.start_time
      : normalizeTime(req.body.start_time, "Jam mulai");
    const endTime = req.body.end_time === undefined
      ? current.end_time
      : normalizeTime(req.body.end_time, "Jam selesai");
    const sortOrder = req.body.sort_order === undefined
      ? Number(current.sort_order)
      : Number(req.body.sort_order);
    if (!Number.isInteger(sortOrder)) {
      const error = new Error("Urutan sesi harus berupa bilangan bulat");
      error.status = 400;
      error.code = "INVALID_ATTENDANCE_SESSION_ORDER";
      throw error;
    }
    if (req.body.active !== undefined && typeof req.body.active !== "boolean") {
      const error = new Error("Status aktif sesi tidak valid");
      error.status = 400;
      error.code = "INVALID_ATTENDANCE_SESSION_ACTIVE";
      throw error;
    }
    const active = req.body.active === undefined ? current.active : req.body.active;
    const { rows } = await pool.query(
      `UPDATE attendance_sessions
       SET display_name = $4, start_time = $5::time, end_time = $6::time,
           sort_order = $7, active = $8, updated_at = NOW()
       WHERE tenant_id = $1 AND unit_id = $2 AND id = $3
       RETURNING id, code, display_name,
                 TO_CHAR(start_time, 'HH24:MI') AS start_time,
                 TO_CHAR(end_time, 'HH24:MI') AS end_time,
                 sort_order, active`,
      [req.tenantId, unitAccess.unitId, current.id, displayName, startTime, endTime, sortOrder, active],
    );
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    sendAcademicError(res, error);
  }
});

module.exports = router;
