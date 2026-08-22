const express = require("express");
const router = express.Router();
const pool = require("../db");
const { assertTagihanInTenant } = require("../services/tenantScope");
const notificationService = require("../services/notificationService");
const {
  parsePagination,
  buildPaginationResponse,
} = require("../utils/paginationHelpers");
const { SQL_SANTri_AKTIF } = require("../utils/santriStatus");
const {
  accessResponse,
  requireSantriInActiveUnit,
  resolveOperationalAccess,
  sendUnitError,
} = require("../services/operationalUnitService");

function buildSahriyahFilters(tenantId, query, access) {
  const conditions = ["t.tenant_id = $1"];
  const params = [tenantId];
  let index = 2;

  if (access?.mode === "UNIT") {
    conditions.push(`t.unit_id = $${index}`);
    params.push(access.unitId);
    index += 1;
  }

  if (query.bulan) {
    conditions.push(`t.bulan = $${index}`);
    params.push(Number(query.bulan));
    index += 1;
  }

  if (query.tahun) {
    conditions.push(`t.tahun = $${index}`);
    params.push(Number(query.tahun));
    index += 1;
  }

  if (query.status) {
    conditions.push(`LOWER(TRIM(t.status)) = LOWER(TRIM($${index}))`);
    params.push(String(query.status));
    index += 1;
  }

  if (query.kelas_id) {
    conditions.push(`enrollment.kelas_id = $${index}`);
    params.push(Number(query.kelas_id));
    index += 1;
  }

  if (query.search && String(query.search).trim()) {
    const pattern = `%${String(query.search).trim()}%`;
    conditions.push(`(s.nama ILIKE $${index} OR s.nis ILIKE $${index})`);
    params.push(pattern);
    index += 1;
  }

  return {
    whereSql: conditions.join(" AND "),
    params,
    nextIndex: index,
    joinSql: `
      FROM tagihan_sahriyah t
      LEFT JOIN santri s
        ON t.santri_id = s.id
       AND s.tenant_id = t.tenant_id
      LEFT JOIN LATERAL (
        SELECT ske.kelas_id
        FROM santri_kelas_enrollments ske
        WHERE ske.tenant_id = t.tenant_id
          AND ske.santri_unit_id = t.santri_unit_id
          AND ske.status = 'active' AND ske.end_date IS NULL
        ORDER BY ske.id DESC LIMIT 1
      ) enrollment ON TRUE
    `,
  };
}

function formatNominalRp(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return `Rp${amount.toLocaleString("id-ID")}`;
}

function isStatusLunas(status) {
  return String(status || "").trim().toLowerCase() === "lunas";
}

async function notifyTagihanSahriyahDibuat({ tenantId, santriId, tagihanId, bulan, tahun, nominal }) {
  const nominalLabel = formatNominalRp(nominal);
  const body = nominalLabel
    ? `Tagihan sahriyah bulan ${bulan}/${tahun} sebesar ${nominalLabel} telah tersedia.`
    : `Tagihan sahriyah bulan ${bulan}/${tahun} telah tersedia.`;

  const result = await notificationService.sendInAppToWaliBySantriId({
    tenantId,
    santriId: Number(santriId),
    title: "Tagihan Sahriyah Baru",
    body,
    type: "sahriyah",
    data: {
      type: "sahriyah",
      santri_id: Number(santriId),
      tagihan_id: Number(tagihanId),
      ref_table: "tagihan_sahriyah",
      ref_id: Number(tagihanId),
    },
  });

  console.log("SAHRIYAH GENERATE NOTIFICATION RESULT:", result);
  return result;
}

