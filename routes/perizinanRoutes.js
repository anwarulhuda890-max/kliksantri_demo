const express = require("express");
const router = express.Router();

const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");
const { listOperationalStudents } = require("../services/operationalStudentLookupService");
const {
  assertSantriInTenant,
  assertRecordInTenant,
} = require("../services/tenantScope");
const {
  accessResponse,
  requireSantriInActiveUnit,
  resolveOperationalAccess,
  sendUnitError,
} = require("../services/operationalUnitService");

const notificationService =
  require("../services/notificationService");

console.log("PERIZINAN ROUTES LOADED");

router.get(
  "/student-lookup",
  requirePermission.requireAnyPermission(["perizinan.create", "perizinan.update"]),
  async (req, res) => {
    try {
      const { rows, access } = await listOperationalStudents(req);
      res.json({ success: true, data: rows, access: accessResponse(access) });
    } catch (err) {
      sendUnitError(res, err, "Gagal memuat lookup santri perizinan");
    }
  },
);

router.get("/", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req);
    const unitFilter = access.mode === "UNIT" ? " AND perizinan.unit_id = $2" : "";
    const params = access.mode === "UNIT" ? [req.tenantId, access.unitId] : [req.tenantId];
    const result = await pool.query(
      `SELECT perizinan.*, santri.nama, santri.kamar
       FROM perizinan
       LEFT JOIN santri
        ON perizinan.santri_id = santri.id
        AND santri.tenant_id = perizinan.tenant_id
       WHERE perizinan.tenant_id = $1
       ${unitFilter}
       ORDER BY perizinan.id DESC`,
      params
    );

    res.json({ success: true, data: result.rows, access: accessResponse(access) });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal memuat perizinan");
  }
});

router.post("/", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req, pool, { requireSpecific: true });
    const {
      santri_id,
      tanggal,
      alasan,
      tujuan,
      tanggal_kembali,
      jam_keluar,
      status,
      catatan,
    } = req.body;

    const santriCheck = await assertSantriInTenant(req.tenantId, santri_id);
    if (!santriCheck.ok) {
      return res.status(400).json({ success: false, error: santriCheck.error });
    }
    const membership = await requireSantriInActiveUnit(pool, req.tenantId, santri_id, access.unitId);

    const result = await pool.query(
      `INSERT INTO perizinan (
         santri_id, tanggal, alasan, tujuan, tanggal_kembali,
         jam_keluar, status, catatan, tenant_id, unit_id, santri_unit_id, actor_user_id, source
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'manual')
       RETURNING *`,
      [
        santri_id,
        tanggal,
        alasan,
        tujuan,
        tanggal_kembali,
        jam_keluar,
        status,
        catatan,
        req.tenantId,
        access.unitId,
        membership.santri_unit_id,
        req.user?.id || null,
      ]
    );

    const perizinanRow = result.rows[0];
    const perizinanStatus = String(
      perizinanRow.status || status || ""
    ).toLowerCase();

    if (perizinanStatus === "keluar") {
      try {
        await notificationService.sendInAppToWaliBySantriId({
          tenantId: req.tenantId,
          santriId: perizinanRow.santri_id,
          title: "Izin Keluar",
          type: "perizinan",
          data: {
            type: "perizinan",
            santri_id: Number(perizinanRow.santri_id),
            ref_table: "perizinan",
            ref_id: Number(perizinanRow.id),
          },
        });
      } catch (notifErr) {
        console.log("PERIZINAN IN-APP NOTIFICATION ERROR:", notifErr.message);
      }
    }

    res.json({ success: true, data: perizinanRow });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal menyimpan perizinan");
  }
});

