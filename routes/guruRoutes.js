const express = require("express");
const router = express.Router();
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const tenantMiddleware = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/requirePermission");
const requireUnitFeature = require("../middleware/requireUnitFeature");
const {
  getGuruInUnit,
  resolveAcademicUnit,
  sendAcademicError,
} = require("../services/academicUnitService");

const withTenant = [authMiddleware, tenantMiddleware, requireUnitFeature("guru")];

console.log("GURU ROUTES LOADED");

router.get("/", ...withTenant, requirePermission("guru.view"), async (req, res) => {
  try {
    const { q } = req.query;
    const unitAccess = await resolveAcademicUnit(req);
    let query = `SELECT g.*,
                        primary_unit.kode AS unit_kode,
                        primary_unit.nama AS unit_nama,
                        COALESCE(
                          jsonb_agg(
                            DISTINCT jsonb_build_object(
                              'unit_id', gu.unit_id,
                              'unit_kode', u.kode,
                              'unit_nama', u.nama,
                              'is_primary', gu.is_primary,
                              'status', gu.status
                            )
                          ) FILTER (WHERE gu.id IS NOT NULL),
                          '[]'::jsonb
                        ) AS memberships
                 FROM guru g
                 LEFT JOIN unit_pendidikan primary_unit
                   ON primary_unit.id = g.unit_id AND primary_unit.tenant_id = g.tenant_id
                 JOIN guru_units gu
                   ON gu.guru_id = g.id
                  AND gu.tenant_id = g.tenant_id
                  AND gu.status = 'active'
                  AND gu.left_at IS NULL
                 JOIN unit_pendidikan u
                   ON u.id = gu.unit_id
                  AND u.tenant_id = gu.tenant_id
                  AND u.is_active = true
                 WHERE g.tenant_id = $1`;
    const params = [req.tenantId];
    let idx = 2;
    if (unitAccess.mode === "UNIT") {
      query += ` AND gu.unit_id = $${idx}`;
      params.push(unitAccess.unitId);
      idx += 1;
    }

    if (q) {
      const index = idx;
      query += ` AND (g.nama ILIKE $${index} OR g.jabatan ILIKE $${index} OR g.email ILIKE $${index})`;
      params.push(`%${q}%`);
      idx += 1;
    }

    query += ` GROUP BY g.id, primary_unit.kode, primary_unit.nama
               ORDER BY g.nama ASC`;

    const result = await pool.query(query, params);
    res.json({
      success: true,
      meta: {
        scope: unitAccess.mode === "UNIT" ? "unit" : "all",
        unit_id: unitAccess.mode === "UNIT" ? unitAccess.unitId : null,
        unit_name: unitAccess.mode === "UNIT" ? unitAccess.unit?.nama || null : null,
      },
      data: result.rows,
    });
  } catch (err) {
    sendAcademicError(res, err);
  }
});

