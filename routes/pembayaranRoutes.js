const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  assertSantriInTenant,
  assertPembayaranInTenant,
} = require("../services/tenantScope");
const {
  parsePagination,
  buildPaginationResponse,
} = require("../utils/paginationHelpers");
const {
  normalizeBulanToName,
  getBulanFilterVariants,
} = require("../utils/bulanNormalize");
const { isSantriAktif, SQL_SANTri_AKTIF } = require("../utils/santriStatus");
const notificationService = require("../services/notificationService");
const requirePermission = require("../middleware/requirePermission");
const { getScopedKelasIds, assertSantriInScopedUnit } = require("../middleware/dataUnitScope");

async function resolveGenerateTargetIds(client, tenantId, { scope, kelas_id, santri_ids, scopedKelasIds }) {
  const scopeClause = scopedKelasIds ? " AND s.kelas_id = ANY($3::int[])" : "";
  if (scope === "selected" || (!scope && Array.isArray(santri_ids) && santri_ids.length)) {
    const ids = [...new Set((santri_ids || []).map((id) => Number(id)).filter(Boolean))];
    if (ids.length === 0) return [];

    const result = await client.query(
      `SELECT s.id
       FROM santri s
       WHERE s.tenant_id = $1
         AND s.id = ANY($2::int[])
         AND ${SQL_SANTri_AKTIF}${scopeClause}
       ORDER BY s.id`,
      scopedKelasIds ? [tenantId, ids, scopedKelasIds] : [tenantId, ids],
    );
    return result.rows.map((row) => row.id);
  }

  if (scope === "kelas" && kelas_id) {
    const result = await client.query(
      `SELECT s.id
       FROM santri s
       WHERE s.tenant_id = $1
         AND s.kelas_id = $2${scopedKelasIds ? " AND s.kelas_id = ANY($3::int[])" : ""}
         AND ${SQL_SANTri_AKTIF}
       ORDER BY s.id`,
      scopedKelasIds ? [tenantId, Number(kelas_id), scopedKelasIds] : [tenantId, Number(kelas_id)],
    );
    return result.rows.map((row) => row.id);
  }

  const result = await client.query(
    `SELECT s.id
     FROM santri s
     WHERE s.tenant_id = $1
       AND ${SQL_SANTri_AKTIF}${scopedKelasIds ? " AND s.kelas_id = ANY($2::int[])" : ""}
     ORDER BY s.id`,
    scopedKelasIds ? [tenantId, scopedKelasIds] : [tenantId],
  );
  return result.rows.map((row) => row.id);
}

function buildPembayaranFilters(tenantId, query) {
  const conditions = ["p.tenant_id = $1"];
  const params = [tenantId];
  let index = 2;

  if (query.bulan) {
    const variants = getBulanFilterVariants(query.bulan);
    if (variants.length > 0) {
      conditions.push(`LOWER(TRIM(p.bulan)) = ANY($${index}::text[])`);
      params.push(variants);
      index += 1;
    }
  }

  if (query.tahun) {
    conditions.push(`p.tahun = $${index}`);
    params.push(Number(query.tahun));
    index += 1;
  }

  if (query.jenis_tagihan_id) {
    conditions.push(`p.jenis_tagihan_id = $${index}`);
    params.push(Number(query.jenis_tagihan_id));
    index += 1;
  }

  if (query.status) {
    conditions.push(`LOWER(TRIM(p.status)) = LOWER(TRIM($${index}))`);
    params.push(String(query.status));
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
  };
}

function isStatusLunas(status) {
  return String(status || "").trim().toLowerCase() === "lunas";
}

function formatNominalRp(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return `Rp${amount.toLocaleString("id-ID")}`;
}