router.get("/", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req);
    const paging = parsePagination(req.query, { defaultLimit: 20, maxLimit: 200 });
    const { whereSql, params, nextIndex, joinSql } = buildSahriyahFilters(
      req.tenantId,
      req.query,
      access,
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total ${joinSql} WHERE ${whereSql}`,
      params,
    );

    const total = countResult.rows[0]?.total || 0;

    const summaryResult = await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE LOWER(TRIM(t.status)) = 'lunas')::int AS lunas,
         COUNT(*) FILTER (WHERE LOWER(TRIM(t.status)) != 'lunas')::int AS belum_lunas,
         COALESCE(SUM(t.nominal), 0)::numeric AS total_nominal
       ${joinSql}
       WHERE ${whereSql}`,
      params,
    );

    let listSql = `
      SELECT t.*, s.nama, s.nis, enrollment.kelas_id, s.kamar, lp.latest_invoice_id
      ${joinSql}
      LEFT JOIN LATERAL (
        SELECT ps.id AS latest_invoice_id
        FROM pembayaran_sahriyah ps
        WHERE ps.tagihan_id = t.id
          AND ps.tenant_id = t.tenant_id
        ORDER BY ps.tanggal DESC, ps.id DESC
        LIMIT 1
      ) lp ON true
      WHERE ${whereSql}
      ORDER BY t.tahun DESC, t.bulan DESC, t.id DESC
    `;

    const listParams = [...params];

    if (paging.hasPagingParams) {
      listSql += ` LIMIT $${nextIndex} OFFSET $${nextIndex + 1}`;
      listParams.push(paging.limit, paging.offset);
    }

    const result = await pool.query(listSql, listParams);

    res.json({
      success: true,
      data: result.rows,
      access: accessResponse(access),
      pagination: buildPaginationResponse({
        hasPagingParams: paging.hasPagingParams,
        limit: paging.limit,
        offset: paging.offset,
        total,
        rowCount: result.rows.length,
      }),
      summary: summaryResult.rows[0] || {
        total: 0,
        lunas: 0,
        belum_lunas: 0,
        total_nominal: 0,
      },
    });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal memuat sahriyah");
  }
});

router.post("/generate", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req, pool, { requireSpecific: true });
    const { bulan, tahun } = req.body;

    const santri = await pool.query(
      `SELECT s.id, su.id AS santri_unit_id,
              ss.id AS setting_id, ss.nominal_uang, ss.nominal_beras, ss.keterangan
       FROM santri_units su
       JOIN santri s
         ON s.id = su.santri_id
        AND s.tenant_id = su.tenant_id
       LEFT JOIN sahriyah_setting ss
         ON s.id = ss.santri_id
        AND ss.tenant_id = s.tenant_id
        AND ss.unit_id = su.unit_id
       WHERE su.tenant_id = $1
         AND su.unit_id = $2
         AND su.status = 'active'
         AND su.left_at IS NULL
         AND ${SQL_SANTri_AKTIF}
       ORDER BY s.id`,
      [req.tenantId, access.unitId]
    );

    let created_count = 0;
    let skipped_existing_count = 0;
    let skipped_no_setting_count = 0;
    const total_target = santri.rows.length;
    const createdRows = [];

    for (const s of santri.rows) {
      if (!s.setting_id) {
        skipped_no_setting_count += 1;
        continue;
      }

      const cek = await pool.query(
        `SELECT id
         FROM tagihan_sahriyah
         WHERE tenant_id = $1
           AND santri_id = $2
           AND unit_id = $3
           AND bulan = $4
           AND tahun = $5`,
        [req.tenantId, s.id, access.unitId, bulan, tahun]
      );

      if (cek.rows.length === 0) {
        const created = await pool.query(
          `INSERT INTO tagihan_sahriyah (
             santri_id, bulan, tahun, nominal, nominal_beras, keterangan,
             tenant_id, unit_id, santri_unit_id, actor_user_id, source
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'manual')
           RETURNING id`,
          [
            s.id,
            bulan,
            tahun,
            s.nominal_uang || 0,
            s.nominal_beras || 0,
            s.keterangan || "",
            req.tenantId,
            access.unitId,
            s.santri_unit_id,
            req.user?.id || null,
          ]
        );
        createdRows.push({
          id: created.rows[0]?.id,
          santri_id: s.id,
          bulan,
          tahun,
          nominal: s.nominal_uang || 0,
        });
        created_count += 1;
      } else {
        skipped_existing_count += 1;
      }
    }

    const notificationResults = await Promise.allSettled(
      createdRows.map((row) =>
        notifyTagihanSahriyahDibuat({
          tenantId: req.tenantId,
          santriId: row.santri_id,
          tagihanId: row.id,
          bulan: row.bulan,
          tahun: row.tahun,
          nominal: row.nominal,
        })
      )
    );
    const notification_count = notificationResults.filter(
      (item) => item.status === "fulfilled" && item.value?.success
    ).length;

    res.json({
      success: true,
      message: "Tagihan berhasil dibuat",
      created_count,
      skipped_count: skipped_existing_count,
      skipped_existing_count,
      skipped_no_setting_count,
      total_target,
      notification_count,
    });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal generate sahriyah");
  }
});