router.post("/", ...withTenant, requirePermission("guru.create"), async (req, res) => {
  try {
    const {
      nama,
      jabatan,
      nomor_hp,
      email,
      alamat,
      tanggal_masuk,
      status,
      catatan,
      unit_id,
    } = req.body;

    if (!nama || !nama.trim()) {
      return res.status(400).json({ success: false, error: "Nama guru wajib diisi" });
    }

    const unitRequest = unit_id ? { ...req, query: { ...req.query, unit_id } } : req;
    const unitAccess = await resolveAcademicUnit(unitRequest);
    if (unitAccess.mode !== "UNIT") {
      return res.status(400).json({ success: false, error: "Pilih unit aktif untuk menambah guru", code: "UNIT_REQUIRED" });
    }
    const unitValue = unitAccess.unitId;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const identity = await client.query(
        `SELECT *
         FROM guru
         WHERE tenant_id = $1
           AND (
             ($2::text IS NOT NULL AND $2::text <> '' AND LOWER(email) = LOWER($2::text))
             OR ($3::text IS NOT NULL AND $3::text <> '' AND nomor_hp = $3::text)
           )
         ORDER BY id ASC
         LIMIT 1`,
        [req.tenantId, email || null, nomor_hp || null],
      );

      let savedGuru = identity.rows[0];
      if (savedGuru) {
        const updated = await client.query(
          `UPDATE guru
           SET nama = $1,
               jabatan = COALESCE($2, jabatan),
               nomor_hp = COALESCE($3, nomor_hp),
               email = COALESCE($4, email),
               alamat = COALESCE($5, alamat),
               tanggal_masuk = COALESCE($6, tanggal_masuk),
               status = COALESCE($7, status),
               catatan = COALESCE($8, catatan),
               unit_id = COALESCE(unit_id, $9)
           WHERE id = $10 AND tenant_id = $11
           RETURNING *`,
          [
            nama.trim(),
            jabatan || null,
            nomor_hp || null,
            email || null,
            alamat || null,
            tanggal_masuk || null,
            status || "Aktif",
            catatan || null,
            unitValue,
            savedGuru.id,
            req.tenantId,
          ],
        );
        savedGuru = updated.rows[0];
      } else {
        const result = await client.query(
          `INSERT INTO guru (
             nama, jabatan, nomor_hp, email, alamat,
             tanggal_masuk, status, catatan, tenant_id, unit_id
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            nama.trim(),
            jabatan || null,
            nomor_hp || null,
            email || null,
            alamat || null,
            tanggal_masuk || null,
            status || "Aktif",
            catatan || null,
            req.tenantId,
            unitValue,
          ],
        );
        savedGuru = result.rows[0];
      }
      await client.query(
        `INSERT INTO guru_units (tenant_id, guru_id, unit_id, status, joined_at, is_primary, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          req.tenantId,
          savedGuru.id,
          unitValue,
          status === "Nonaktif" ? "inactive" : "active",
          tanggal_masuk || null,
          !identity.rows[0],
          JSON.stringify({ source: identity.rows[0] ? "guru.create.link_existing" : "guru.create" }),
        ],
      );
      await client.query("COMMIT");

      res.json({ success: true, data: savedGuru, linked_existing: Boolean(identity.rows[0]) });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    sendAcademicError(res, err);
  }
});

router.put("/:id", ...withTenant, requirePermission("guru.update"), async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nama,
      jabatan,
      nomor_hp,
      email,
      alamat,
      tanggal_masuk,
      status,
      catatan,
      unit_id,
    } = req.body;

    if (!nama || !nama.trim()) {
      return res.status(400).json({ success: false, error: "Nama guru wajib diisi" });
    }

    const unitRequest = unit_id ? { ...req, query: { ...req.query, unit_id } } : req;
    const unitAccess = await resolveAcademicUnit(unitRequest);
    if (unitAccess.mode !== "UNIT") {
      return res.status(400).json({ success: false, error: "Pilih unit aktif untuk mengubah guru", code: "UNIT_REQUIRED" });
    }
    const unitValue = unitAccess.unitId;
    await getGuruInUnit(req.tenantId, id, unitValue);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
      `UPDATE guru
       SET nama          = $1,
           jabatan       = $2,
           nomor_hp      = $3,
           email         = $4,
           alamat        = $5,
           tanggal_masuk = $6,
           status        = $7,
           catatan       = $8,
           unit_id       = $9
       WHERE id = $10 AND tenant_id = $11
       RETURNING *`,
      [
        nama.trim(),
        jabatan || null,
        nomor_hp || null,
        email || null,
        alamat || null,
        tanggal_masuk || null,
        status || "Aktif",
        catatan || null,
        unitValue,
        id,
        req.tenantId,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Guru tidak ditemukan" });
    }

      await client.query(
        `INSERT INTO guru_units (tenant_id, guru_id, unit_id, status, joined_at, is_primary, metadata)
         VALUES ($1, $2, $3, $4, $5, true, $6::jsonb)
         ON CONFLICT DO NOTHING`,
        [
          req.tenantId,
          id,
          unitValue,
          status === "Nonaktif" ? "inactive" : "active",
          tanggal_masuk || null,
          JSON.stringify({ source: "guru.update" }),
        ],
      );
      await client.query("COMMIT");

      res.json({ success: true, data: result.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    sendAcademicError(res, err);
  }
});

router.delete("/:id", ...withTenant, requirePermission("guru.delete"), async (req, res) => {
  try {
    const { id } = req.params;
    const unitAccess = await resolveAcademicUnit(req);
    if (unitAccess.mode === "UNIT") {
      await getGuruInUnit(req.tenantId, id, unitAccess.unitId);
    }

    const check = await pool.query(
      "SELECT id, nama FROM guru WHERE id = $1 AND tenant_id = $2",
      [id, req.tenantId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Guru tidak ditemukan" });
    }

    await pool.query("DELETE FROM guru WHERE id = $1 AND tenant_id = $2", [id, req.tenantId]);
    res.json({ success: true, message: `Guru "${check.rows[0].nama}" berhasil dihapus` });
  } catch (err) {
    sendAcademicError(res, err);
  }
});

module.exports = router;
