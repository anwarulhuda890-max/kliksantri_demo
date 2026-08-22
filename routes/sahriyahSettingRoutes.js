const express = require("express");
const router = express.Router();
const pool = require("../db");
const { assertSantriInTenant } = require("../services/tenantScope");
const {
  accessResponse,
  requireSantriInActiveUnit,
  resolveOperationalAccess,
  sendUnitError,
} = require("../services/operationalUnitService");

router.get("/", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req);
    const unitFilter = access.mode === "UNIT" ? " AND su.unit_id = $2" : "";
    const params = access.mode === "UNIT" ? [req.tenantId, access.unitId] : [req.tenantId];
    const result = await pool.query(
      `SELECT s.id, s.nama, su.unit_id, su.id AS santri_unit_id,
              ss.nominal_uang, ss.nominal_beras, ss.keterangan
       FROM santri_units su
       JOIN santri s
         ON s.id = su.santri_id
        AND s.tenant_id = su.tenant_id
       LEFT JOIN sahriyah_setting ss
         ON s.id = ss.santri_id
        AND ss.tenant_id = s.tenant_id
        AND ss.unit_id = su.unit_id
       WHERE su.tenant_id = $1
         AND su.status = 'active'
         AND su.left_at IS NULL
         ${unitFilter}
       ORDER BY s.nama`,
      params
    );

    res.json({ success: true, data: result.rows, access: accessResponse(access) });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal memuat setting sahriyah");
  }
});

router.put("/bulk", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req, pool, { requireSpecific: true });
    const { nominal_uang, nominal_beras, keterangan } = req.body;

    if (nominal_uang === undefined || nominal_beras === undefined) {
      return res.status(400).json({
        success: false,
        error: "nominal_uang dan nominal_beras wajib diisi",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO sahriyah_setting (
        santri_id,
        unit_id,
        santri_unit_id,
        nominal_uang,
        nominal_beras,
        keterangan,
        tenant_id,
        actor_user_id,
        source
      )
      SELECT
        s.id,
        su.unit_id,
        su.id,
        $1,
        $2,
        $3,
        $4,
        $6,
        'manual'
      FROM santri_units su
      JOIN santri s
        ON s.id = su.santri_id
       AND s.tenant_id = su.tenant_id
      WHERE su.tenant_id = $4
        AND su.unit_id = $5
        AND su.status = 'active'
        AND su.left_at IS NULL
      ON CONFLICT (tenant_id, unit_id, santri_id) WHERE unit_id IS NOT NULL
      DO UPDATE SET
        nominal_uang = EXCLUDED.nominal_uang,
        nominal_beras = EXCLUDED.nominal_beras,
        keterangan = EXCLUDED.keterangan,
        santri_unit_id = EXCLUDED.santri_unit_id,
        actor_user_id = EXCLUDED.actor_user_id,
        source = EXCLUDED.source
      RETURNING id
      `,
      [
        Number(nominal_uang || 0),
        Number(nominal_beras || 0),
        keterangan || "",
        req.tenantId,
        access.unitId,
        req.user?.id || null,
      ]
    );

    res.json({
      success: true,
      updated_count: result.rowCount,
    });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal menyimpan bulk setting sahriyah");
  }
});

router.put("/:id", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req, pool, { requireSpecific: true });
    const { nominal_uang, nominal_beras, keterangan } = req.body;
    const santriId = req.params.id;

    const santriCheck = await assertSantriInTenant(req.tenantId, santriId);
    if (!santriCheck.ok) {
      return res.status(400).json({ success: false, error: santriCheck.error });
    }
    const membership = await requireSantriInActiveUnit(pool, req.tenantId, santriId, access.unitId);

    const cek = await pool.query(
      `SELECT id FROM sahriyah_setting
       WHERE santri_id = $1 AND tenant_id = $2 AND unit_id = $3`,
      [santriId, req.tenantId, access.unitId]
    );

    if (cek.rows.length === 0) {
      await pool.query(
        `INSERT INTO sahriyah_setting (
           santri_id, unit_id, santri_unit_id, nominal_uang, nominal_beras,
           keterangan, tenant_id, actor_user_id, source
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual')`,
        [
          santriId,
          access.unitId,
          membership.santri_unit_id,
          nominal_uang,
          nominal_beras,
          keterangan,
          req.tenantId,
          req.user?.id || null,
        ]
      );
    } else {
      await pool.query(
        `UPDATE sahriyah_setting
         SET nominal_uang = $1,
             nominal_beras = $2,
             keterangan = $3,
             santri_unit_id = $4,
             actor_user_id = $5,
             source = 'manual'
         WHERE santri_id = $6 AND tenant_id = $7 AND unit_id = $8`,
        [
          nominal_uang,
          nominal_beras,
          keterangan,
          membership.santri_unit_id,
          req.user?.id || null,
          santriId,
          req.tenantId,
          access.unitId,
        ]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal menyimpan setting sahriyah");
  }
});

module.exports = router;