async function notifyPembayaranDiterima({ tenantId, santriId, pembayaranId, invoiceId, namaTagihan, nominal }) {
  const nominalLabel = formatNominalRp(nominal);
  const body = nominalLabel
    ? `Pembayaran ${namaTagihan || "tagihan"} sebesar ${nominalLabel} telah diterima.`
    : `Pembayaran ${namaTagihan || "tagihan"} telah diterima.`;

  const result = await notificationService.sendInAppToWaliBySantriId({
    tenantId,
    santriId: Number(santriId),
    title: "Pembayaran Diterima",
    body,
    type: "pembayaran",
    data: {
      type: "pembayaran",
      santri_id: Number(santriId),
      pembayaran_id: Number(pembayaranId),
      invoice_id: invoiceId ? Number(invoiceId) : null,
      ref_table: invoiceId ? "pembayaran_detail" : "pembayaran",
      ref_id: Number(invoiceId || pembayaranId),
    },
  });

  console.log("PEMBAYARAN IN-APP NOTIFICATION RESULT:", result);
  return result;
}

async function notifyTagihanPembayaranDibuat({ tenantId, santriId, pembayaranId, namaTagihan, bulan, tahun, nominal }) {
  const nominalLabel = formatNominalRp(nominal);
  const periode = [bulan, tahun].filter(Boolean).join(" ");
  const body = nominalLabel
    ? `Tagihan ${namaTagihan || "pembayaran"} ${periode} sebesar ${nominalLabel} telah tersedia.`
    : `Tagihan ${namaTagihan || "pembayaran"} ${periode} telah tersedia.`;

  const result = await notificationService.sendInAppToWaliBySantriId({
    tenantId,
    santriId: Number(santriId),
    title: "Tagihan Pembayaran Baru",
    body,
    type: "pembayaran",
    data: {
      type: "pembayaran",
      santri_id: Number(santriId),
      pembayaran_id: Number(pembayaranId),
      ref_table: "pembayaran",
      ref_id: Number(pembayaranId),
    },
  });

  console.log("PEMBAYARAN GENERATE NOTIFICATION RESULT:", result);
  return result;
}

async function resolveJenisTagihanId(client, tenantId, namaTagihan) {
  const trimmed = String(namaTagihan || "").trim();
  if (!trimmed) {
    throw new Error("Nama tagihan wajib diisi");
  }

  const found = await client.query(
    `SELECT id
     FROM jenis_tagihan
     WHERE tenant_id = $1
       AND LOWER(TRIM(nama_tagihan)) = LOWER(TRIM($2))
     LIMIT 1`,
    [tenantId, trimmed]
  );

  if (found.rows.length > 0) {
    return found.rows[0].id;
  }

  const inserted = await client.query(
    `INSERT INTO jenis_tagihan (nama_tagihan, is_bulanan, tenant_id)
     VALUES ($1, true, $2)
     RETURNING id`,
    [trimmed, tenantId]
  );

  return inserted.rows[0].id;
}

async function findExistingPembayaran(client, tenantId, santriId, jenisTagihanId, bulan, tahun) {
  const result = await client.query(
    `SELECT id
     FROM pembayaran
     WHERE tenant_id = $1
       AND santri_id = $2
       AND jenis_tagihan_id = $3
       AND bulan = $4
       AND tahun = $5
     LIMIT 1`,
    [tenantId, santriId, jenisTagihanId, String(bulan), Number(tahun)]
  );

  return result.rows[0] || null;
}