router.put("/bayar/:id", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req, pool, { requireSpecific: true });
    const { nominal, beras, petugas } = req.body;

    const tagihan = await pool.query(
      `SELECT t.*, s.nama, s.kamar
       FROM tagihan_sahriyah t
       LEFT JOIN santri s
         ON t.santri_id = s.id
        AND s.tenant_id = t.tenant_id
       WHERE t.id = $1 AND t.tenant_id = $2 AND t.unit_id = $3`,
      [req.params.id, req.tenantId, access.unitId]
    );

    if (tagihan.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Tagihan tidak ditemukan" });
    }

    const data = tagihan.rows[0];

    if (isStatusLunas(data.status)) {
      return res.status(409).json({
        success: false,
        error: "Tagihan sahriyah sudah lunas dan tidak dapat dibayar lagi",
      });
    }

    const totalBayarBaru = Number(data.total_bayar || 0) + Number(nominal);
    const sisaTagihanBaru = Number(data.nominal) - totalBayarBaru;
    const berasTerbayarBaru = Number(data.beras_terbayar || 0) + Number(beras || 0);
    const sisaBerasBaru = Number(data.nominal_beras || 0) - berasTerbayarBaru;

    let status = "Belum Lunas";
    if (totalBayarBaru > 0 || berasTerbayarBaru > 0) status = "Cicilan";
    if (sisaTagihanBaru <= 0 && sisaBerasBaru <= 0) status = "Lunas";

    const tanggalBayar = status === "Lunas" ? new Date() : data.tanggal_bayar;

    await pool.query(
      `UPDATE tagihan_sahriyah
       SET total_bayar = $1,
           sisa_tagihan = $2,
           beras_terbayar = $3,
           sisa_beras = $4,
           status = $5,
           petugas = $6,
           tanggal_bayar = $7
       WHERE id = $8 AND tenant_id = $9 AND unit_id = $10`,
      [
        totalBayarBaru,
        Math.max(0, sisaTagihanBaru),
        berasTerbayarBaru,
        Math.max(0, sisaBerasBaru),
        status,
        petugas,
        tanggalBayar,
        req.params.id,
        req.tenantId,
        access.unitId,
      ]
    );

    const pembayaranResult = await pool.query(
      `INSERT INTO pembayaran_sahriyah (
         tagihan_id, nominal, nominal_beras, petugas, tenant_id,
         unit_id, santri_unit_id, settlement_destination, actor_user_id, source
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'unit_cash'), $9, 'manual')
       RETURNING id`,
      [
        req.params.id,
        nominal,
        beras,
        petugas,
        req.tenantId,
        access.unitId,
        data.santri_unit_id,
        data.settlement_destination,
        req.user?.id || null,
      ]
    );
    const invoiceId = pembayaranResult.rows[0]?.id;

    if (Number(nominal) > 0) {
      await pool.query(
        `INSERT INTO buku_kas (
           tanggal, jenis, kategori, keterangan, nominal, petugas, tenant_id, unit_id, actor_user_id, source
         )
         VALUES (
           CURRENT_TIMESTAMP, 'Masuk', 'Sahriyah', $3, $1, $2, $4, $5, $6, 'sahriyah'
         )`,
        [nominal, petugas, `Pembayaran Sahriyah - ${data.nama}`, req.tenantId, access.unitId, req.user?.id || null]
      );
    }

    const tagihanId = Number(req.params.id);
    const santriId = Number(data.santri_id);
    const santriNama = data.nama || "Anak";
    const nominalBayar = Number(nominal || 0);
    const nominalLabel = formatNominalRp(nominalBayar);

    try {
      const body = nominalLabel
        ? `Pembayaran sahriyah ${santriNama} sebesar ${nominalLabel} telah diterima.`
        : `Pembayaran sahriyah ${santriNama} telah diterima.`;

      const notifResult = await notificationService.sendInAppToWaliBySantriId({
        tenantId: req.tenantId,
        santriId,
        title: "Pembayaran Sahriyah Diterima",
        body,
        type: "sahriyah",
        data: {
          type: "sahriyah",
          santri_id: santriId,
          tagihan_id: tagihanId,
          invoice_id: invoiceId ? Number(invoiceId) : null,
          ref_table: invoiceId ? "pembayaran_sahriyah" : "tagihan_sahriyah",
          ref_id: invoiceId ? Number(invoiceId) : tagihanId,
        },
      });
      console.log("SAHRIYAH IN-APP NOTIFICATION RESULT:", notifResult);
    } catch (notifErr) {
      console.log("SAHRIYAH IN-APP NOTIFICATION ERROR:", notifErr.message);
    }

    res.json({
      success: true,
      total_bayar: totalBayarBaru,
      sisa_tagihan: Math.max(0, sisaTagihanBaru),
      beras_terbayar: berasTerbayarBaru,
      sisa_beras: Math.max(0, sisaBerasBaru),
      status,
      invoice_id: invoiceId,
    });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal membayar sahriyah");
  }
});