router.put("/kembali/:id", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req, pool, { requireSpecific: true });
    const { id } = req.params;
    const owned = await assertRecordInTenant("perizinan", req.tenantId, id);
    if (!owned.ok) {
      return res.status(404).json({ success: false, error: owned.error });
    }

    const result = await pool.query(
      `UPDATE perizinan
       SET status = 'kembali', jam_kembali = CURRENT_TIME
       WHERE id = $1 AND tenant_id = $2 AND unit_id = $3
       RETURNING *`,
      [id, req.tenantId, access.unitId]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ success: false, error: "Akses unit ditolak", code: "UNIT_ACCESS_DENIED" });
    }

    const perizinanRow = result.rows[0];

    try {
      await notificationService.sendInAppToWaliBySantriId({
        tenantId: req.tenantId,
        santriId: perizinanRow.santri_id,
        title: "Santri Kembali",
        body: "Status perizinan santri sudah tercatat kembali.",
        type: "perizinan",
        data: {
          type: "perizinan",
          santri_id: Number(perizinanRow.santri_id),
          ref_table: "perizinan",
          ref_id: Number(perizinanRow.id),
        },
      });
    } catch (notifErr) {
      console.log("PERIZINAN STATUS IN-APP NOTIFICATION ERROR:", notifErr.message);
    }

    res.json({ success: true, data: perizinanRow });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal memperbarui status perizinan");
  }
});

router.put("/:id", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req, pool, { requireSpecific: true });
    const { id } = req.params;
    const owned = await assertRecordInTenant("perizinan", req.tenantId, id);
    if (!owned.ok) {
      return res.status(404).json({ success: false, error: owned.error });
    }

    const existing = await pool.query(
      `SELECT id, santri_id, status, unit_id
       FROM perizinan
       WHERE id = $1 AND tenant_id = $2 AND unit_id = $3
       LIMIT 1`,
      [id, req.tenantId, access.unitId]
    );
    if (existing.rows.length === 0) {
      return res.status(403).json({ success: false, error: "Akses unit ditolak", code: "UNIT_ACCESS_DENIED" });
    }

    const {
      tanggal,
      alasan,
      tujuan,
      tanggal_kembali,
      jam_keluar,
      status,
      catatan,
    } = req.body;

    const result = await pool.query(
      `UPDATE perizinan
       SET tanggal = $1, alasan = $2, tujuan = $3, tanggal_kembali = $4,
           jam_keluar = $5, status = $6, catatan = $7
       WHERE id = $8 AND tenant_id = $9 AND unit_id = $10
       RETURNING *`,
      [
        tanggal,
        alasan,
        tujuan,
        tanggal_kembali,
        jam_keluar,
        status,
        catatan,
        id,
        req.tenantId,
        access.unitId,
      ]
    );

    const perizinanRow = result.rows[0];
    const oldStatus = String(existing.rows[0]?.status || "").toLowerCase();
    const newStatus = String(perizinanRow.status || "").toLowerCase();

    if (newStatus && oldStatus !== newStatus) {
      try {
        await notificationService.sendInAppToWaliBySantriId({
          tenantId: req.tenantId,
          santriId: perizinanRow.santri_id,
          title: "Status Perizinan Berubah",
          body: `Status perizinan santri berubah menjadi ${perizinanRow.status}.`,
          type: "perizinan",
          data: {
            type: "perizinan",
            santri_id: Number(perizinanRow.santri_id),
            ref_table: "perizinan",
            ref_id: Number(perizinanRow.id),
          },
        });
      } catch (notifErr) {
        console.log("PERIZINAN UPDATE IN-APP NOTIFICATION ERROR:", notifErr.message);
      }
    }

    res.json({ success: true, data: perizinanRow });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal memperbarui perizinan");
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req, pool, { requireSpecific: true });
    const result = await pool.query(
      `DELETE FROM perizinan
       WHERE id = $1 AND tenant_id = $2 AND unit_id = $3
       RETURNING id`,
      [req.params.id, req.tenantId, access.unitId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Perizinan tidak ditemukan di tenant ini",
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal menghapus perizinan");
  }
});

module.exports = router;