async function insertPembayaran(client, tenantId, payload) {
  const {
    santri_id,
    jenis_tagihan_id,
    nama_tagihan,
    bulan,
    tahun,
    nominal_tagihan,
    nominal_bayar = 0,
  } = payload;

  const sisa_tunggakan = Number(nominal_tagihan) - Number(nominal_bayar);
  let status = "belum";
  if (sisa_tunggakan <= 0) status = "lunas";
  else if (Number(nominal_bayar) > 0) status = "cicil";

  const result = await client.query(
    `INSERT INTO pembayaran (
       santri_id, jenis_tagihan_id, nama_tagihan, bulan, tahun,
       nominal_tagihan, nominal_bayar, sisa_tunggakan, status, tenant_id
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      santri_id,
      jenis_tagihan_id,
      nama_tagihan,
      normalizeBulanToName(bulan) || String(bulan),
      Number(tahun),
      Number(nominal_tagihan),
      Number(nominal_bayar),
      sisa_tunggakan,
      status,
      tenantId,
    ]
  );

  return result.rows[0];
}

router.get("/", async (req, res) => {
  try {
    const paging = parsePagination(req.query, { defaultLimit: 20, maxLimit: 200 });
    const { whereSql, params, nextIndex } = buildPembayaranFilters(
      req.tenantId,
      req.query,
    );
    const scopedKelasIds = await getScopedKelasIds(req);
    const scopedWhereSql = scopedKelasIds
      ? `${whereSql} AND s.kelas_id = ANY($${nextIndex}::int[])`
      : whereSql;
    const scopedParams = scopedKelasIds ? [...params, scopedKelasIds] : params;
    const scopedNextIndex = scopedKelasIds ? nextIndex + 1 : nextIndex;

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM pembayaran p
       LEFT JOIN santri s
         ON p.santri_id = s.id
        AND s.tenant_id = p.tenant_id
       WHERE ${scopedWhereSql}`,
      scopedParams,
    );

    const total = countResult.rows[0]?.total || 0;

    let listSql = `
      SELECT p.*, s.nama, s.nis, s.kamar, lpd.latest_invoice_id
      FROM pembayaran p
      LEFT JOIN santri s
        ON p.santri_id = s.id
       AND s.tenant_id = p.tenant_id
      LEFT JOIN LATERAL (
        SELECT pd.id AS latest_invoice_id
        FROM pembayaran_detail pd
        WHERE pd.pembayaran_id = p.id
          AND pd.tenant_id = p.tenant_id
        ORDER BY pd.tanggal DESC, pd.id DESC
        LIMIT 1
      ) lpd ON true
      WHERE ${scopedWhereSql}
      ORDER BY p.id DESC
    `;

    const listParams = [...scopedParams];

    if (paging.hasPagingParams) {
      listSql += ` LIMIT $${scopedNextIndex} OFFSET $${scopedNextIndex + 1}`;
      listParams.push(paging.limit, paging.offset);
    }

    const result = await pool.query(listSql, listParams);

    res.json({
      success: true,
      data: result.rows,
      pagination: buildPaginationResponse({
        hasPagingParams: paging.hasPagingParams,
        limit: paging.limit,
        offset: paging.offset,
        total,
        rowCount: result.rows.length,
      }),
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/generate-preview", async (req, res) => {
  const client = await pool.connect();

  try {
    const scope = req.query.scope || "all";
    const kelas_id = req.query.kelas_id;
    const santri_ids = String(req.query.santri_ids || "")
      .split(",")
      .map((id) => Number(id))
      .filter(Boolean);

    const scopedKelasIds = await getScopedKelasIds(req, client);
    const targetIds = await resolveGenerateTargetIds(client, req.tenantId, {
      scope,
      kelas_id,
      santri_ids,
      scopedKelasIds,
    });

    res.json({
      success: true,
      total_target: targetIds.length,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

router.post("/generate", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      santri_ids = [],
      scope,
      kelas_id,
      nama_tagihan,
      bulan,
      tahun,
      nominal_tagihan,
    } = req.body;

    const scopedKelasIds = await getScopedKelasIds(req, client);
    const targetIds = await resolveGenerateTargetIds(client, req.tenantId, {
      scope,
      kelas_id,
      santri_ids,
      scopedKelasIds,
    });

    const uniqueIds = [...new Set(targetIds)];
    const total_target = uniqueIds.length;

    if (!total_target) {
      return res.status(400).json({
        success: false,
        error: "Tidak ada santri target untuk generate tagihan",
      });
    }

    if (!nama_tagihan || !String(nama_tagihan).trim()) {
      return res.status(400).json({
        success: false,
        error: "Nama tagihan wajib diisi",
      });
    }

    if (!bulan || !tahun || !nominal_tagihan) {
      return res.status(400).json({
        success: false,
        error: "Bulan, tahun, dan nominal tagihan wajib diisi",
      });
    }

    await client.query("BEGIN");

    const jenisTagihanId = await resolveJenisTagihanId(
      client,
      req.tenantId,
      nama_tagihan
    );

    let created_count = 0;
    let skipped_count = 0;
    let skipped_nonaktif_count = 0;
    const createdRows = [];

    for (const santriId of uniqueIds) {
      const santriRow = await client.query(
        `SELECT id, status
         FROM santri
         WHERE id = $1 AND tenant_id = $2`,
        [santriId, req.tenantId],
      );

      if (santriRow.rows.length === 0) {
        skipped_count += 1;
        continue;
      }

      if (!isSantriAktif(santriRow.rows[0].status)) {
        skipped_nonaktif_count += 1;
        continue;
      }

      const santriCheck = await assertSantriInTenant(req.tenantId, santriId, client);
      if (!santriCheck.ok) {
        skipped_count += 1;
        continue;
      }
      const scopeCheck = await assertSantriInScopedUnit(req, santriId, client);
      if (!scopeCheck.ok) {
        skipped_count += 1;
        continue;
      }

      const existing = await findExistingPembayaran(
        client,
        req.tenantId,
        santriId,
        jenisTagihanId,
        bulan,
        tahun
      );

      if (existing) {
        skipped_count += 1;
        continue;
      }

      const created = await insertPembayaran(client, req.tenantId, {
        santri_id: santriId,
        jenis_tagihan_id: jenisTagihanId,
        nama_tagihan: String(nama_tagihan).trim(),
        bulan: normalizeBulanToName(bulan) || bulan,
        tahun,
        nominal_tagihan,
        nominal_bayar: 0,
      });

      createdRows.push(created);
      created_count += 1;
    }

    await client.query("COMMIT");

    const notificationResults = await Promise.allSettled(
      createdRows.map((row) =>
        notifyTagihanPembayaranDibuat({
          tenantId: req.tenantId,
          santriId: row.santri_id,
          pembayaranId: row.id,
          namaTagihan: row.nama_tagihan,
          bulan: row.bulan,
          tahun: row.tahun,
          nominal: row.nominal_tagihan,
        })
      )
    );
    const notification_count = notificationResults.filter(
      (item) => item.status === "fulfilled" && item.value?.success
    ).length;

    res.json({
      success: true,
      created_count,
      skipped_count,
      skipped_nonaktif_count,
      total_target,
      notification_count,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.log(err);
    res.status(500).json({
      success: false,
      error: err.message || "Gagal generate tagihan",
    });
  } finally {
    client.release();
  }
});

router.post("/", async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      santri_id,
      nama_tagihan,
      bulan,
      tahun,
      nominal_tagihan,
      nominal_bayar,
    } = req.body;

    const santriCheck = await assertSantriInTenant(req.tenantId, santri_id, client);
    if (!santriCheck.ok) {
      return res.status(400).json({ success: false, error: santriCheck.error });
    }
    const scopeCheck = await assertSantriInScopedUnit(req, santri_id, client);
    if (!scopeCheck.ok) return res.status(403).json({ success: false, error: scopeCheck.error });

    await client.query("BEGIN");

    const jenisTagihanId = await resolveJenisTagihanId(
      client,
      req.tenantId,
      nama_tagihan
    );

    const existing = await findExistingPembayaran(
      client,
      req.tenantId,
      santri_id,
      jenisTagihanId,
      bulan,
      tahun
    );

    if (existing) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        error: "Tagihan untuk santri, jenis tagihan, bulan, dan tahun ini sudah ada",
        skipped: true,
      });
    }

    const row = await insertPembayaran(client, req.tenantId, {
      santri_id,
      jenis_tagihan_id: jenisTagihanId,
      nama_tagihan: String(nama_tagihan).trim(),
      bulan,
      tahun,
      nominal_tagihan,
      nominal_bayar,
    });

    await client.query("COMMIT");

    if (Number(nominal_bayar || 0) > 0) {
      try {
        await notifyPembayaranDiterima({
          tenantId: req.tenantId,
          santriId: row.santri_id,
          pembayaranId: row.id,
          invoiceId: null,
          namaTagihan: row.nama_tagihan,
          nominal: nominal_bayar,
        });
      } catch (notifErr) {
        console.log("PEMBAYARAN CREATE IN-APP NOTIFICATION ERROR:", notifErr.message);
      }
    }

    res.json({ success: true, data: row, created_count: 1, skipped_count: 0, total_target: 1 });
  } catch (err) {
    await client.query("ROLLBACK");
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    client.release();
  }
});