router.get("/riwayat/:id", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req);
    const owned = await assertTagihanInTenant(req.tenantId, req.params.id);
    if (!owned.ok) {
      return res.status(404).json({ success: false, error: owned.error });
    }

    const unitFilter = access.mode === "UNIT" ? " AND ps.unit_id = $3" : "";
    const params = access.mode === "UNIT" ? [req.params.id, req.tenantId, access.unitId] : [req.params.id, req.tenantId];
    const result = await pool.query(
      `SELECT ps.*
       FROM pembayaran_sahriyah ps
       JOIN tagihan_sahriyah t
         ON t.id = ps.tagihan_id
        AND t.tenant_id = ps.tenant_id
       WHERE ps.tagihan_id = $1 AND ps.tenant_id = $2
       ${unitFilter}
       ORDER BY tanggal DESC`,
      params
    );

    res.json({ success: true, data: result.rows, access: accessResponse(access) });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal memuat riwayat sahriyah");
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const access = await resolveOperationalAccess(req, pool, { requireSpecific: true });
    const owned = await assertTagihanInTenant(req.tenantId, req.params.id);
    if (!owned.ok) {
      return res.status(404).json({ success: false, error: owned.error });
    }

    await pool.query(
      `DELETE FROM pembayaran_sahriyah
       WHERE tagihan_id = $1 AND tenant_id = $2 AND unit_id = $3`,
      [req.params.id, req.tenantId, access.unitId]
    );

    const deleted = await pool.query(
      `DELETE FROM tagihan_sahriyah
       WHERE id = $1 AND tenant_id = $2 AND unit_id = $3
       RETURNING id`,
      [req.params.id, req.tenantId, access.unitId]
    );
    if (deleted.rows.length === 0) {
      return res.status(403).json({ success: false, error: "Akses unit ditolak", code: "UNIT_ACCESS_DENIED" });
    }

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal menghapus sahriyah");
  }
});

module.exports = router;
