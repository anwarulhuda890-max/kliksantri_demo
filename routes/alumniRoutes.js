const express = require("express");
const multer = require("multer");
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const tenantMiddleware = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/requirePermission");
const requireUnitFeature = require("../middleware/requireUnitFeature");
const { resolveAlumniUnit } = require("../services/alumniUnitScopeService");
const {
  buildExportWorkbook,
  buildTemplateWorkbook,
  classifyNormalizedRow,
  commitImport,
  listScopedAlumni,
  previewImport,
  upsertAlumniIdentity,
} = require("../services/alumniExcelService");

const router = express.Router();
const withTenant = [authMiddleware, tenantMiddleware, requireUnitFeature("santri")];
const withView = [...withTenant, requirePermission("alumni.view")];
const withManage = [...withTenant, requirePermission("alumni.manage")];

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, callback) {
    if (!String(file.originalname || "").toLowerCase().endsWith(".xlsx")) {
      return callback(new Error("Format file harus .xlsx"));
    }
    callback(null, true);
  },
});

function sendError(res, error, fallback = "Gagal memproses Alumni") {
  const duplicate = error.code === "23505";
  const status = duplicate ? 409 : (Number(error.status) || 500);
  return res.status(status).json({
    success: false,
    error: duplicate ? "Alumni sudah terdaftar pada unit dan tahun lulus tersebut" : (status >= 500 ? fallback : error.message),
    code: duplicate ? "ALREADY_ALUMNI" : error.code,
  });
}

function clean(value) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function parseYear(value, label, { required = false } = {}) {
  if (value === null || value === undefined || value === "") {
    if (required) throw Object.assign(new Error(`${label} wajib diisi`), { status: 400, code: "INVALID_ALUMNI" });
    return null;
  }
  const year = Number(value);
  if (!Number.isInteger(year) || year < 1900 || year > 2200) {
    throw Object.assign(new Error(`${label} harus tahun 4 digit antara 1900-2200`), { status: 400, code: "INVALID_ALUMNI" });
  }
  return year;
}

function normalizePayload(body) {
  const nama = clean(body.nama);
  if (!nama) throw Object.assign(new Error("Nama alumni wajib diisi"), { status: 400, code: "INVALID_ALUMNI" });
  const tahunMasuk = parseYear(body.tahun_masuk, "Tahun masuk");
  const tahunLulus = parseYear(body.tahun_lulus, "Tahun lulus", { required: true });
  if (tahunMasuk && tahunLulus < tahunMasuk) {
    throw Object.assign(new Error("Tahun lulus tidak boleh sebelum tahun masuk"), { status: 400, code: "INVALID_ALUMNI" });
  }
  const status = ["lulus", "keluar"].includes(String(body.status_kelulusan || "lulus").toLowerCase())
    ? String(body.status_kelulusan || "lulus").toLowerCase() : "lulus";
  return {
    nama,
    nis: clean(body.nis),
    jenis_kelamin: clean(body.jenis_kelamin),
    tahun_masuk: tahunMasuk,
    tahun_lulus: tahunLulus,
    angkatan: clean(body.angkatan),
    status_kelulusan: status,
    kelas_terakhir: clean(body.kelas_terakhir),
    kontak: clean(body.kontak),
    alamat: clean(body.alamat),
    pekerjaan: clean(body.pekerjaan),
    catatan: clean(body.catatan),
  };
}

router.get("/import/template", ...withManage, async (req, res) => {
  try {
    await resolveAlumniUnit(req);
    const buffer = buildTemplateWorkbook();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="template_import_alumni.xlsx"');
    res.send(buffer);
  } catch (error) {
    sendError(res, error, "Gagal membuat template Alumni");
  }
});

router.post("/import/preview", ...withManage, (req, res) => {
  importUpload.single("file")(req, res, async (uploadError) => {
    if (uploadError) {
      const message = uploadError instanceof multer.MulterError && uploadError.code === "LIMIT_FILE_SIZE"
        ? "Ukuran file maksimal 5MB" : uploadError.message;
      return res.status(400).json({ success: false, error: message, code: "INVALID_FILE" });
    }
    if (!req.file) return res.status(400).json({ success: false, error: "File Excel wajib diupload", code: "INVALID_FILE" });
    try {
      const access = await resolveAlumniUnit(req);
      const result = await previewImport(req.tenantId, access.unitId, req.file.buffer);
      res.json({ success: true, data: result, meta: { unit_id: access.unitId, unit_name: access.unit.nama } });
    } catch (error) {
      sendError(res, error, "Gagal membaca file Alumni");
    }
  });
});

router.post("/import/commit", ...withManage, async (req, res) => {
  try {
    const access = await resolveAlumniUnit(req);
    const result = await commitImport(req.tenantId, access.unitId, req.body.rows);
    res.json({ success: true, data: result, meta: { unit_id: access.unitId, unit_name: access.unit.nama } });
  } catch (error) {
    sendError(res, error, "Gagal mengimport Alumni");
  }
});