router.put("/bayar/:id", async (req, res) => {
  try {
    const { nominal, petugas } = req.body;

    const pembayaran = await pool.query(
      `SELECT pembayaran.*, santri.nama, santri.kamar
       FROM pembayaran
       LEFT JOIN santri
         ON pembayaran.santri_id = santri.id
        AND santri.tenant_id = pembayaran.tenant_id
       WHERE pembayaran.id = $1 AND pembayaran.tenant_id = $2`,
      [req.params.id, req.tenantId]
    );

    if (pembayaran.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Pembayaran tidak ditemukan" });
    }

    const data = pembayaran.rows[0];

    if (isStatusLunas(data.status)) {
      return res.status(409).json({
        success: false,
        error: "Tagihan sudah lunas dan tidak dapat dibayar lagi",
      });
    }

    const totalBayarBaru = Number(data.nominal_bayar || 0) + Number(nominal);
    const sisaBaru = Number(data.nominal_tagihan) - totalBayarBaru;

    let status = "belum";
    if (totalBayarBaru > 0 && sisaBaru > 0) status = "cicil";
    if (sisaBaru <= 0) status = "lunas";

    await pool.query(
      `UPDATE pembayaran
       SET nominal_bayar = $1,
           sisa_tunggakan = $2,
           sisa_tagihan = $3,
           status = $4,
           tanggal_bayar = CASE
             WHEN $4::varchar = 'lunas' THEN CURRENT_DATE
             ELSE tanggal_bayar
           END
       WHERE id = $5 AND tenant_id = $6`,
      [
        totalBayarBaru,
        Math.max(0, sisaBaru),
        Math.max(0, sisaBaru),
        status,
        req.params.id,
        req.tenantId,
      ]
    );

    const detailResult = await pool.query(
      `INSERT INTO pembayaran_detail (pembayaran_id, nominal, petugas, tenant_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [req.params.id, nominal, petugas, req.tenantId]
    );
    const invoiceId = detailResult.rows[0]?.id;

    try {
      await notifyPembayaranDiterima({
        tenantId: req.tenantId,
        santriId: data.santri_id,
        pembayaranId: data.id,
        invoiceId,
        namaTagihan: data.nama_tagihan,
        nominal,
      });
    } catch (notifErr) {
      console.log("PEMBAYARAN BAYAR IN-APP NOTIFICATION ERROR:", notifErr.message);
    }

    res.json({ success: true, invoice_id: invoiceId });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.delete("/:id", requirePermission("pembayaran.manage"), async (req, res) => {
  try {
    const owned = await assertPembayaranInTenant(req.tenantId, req.params.id);
    if (!owned.ok) {
      return res.status(404).json({ success: false, error: owned.error });
    }

    const pembayaran = await pool.query(
      `SELECT id, nominal_bayar
       FROM pembayaran
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );

    const detail = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM pembayaran_detail
       WHERE pembayaran_id = $1 AND tenant_id = $2`,
      [req.params.id, req.tenantId]
    );

    const hasPayments =
      Number(pembayaran.rows[0]?.nominal_bayar || 0) > 0 ||
      Number(detail.rows[0]?.total || 0) > 0;

    if (hasPayments) {
      return res.status(409).json({
        success: false,
        error: "Tagihan ini sudah memiliki riwayat pembayaran dan tidak bisa dihapus.",
      });
    }

    const result = await pool.query(
      `DELETE FROM pembayaran
       WHERE id = $1 AND tenant_id = $2
       RETURNING id`,
      [req.params.id, req.tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Pembayaran tidak ditemukan" });
    }

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get("/riwayat/:id", async (req, res) => {
  try {
    const owned = await assertPembayaranInTenant(req.tenantId, req.params.id);
    if (!owned.ok) {
      return res.status(404).json({ success: false, error: owned.error });
    }

    const result = await pool.query(
      `SELECT *
       FROM pembayaran_detail
       WHERE pembayaran_id = $1 AND tenant_id = $2
       ORDER BY id DESC`,
      [req.params.id, req.tenantId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
