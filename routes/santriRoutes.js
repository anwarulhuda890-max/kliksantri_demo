const express = require("express");
const multer = require("multer");
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const tenantMiddleware = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/requirePermission");
const { assertKelasInTenant } = require("../services/tenantScope");
const { syncWaliFromSantri } = require("../services/waliSyncService");
const {
  getOperationalChecklist,
  getExitSummary,
} = require("../services/santriOperationalService");
const { isSantriNonAktif } = require("../utils/santriStatus");
const { ensureAlumni } = require("../services/alumniService");
const { getScopedKelasIds, assertKelasInScopedUnit } = require("../middleware/dataUnitScope");
const {
  buildTemplateWorkbook,
  previewImport,
  commitImport,
} = require("../services/santriImportService");

const router = express.Router();
const withTenant = [authMiddleware, tenantMiddleware];

function normalizeLimitHarian(value) {
  if (value === null) return null;
  if (value === undefined || value === "") return 0;

  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new Error("Limit jajan harian harus angka minimal 0");
  }

  return Math.floor(normalized);
}

const importUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    const name = String(file.originalname || "").toLowerCase();
    if (!name.endsWith(".xlsx")) {
      return cb(new Error("Format file harus .xlsx"));
    }
    cb(null, true);
  },
});

const withImportAuth = [
  ...withTenant,
  requirePermission("santri.create"),
];

router.get("/import/template", ...withImportAuth, (_req, res) => {
  try {
    const buffer = buildTemplateWorkbook();
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="template_import_santri.xlsx"'
    );
    res.send(buffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/import/preview", ...withImportAuth, (req, res) => {
  importUpload.single("file")(req, res, async (err) => {
    if (err) {
      const message =
        err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE"
          ? "Ukuran file maksimal 5MB"
          : err.message || "Upload gagal";
      return res.status(400).json({ success: false, error: message });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "File Excel wajib diupload",
      });
    }

    try {
      const preview = await previewImport(req.tenantId, req.file.buffer);
      res.json(preview);
    } catch (parseErr) {
      console.error(parseErr);
      res.status(400).json({
        success: false,
        error: parseErr.message || "Gagal membaca file Excel",
      });
    }
  });
});

