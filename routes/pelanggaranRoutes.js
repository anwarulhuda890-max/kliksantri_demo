const express = require("express");
const router = express.Router();
const pool = require("../db");
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

console.log("PELANGGARAN ROUTES LOADED");

router.get("/", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req);
    const unitFilter = access.mode === "UNIT" ? " AND pelanggaran.unit_id = $2" : "";
    const params = access.mode === "UNIT" ? [req.tenantId, access.unitId] : [req.tenantId];
    const result = await pool.query(
      `SELECT pelanggaran.*, santri.nama, santri.kamar
       FROM pelanggaran
       LEFT JOIN santri
        ON pelanggaran.santri_id = santri.id
        AND santri.tenant_id = pelanggaran.tenant_id
       WHERE pelanggaran.tenant_id = $1
       ${unitFilter}
       ORDER BY pelanggaran.id DESC`,
      params
    );

    res.json({ success: true, data: result.rows, access: accessResponse(access) });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal memuat pelanggaran");
  }
});

router.post("/", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req, pool, { requireSpecific: true });
    const {
      santri_id,
      tanggal,
      jam,
      jenis,
      tingkat,
      poin,
      catatan,
      tindakan,
      petugas,
    } = req.body;

    const santriCheck = await assertSantriInTenant(req.tenantId, santri_id);
    if (!santriCheck.ok) {
      return res.status(400).json({ success: false, error: santriCheck.error });
    }
    const membership = await requireSantriInActiveUnit(pool, req.tenantId, santri_id, access.unitId);

    const result = await pool.query(
      `INSERT INTO pelanggaran (
         santri_id, tanggal, jam, jenis, tingkat, poin,
         catatan, tindakan, petugas, tenant_id, unit_id, santri_unit_id, actor_user_id, source
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'manual')
       RETURNING *`,
      [
        santri_id,
        tanggal,
        jam,
        jenis,
        tingkat,
        poin,
        catatan,
        tindakan,
        petugas,
        req.tenantId,
        access.unitId,
        membership.santri_unit_id,
        req.user?.id || null,
      ]
    );

    const pelanggaranRow = result.rows[0];

    try {
      await notificationService.sendInAppToWaliBySantriId({
        tenantId: req.tenantId,
        santriId: pelanggaranRow.santri_id,
        title: "Pelanggaran Baru",
        type: "pelanggaran",
        data: {
          type: "pelanggaran",
          santri_id: Number(pelanggaranRow.santri_id),
          ref_table: "pelanggaran",
          ref_id: Number(pelanggaranRow.id),
        },
      });
    } catch (notifErr) {
      console.log("PELANGGARAN IN-APP NOTIFICATION ERROR:", notifErr.message);
    }

    res.json({ success: true, data: pelanggaranRow });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal menyimpan pelanggaran");
  }
});

router.put("/:id", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req, pool, { requireSpecific: true });
    const { id } = req.params;
    const owned = await assertRecordInTenant("pelanggaran", req.tenantId, id);
    if (!owned.ok) {
      return res.status(404).json({ success: false, error: owned.error });
    }

    const { tanggal, jam, jenis, tingkat, poin, catatan, tindakan } = req.body;

    const result = await pool.query(
      `UPDATE pelanggaran
       SET tanggal = $1, jam = $2, jenis = $3, tingkat = $4,
           poin = $5, catatan = $6, tindakan = $7
       WHERE id = $8 AND tenant_id = $9 AND unit_id = $10
       RETURNING *`,
      [tanggal, jam, jenis, tingkat, poin, catatan, tindakan, id, req.tenantId, access.unitId]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ success: false, error: "Akses unit ditolak", code: "UNIT_ACCESS_DENIED" });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal memperbarui pelanggaran");
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req, pool, { requireSpecific: true });
    const result = await pool.query(
      `DELETE FROM pelanggaran
       WHERE id = $1 AND tenant_id = $2 AND unit_id = $3
       RETURNING id`,
      [req.params.id, req.tenantId, access.unitId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Pelanggaran tidak ditemukan di tenant ini",
      });
    }

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal menghapus pelanggaran");
  }
});

module.exports = router;