router.get("/export", ...withView, async (req, res) => {
  try {
    const access = await resolveAlumniUnit(req);
    const result = await listScopedAlumni({
      tenantId: req.tenantId,
      unitId: access.unitId,
      search: req.query.search,
      tahunLulus: req.query.tahun_lulus,
    });
    const buffer = buildExportWorkbook(result.rows);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="alumni_${access.unitId}.xlsx"`);
    res.setHeader("X-Export-Row-Count", String(result.rows.length));
    res.send(buffer);
  } catch (error) {
    sendError(res, error, "Gagal export Alumni");
  }
});

router.get("/", ...withView, async (req, res) => {
  try {
    const access = await resolveAlumniUnit(req);
    const result = await listScopedAlumni({
      tenantId: req.tenantId,
      unitId: access.unitId,
      search: req.query.search,
      tahunLulus: req.query.tahun_lulus,
    });
    res.json({
      success: true,
      data: result.rows,
      meta: { unit_id: access.unitId, unit_name: access.unit.nama, available_years: result.years, total: result.rows.length },
    });
  } catch (error) {
    sendError(res, error, "Gagal memuat Alumni");
  }
});

router.post("/", ...withManage, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const access = await resolveAlumniUnit(req, client);
    const data = normalizePayload(req.body);
    let classification = { action: "NEW_ALUMNI", status: "valid", identity_key: null };
    if (data.nis) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`,
        [`alumni:${req.tenantId}`, `${access.unitId}:${data.nis.toLowerCase()}:${data.tahun_lulus}`]);
      classification = await classifyNormalizedRow(req.tenantId, access.unitId, data, client);
      if (classification.status !== "valid") {
        throw Object.assign(new Error(classification.errors?.[0] || "Alumni sudah terdaftar"), {
          status: 409, code: classification.action,
        });
      }
    }
    const alumni = await upsertAlumniIdentity(client, req.tenantId, data, classification);
    const identityKey = classification.identity_key || `ALUMNI:${alumni.id}`;
    await client.query(
      `INSERT INTO alumni_units (
         tenant_id, alumni_id, unit_id, identity_key, tahun_masuk, tahun_lulus,
         angkatan, status_kelulusan, kelas_terakhir, catatan, source
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual')`,
      [req.tenantId, alumni.id, access.unitId, identityKey, data.tahun_masuk, data.tahun_lulus,
        data.angkatan, data.status_kelulusan, data.kelas_terakhir, data.catatan],
    );
    await client.query("COMMIT");
    res.status(201).json({ success: true, data: alumni, meta: { unit_id: access.unitId } });
  } catch (error) {
    await client.query("ROLLBACK");
    sendError(res, error, "Gagal menambah Alumni");
  } finally {
    client.release();
  }
});

router.put("/:id", ...withManage, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const access = await resolveAlumniUnit(req, client);
    const data = normalizePayload(req.body);
    const owned = await client.query(
      `SELECT a.*, au.id AS alumni_unit_id, au.identity_key
       FROM alumni a JOIN alumni_units au ON au.tenant_id=a.tenant_id AND au.alumni_id=a.id
       WHERE a.tenant_id=$1 AND a.id=$2 AND au.unit_id=$3 FOR UPDATE OF a, au`,
      [req.tenantId, req.params.id, access.unitId],
    );
    if (!owned.rows.length) throw Object.assign(new Error("Data Alumni tidak ditemukan pada unit aktif"), { status: 404, code: "ALUMNI_NOT_FOUND" });
    const current = owned.rows[0];
    if (data.nis) {
      const conflicts = await client.query(
        `SELECT 1 FROM santri WHERE tenant_id=$1 AND LOWER(BTRIM(nis))=$2 AND id IS DISTINCT FROM $3
         UNION ALL
         SELECT 1 FROM alumni WHERE tenant_id=$1 AND LOWER(BTRIM(nis))=$2 AND id<>$4 LIMIT 1`,
        [req.tenantId, data.nis.toLowerCase(), current.santri_id, current.id],
      );
      if (conflicts.rows.length) throw Object.assign(new Error("NIS mengarah ke identity lain"), { status: 409, code: "CONFLICT" });
    }
    const updated = await client.query(
      `UPDATE alumni SET nama=$1, nis=$2, jenis_kelamin=$3, kontak=$4, alamat=$5,
         pekerjaan=$6, updated_at=CURRENT_TIMESTAMP
       WHERE tenant_id=$7 AND id=$8 RETURNING *`,
      [data.nama, data.nis, data.jenis_kelamin, data.kontak, data.alamat, data.pekerjaan, req.tenantId, current.id],
    );
    const identityKey = current.santri_id ? `SANTRI:${current.santri_id}` : (data.nis ? `NIS:${data.nis.toLowerCase()}` : current.identity_key);
    await client.query(
      `UPDATE alumni_units SET identity_key=$1, tahun_masuk=$2, tahun_lulus=$3,
         angkatan=$4, status_kelulusan=$5, kelas_terakhir=$6, catatan=$7,
         updated_at=CURRENT_TIMESTAMP
       WHERE tenant_id=$8 AND alumni_id=$9 AND unit_id=$10`,
      [identityKey, data.tahun_masuk, data.tahun_lulus, data.angkatan, data.status_kelulusan,
        data.kelas_terakhir, data.catatan, req.tenantId, current.id, access.unitId],
    );
    await client.query("COMMIT");
    res.json({ success: true, data: updated.rows[0], meta: { unit_id: access.unitId } });
  } catch (error) {
    await client.query("ROLLBACK");
    sendError(res, error, "Gagal mengubah Alumni");
  } finally {
    client.release();
  }
});

module.exports = router;