router.post("/import/commit", ...withImportAuth, async (req, res) => {
  try {
    const { rows } = req.body;
    const result = await commitImport(req.tenantId, rows);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/", ...withTenant, async (req, res) => {
  try {
    const scopedKelasIds = await getScopedKelasIds(req);
    const scopeSql = scopedKelasIds ? " AND santri.kelas_id = ANY($2::int[])" : "";
    const scopeParams = scopedKelasIds ? [req.tenantId, scopedKelasIds] : [req.tenantId];
    const result = await pool.query(
      `SELECT
         santri.*,
         to_char(santri.tanggal_lahir, 'YYYY-MM-DD') AS tanggal_lahir,
         to_char(santri.tanggal_masuk_pesantren, 'YYYY-MM-DD') AS tanggal_masuk_pesantren,
         kelas.nama_kelas,
         santri.orang_tua AS nama_wali,
         santri.nomor_hp_ortu AS nomor_hp
       FROM santri
       LEFT JOIN kelas
         ON santri.kelas_id = kelas.id
        AND kelas.tenant_id = santri.tenant_id
       LEFT JOIN wali_santri
         ON santri.id = wali_santri.santri_id
        AND wali_santri.tenant_id = santri.tenant_id
       WHERE santri.tenant_id = $1
         AND LOWER(TRIM(COALESCE(santri.status, 'aktif'))) IN ('aktif', 'active', '')${scopeSql}
       ORDER BY santri.id DESC`,
      scopeParams
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post(
  "/",
  ...withTenant,
  requirePermission("santri.create"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const {
        nis,
        nama,
        tempat_lahir,
        tanggal_lahir,
        jenis_kelamin,
        tanggal_masuk_pesantren,
        uid_rfid,
        alamat,
        orang_tua,
        nomor_hp_ortu,
        kelas_id,
        kamar,
        foto,
        limit_harian,
      } = req.body;

      let normalizedLimitHarian;
      try {
        normalizedLimitHarian = normalizeLimitHarian(limit_harian);
      } catch (limitErr) {
        return res.status(400).json({ success: false, error: limitErr.message });
      }

      const kelasCheck = await assertKelasInTenant(req.tenantId, kelas_id, client);
      if (!kelasCheck.ok) {
        return res.status(400).json({ success: false, error: kelasCheck.error });
      }

      const unitKelasCheck = await assertKelasInScopedUnit(req, kelas_id, client);
      if (!unitKelasCheck.ok) return res.status(403).json({ success: false, error: unitKelasCheck.error });

      await client.query("BEGIN");

      const result = await client.query(
        `INSERT INTO santri (
           nis, nama, tempat_lahir, tanggal_lahir, jenis_kelamin,
           tanggal_masuk_pesantren, uid_rfid, alamat, orang_tua,
           nomor_hp_ortu, kelas_id, kamar, foto, limit_harian, tenant_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
          RETURNING *,
            to_char(tanggal_lahir, 'YYYY-MM-DD') AS tanggal_lahir,
            to_char(tanggal_masuk_pesantren, 'YYYY-MM-DD') AS tanggal_masuk_pesantren`,
        [
          nis,
          nama,
          tempat_lahir || null,
          tanggal_lahir || null,
          jenis_kelamin || null,
          tanggal_masuk_pesantren || null,
          uid_rfid,
          alamat,
          orang_tua,
          nomor_hp_ortu,
          kelas_id || null,
          kamar || null,
          foto,
          normalizedLimitHarian,
          req.tenantId,
        ]
      );

      const santri = result.rows[0];
      const waliSync = await syncWaliFromSantri(client, {
        tenantId: req.tenantId,
        santri,
      });

      await client.query("COMMIT");

      res.json({
        success: true,
        data: santri,
        wali_sync: waliSync,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.log(err);
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  }
);

router.get("/:id/operational-checklist", ...withTenant, async (req, res) => {
  try {
    const data = await getOperationalChecklist(req.tenantId, req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, error: "Santri tidak ditemukan" });
    }
    res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:id/exit-summary", ...withTenant, async (req, res) => {
  try {
    const data = await getExitSummary(req.tenantId, req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, error: "Santri tidak ditemukan" });
    }
    res.json({ success: true, data });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.put(
  "/:id",
  ...withTenant,
  requirePermission("santri.update"),
  async (req, res) => {
    const client = await pool.connect();

    try {
      const { id } = req.params;
      const {
        nis,
        nama,
        tempat_lahir,
        tanggal_lahir,
        jenis_kelamin,
        tanggal_masuk_pesantren,
        uid_rfid,
        alamat,
        orang_tua,
        nomor_hp_ortu,
        kelas_id,
        kamar,
        foto,
        status,
        limit_harian,
      } = req.body;

      let normalizedLimitHarian;
      try {
        normalizedLimitHarian = normalizeLimitHarian(limit_harian);
      } catch (limitErr) {
        return res.status(400).json({ success: false, error: limitErr.message });
      }
      const kelasCheck = await assertKelasInTenant(req.tenantId, kelas_id, client);
      if (!kelasCheck.ok) {
        return res.status(400).json({ success: false, error: kelasCheck.error });
      }
      const unitKelasCheck = await assertKelasInScopedUnit(req, kelas_id, client);
      if (!unitKelasCheck.ok) return res.status(403).json({ success: false, error: unitKelasCheck.error });

      await client.query("BEGIN");

      const existing = await client.query(
        `SELECT id, status
         FROM santri
         WHERE id = $1 AND tenant_id = $2`,
        [id, req.tenantId],
      );

      if (existing.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Santri tidak ditemukan" });
      }

      const nextStatus = status ?? existing.rows[0].status ?? "aktif";
      const wasAktif = !isSantriNonAktif(existing.rows[0].status);
      const willNonAktif = isSantriNonAktif(nextStatus);

      const result = await client.query(
        `UPDATE santri
         SET nis = $1,
             nama = $2,
             tempat_lahir = $3,
             tanggal_lahir = $4,
             jenis_kelamin = $5,
             tanggal_masuk_pesantren = $6,
             uid_rfid = $7,
             alamat = $8,
             orang_tua = $9,
             nomor_hp_ortu = $10,
             kelas_id = $11,
             kamar = $12,
             foto = $13,
             status = $14,
             limit_harian = $15
         WHERE id = $16 AND tenant_id = $17
          RETURNING *,
            to_char(tanggal_lahir, 'YYYY-MM-DD') AS tanggal_lahir,
            to_char(tanggal_masuk_pesantren, 'YYYY-MM-DD') AS tanggal_masuk_pesantren`,
        [
          nis,
          nama,
          tempat_lahir || null,
          tanggal_lahir || null,
          jenis_kelamin || null,
          tanggal_masuk_pesantren || null,
          uid_rfid,
          alamat,
          orang_tua,
          nomor_hp_ortu,
          kelas_id || null,
          kamar || null,
          foto,
          nextStatus,
          normalizedLimitHarian,
          id,
          req.tenantId,
        ]
      );

      if (result.rows.length === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ success: false, error: "Santri tidak ditemukan" });
      }

      const santri = result.rows[0];
      await ensureAlumni(client, { tenantId: req.tenantId, santri, status: nextStatus });
      const waliSync = await syncWaliFromSantri(client, {
        tenantId: req.tenantId,
        santri,
      });

      const exitSummary =
        wasAktif && willNonAktif
          ? await getExitSummary(req.tenantId, id, client)
          : null;

      await client.query("COMMIT");

      res.json({
        success: true,
        data: santri,
        wali_sync: waliSync,
        exit_summary: exitSummary,
      });
    } catch (err) {
      await client.query("ROLLBACK");
      console.log(err);
      res.status(500).json({ success: false, error: err.message });
    } finally {
      client.release();
    }
  }
);

router.delete(
  "/:id",
  ...withTenant,
  requirePermission("santri.delete"),
  async (req, res) => {
    try {
      const result = await pool.query(
        `DELETE FROM santri
         WHERE id = $1 AND tenant_id = $2
         RETURNING id`,
        [req.params.id, req.tenantId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Santri tidak ditemukan" });
      }

      res.json({ success: true });
    } catch (err) {
      console.log(err);
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

// RFID lookup — admin + tenant scoped
router.get("/rfid/:uid", ...withTenant, requirePermission("santri.view"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, nama, uid_rfid, saldo, limit_harian, kamar
       FROM santri
       WHERE uid_rfid = $1
         AND tenant_id = $2`,
      [req.params.uid, req.tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/:id", ...withTenant, requirePermission("santri.view"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         santri.*,
         to_char(santri.tanggal_lahir, 'YYYY-MM-DD') AS tanggal_lahir,
         to_char(santri.tanggal_masuk_pesantren, 'YYYY-MM-DD') AS tanggal_masuk_pesantren,
         kelas.nama_kelas,
         santri.orang_tua AS nama_wali,
         santri.nomor_hp_ortu AS nomor_hp
       FROM santri
       LEFT JOIN kelas
         ON santri.kelas_id = kelas.id
        AND kelas.tenant_id = santri.tenant_id
       LEFT JOIN wali_santri
         ON santri.id = wali_santri.santri_id
        AND wali_santri.tenant_id = santri.tenant_id
       WHERE santri.id = $1
         AND santri.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Santri tidak ditemukan" });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
