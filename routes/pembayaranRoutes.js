const express = require("express");
const crypto = require("node:crypto");
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
const { accessError, resolveActiveUnit } = require("../services/unitAccessService");

function sendUnitError(res, error, fallback = "Gagal memproses pembayaran") {
  res.status(error.status || 500).json({
    success: false,
    error: error.status ? error.message : fallback,
    code: error.code,
  });
}

function requireUnitScope(access) {
  if (access.mode !== "UNIT") {
    throw accessError("Pilih unit aktif", 400, "UNIT_REQUIRED");
  }
}

async function getSantriUnitInActiveUnit(client, tenantId, santriId, unitId) {
  const { rows } = await client.query(
    `SELECT su.id AS santri_unit_id, su.unit_id
     FROM santri_units su
     WHERE su.tenant_id = $1
       AND su.santri_id = $2
       AND su.unit_id = $3
       AND su.status = 'active'
       AND su.left_at IS NULL
     LIMIT 1`,
    [tenantId, santriId, unitId],
  );
  return rows[0] || null;
}

async function resolveGenerateTargetIds(client, tenantId, unitId, { scope, kelas_id, santri_ids, scopedKelasIds }) {
  const baseSql = `
    FROM santri_units su
    JOIN santri s ON s.id = su.santri_id AND s.tenant_id = su.tenant_id
    LEFT JOIN LATERAL (
      SELECT ske.kelas_id
      FROM santri_kelas_enrollments ske
      WHERE ske.tenant_id = su.tenant_id AND ske.santri_unit_id = su.id
        AND ske.status = 'active' AND ske.end_date IS NULL
      ORDER BY ske.id DESC LIMIT 1
    ) e ON TRUE
    WHERE su.tenant_id = $1 AND su.unit_id = $2
      AND su.status = 'active' AND su.left_at IS NULL
      AND ${SQL_SANTri_AKTIF}`;
  if (scope === "selected" || (!scope && Array.isArray(santri_ids) && santri_ids.length)) {
    const ids = [...new Set((santri_ids || []).map((id) => Number(id)).filter(Boolean))];
    if (ids.length === 0) return [];

    const result = await client.query(
      `SELECT s.id ${baseSql}
         AND s.id = ANY($3::int[])
         AND ($4::int[] IS NULL OR e.kelas_id = ANY($4::int[]))
       ORDER BY s.id`,
      [tenantId, unitId, ids, scopedKelasIds],
    );
    return result.rows.map((row) => row.id);
  }

  if (scope === "kelas" && kelas_id) {
    const result = await client.query(
      `SELECT s.id ${baseSql}
         AND e.kelas_id = $3
         AND ($4::int[] IS NULL OR e.kelas_id = ANY($4::int[]))
       ORDER BY s.id`,
      [tenantId, unitId, Number(kelas_id), scopedKelasIds],
    );
    return result.rows.map((row) => row.id);
  }

  const result = await client.query(
    `SELECT s.id ${baseSql}
       AND ($3::int[] IS NULL OR e.kelas_id = ANY($3::int[]))
     ORDER BY s.id`,
    [tenantId, unitId, scopedKelasIds],
  );
  return result.rows.map((row) => row.id);
}

function buildPembayaranFilters(tenantId, query, access) {
  const conditions = ["p.tenant_id = $1"];
  const params = [tenantId];
  let index = 2;

  if (access?.mode === "UNIT") {
    conditions.push(`p.unit_id = $${index}`);
    params.push(access.unitId);
    index += 1;
  }

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

function buildPaymentSettlementKey(pembayaranId, requestKey = null) {
  const explicit = String(requestKey || "").trim();
  return explicit
    ? `pembayaran:${pembayaranId}:${explicit}`
    : `pembayaran:${pembayaranId}:${crypto.randomUUID()}`;
}

async function findPaymentDetailBySettlementKey(client, tenantId, settlementKey) {
  if (!settlementKey) return null;
  const { rows } = await client.query(
    `SELECT id, pembayaran_id, nominal, unit_id, settlement_buku_kas_id
     FROM pembayaran_detail
     WHERE tenant_id = $1 AND settlement_idempotency_key = $2
     LIMIT 1`,
    [tenantId, settlementKey],
  );
  return rows[0] || null;
}

async function postPembayaranToBukuKas(client, { tenantId, pembayaran, detail, actorUserId, petugas }) {
  const settlementKey = detail.settlement_idempotency_key;
  const { rows } = await client.query(
    `INSERT INTO buku_kas (
       tanggal, jenis, kategori, keterangan, nominal, petugas,
       actor_user_id, tenant_id, unit_id, source, idempotency_key
     )
     VALUES (
       COALESCE($1::date, CURRENT_DATE), 'Masuk', 'Pembayaran',
       $2, $3, $4, $5, $6, $7, 'pembayaran', $8
     )
     ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE
       SET idempotency_key = EXCLUDED.idempotency_key
     RETURNING id, unit_id, nominal`,
    [
      detail.tanggal || null,
      `Pembayaran ${pembayaran.nama_tagihan || "tagihan"} #${pembayaran.id}`,
      Number(detail.nominal),
      petugas || null,
      actorUserId || null,
      tenantId,
      Number(pembayaran.unit_id),
      settlementKey,
    ],
  );
  const cash = rows[0];
  await client.query(
    `UPDATE pembayaran_detail
     SET settlement_buku_kas_id = $1
     WHERE tenant_id = $2 AND id = $3`,
    [cash.id, tenantId, detail.id],
  );
  await client.query(
    `UPDATE pembayaran
     SET settlement_buku_kas_id = COALESCE(settlement_buku_kas_id, $1),
         settlement_idempotency_key = COALESCE(settlement_idempotency_key, $2)
     WHERE tenant_id = $3 AND id = $4`,
    [cash.id, settlementKey, tenantId, pembayaran.id],
  );
  return cash;
}

async function createPembayaranDetailWithCash(client, {
  tenantId,
  pembayaran,
  nominal,
  petugas,
  actorUserId,
  settlementKey,
}) {
  const detailResult = await client.query(
    `INSERT INTO pembayaran_detail (
       pembayaran_id, nominal, petugas, tenant_id, unit_id, santri_unit_id,
       settlement_destination, settlement_idempotency_key, actor_user_id, source
     )
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'unit_cash'), $8, $9, 'manual')
     RETURNING *`,
    [
      pembayaran.id,
      nominal,
      petugas,
      tenantId,
      pembayaran.unit_id,
      pembayaran.santri_unit_id,
      pembayaran.settlement_destination,
      settlementKey,
      actorUserId || null,
    ],
  );
  const detail = detailResult.rows[0];
  const cash = await postPembayaranToBukuKas(client, {
    tenantId,
    pembayaran,
    detail,
    actorUserId,
    petugas,
  });
  return { detail, cash };
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

async function findExistingPembayaran(client, tenantId, santriId, unitId, jenisTagihanId, bulan, tahun) {
  const result = await client.query(
    `SELECT id
     FROM pembayaran
     WHERE tenant_id = $1
       AND santri_id = $2
       AND unit_id = $3
       AND jenis_tagihan_id = $4
       AND bulan = $5
       AND tahun = $6
     LIMIT 1`,
    [tenantId, santriId, unitId, jenisTagihanId, String(bulan), Number(tahun)]
  );

  return result.rows[0] || null;
}

async function insertPembayaran(client, tenantId, payload) {
  const {
    santri_id,
    unit_id,
    santri_unit_id,
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
       santri_id, unit_id, santri_unit_id, jenis_tagihan_id, nama_tagihan, bulan, tahun,
       nominal_tagihan, nominal_bayar, sisa_tunggakan, sisa_tagihan, status,
       tenant_id, settlement_destination, actor_user_id, source
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $11, $12, 'unit_cash', $13, 'manual')
     RETURNING *`,
    [
      santri_id,
      unit_id,
      santri_unit_id,
      jenis_tagihan_id,
      nama_tagihan,
      normalizeBulanToName(bulan) || String(bulan),
      Number(tahun),
      Number(nominal_tagihan),
      Number(nominal_bayar),
      sisa_tunggakan,
      status,
      tenantId,
      payload.actor_user_id || null,
    ]
  );

  return result.rows[0];
}

router.get("/", async (req, res) => {
  try {
    const access = await resolveActiveUnit(req);
    const paging = parsePagination(req.query, { defaultLimit: 20, maxLimit: 200 });
    const { whereSql, params, nextIndex } = buildPembayaranFilters(
      req.tenantId,
      req.query,
      access,
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

    const summaryResult = await pool.query(
      `SELECT
         COALESCE(SUM(p.nominal_tagihan), 0)::bigint AS nominal_tagihan,
         COALESCE(SUM(p.nominal_bayar), 0)::bigint AS sudah_dibayar,
         (COALESCE(SUM(p.nominal_tagihan), 0) - COALESCE(SUM(p.nominal_bayar), 0))::bigint AS sisa_belum_dibayar
       FROM pembayaran p
       LEFT JOIN santri s
         ON p.santri_id = s.id
        AND s.tenant_id = p.tenant_id
       WHERE ${scopedWhereSql}`,
      scopedParams,
    );

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
      summary: {
        nominal_tagihan: Number(summaryResult.rows[0]?.nominal_tagihan || 0),
        sudah_dibayar: Number(summaryResult.rows[0]?.sudah_dibayar || 0),
        sisa_belum_dibayar: Number(summaryResult.rows[0]?.sisa_belum_dibayar || 0),
      },
      access: { all_units: access.mode === "ALL", unit_id: access.mode === "UNIT" ? access.unitId : null },
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
    sendUnitError(res, err);
  }
});

router.get("/generate-preview", async (req, res) => {
  const client = await pool.connect();

  try {
    const access = await resolveActiveUnit(req, client);
    requireUnitScope(access);
    const scope = req.query.scope || "all";
    const kelas_id = req.query.kelas_id;
    const santri_ids = String(req.query.santri_ids || "")
      .split(",")
      .map((id) => Number(id))
      .filter(Boolean);

    const scopedKelasIds = await getScopedKelasIds(req, client);
    const targetIds = await resolveGenerateTargetIds(client, req.tenantId, access.unitId, {
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
    sendUnitError(res, err);
  } finally {
    client.release();
  }
});

router.post("/generate", async (req, res) => {
  const client = await pool.connect();

  try {
    const access = await resolveActiveUnit(req, client);
    requireUnitScope(access);
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
    const targetIds = await resolveGenerateTargetIds(client, req.tenantId, access.unitId, {
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
      const membership = await getSantriUnitInActiveUnit(client, req.tenantId, santriId, access.unitId);
      if (!membership) {
        skipped_count += 1;
        continue;
      }

      const existing = await findExistingPembayaran(
        client,
        req.tenantId,
        santriId,
        access.unitId,
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
        unit_id: access.unitId,
        santri_unit_id: membership.santri_unit_id,
        jenis_tagihan_id: jenisTagihanId,
        nama_tagihan: String(nama_tagihan).trim(),
        bulan: normalizeBulanToName(bulan) || bulan,
        tahun,
        nominal_tagihan,
        nominal_bayar: 0,
        actor_user_id: req.user?.id,
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
    sendUnitError(res, err, err.message || "Gagal generate tagihan");
  } finally {
    client.release();
  }
});

router.post("/", async (req, res) => {
  const client = await pool.connect();

  try {
    const access = await resolveActiveUnit(req, client);
    requireUnitScope(access);
    const {
      santri_id,
      nama_tagihan,
      bulan,
      tahun,
      nominal_tagihan,
      nominal_bayar,
      idempotency_key,
    } = req.body;

    const santriCheck = await assertSantriInTenant(req.tenantId, santri_id, client);
    if (!santriCheck.ok) {
      return res.status(400).json({ success: false, error: santriCheck.error });
    }
    const scopeCheck = await assertSantriInScopedUnit(req, santri_id, client);
    if (!scopeCheck.ok) return res.status(403).json({ success: false, error: scopeCheck.error });
    const membership = await getSantriUnitInActiveUnit(client, req.tenantId, santri_id, access.unitId);
    if (!membership) return res.status(403).json({ success: false, error: "Santri berada di luar unit aktif", code: "UNIT_ACCESS_DENIED" });

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
      access.unitId,
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
      unit_id: access.unitId,
      santri_unit_id: membership.santri_unit_id,
      jenis_tagihan_id: jenisTagihanId,
      nama_tagihan: String(nama_tagihan).trim(),
      bulan,
      tahun,
      nominal_tagihan,
      nominal_bayar,
      actor_user_id: req.user?.id,
    });

    let invoiceId = null;
    if (Number(nominal_bayar || 0) > 0) {
      const settlementKey = buildPaymentSettlementKey(row.id, idempotency_key || `create:${row.id}`);
      const { detail } = await createPembayaranDetailWithCash(client, {
        tenantId: req.tenantId,
        pembayaran: row,
        nominal: Number(nominal_bayar),
        petugas: req.user?.nama || req.user?.username || null,
        actorUserId: req.user?.id,
        settlementKey,
      });
      invoiceId = detail.id;
    }

    await client.query("COMMIT");

    if (Number(nominal_bayar || 0) > 0) {
      try {
        await notifyPembayaranDiterima({
          tenantId: req.tenantId,
          santriId: row.santri_id,
          pembayaranId: row.id,
          invoiceId,
          namaTagihan: row.nama_tagihan,
          nominal: nominal_bayar,
        });
      } catch (notifErr) {
        console.log("PEMBAYARAN CREATE IN-APP NOTIFICATION ERROR:", notifErr.message);
      }
    }

    res.json({ success: true, data: row, invoice_id: invoiceId, created_count: 1, skipped_count: 0, total_target: 1 });
  } catch (err) {
    await client.query("ROLLBACK");
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal membuat tagihan");
  } finally {
    client.release();
  }
});

router.put("/bayar/:id", async (req, res) => {
  const client = await pool.connect();
  try {
    const access = await resolveActiveUnit(req, client);
    requireUnitScope(access);
    const { nominal, petugas, idempotency_key } = req.body;
    const paymentAmount = Number(nominal);
    if (!Number.isSafeInteger(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({ success: false, error: "Nominal pembayaran wajib lebih dari 0", code: "INVALID_NOMINAL" });
    }
    const settlementKey = buildPaymentSettlementKey(req.params.id, idempotency_key);
    const existingDetail = idempotency_key
      ? await findPaymentDetailBySettlementKey(client, req.tenantId, settlementKey)
      : null;
    if (existingDetail) {
      return res.json({
        success: true,
        invoice_id: existingDetail.id,
        idempotent: true,
      });
    }

    await client.query("BEGIN");

    const pembayaran = await client.query(
      `SELECT pembayaran.*, santri.nama, santri.kamar
       FROM pembayaran
       LEFT JOIN santri
         ON pembayaran.santri_id = santri.id
        AND santri.tenant_id = pembayaran.tenant_id
       WHERE pembayaran.id = $1 AND pembayaran.tenant_id = $2
       FOR UPDATE OF pembayaran`,
      [req.params.id, req.tenantId]
    );

    if (pembayaran.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Pembayaran tidak ditemukan" });
    }

    const data = pembayaran.rows[0];
    if (Number(data.unit_id) !== Number(access.unitId)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ success: false, error: "Akses unit ditolak", code: "UNIT_ACCESS_DENIED" });
    }

    if (isStatusLunas(data.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        error: "Tagihan sudah lunas dan tidak dapat dibayar lagi",
      });
    }

    const totalBayarBaru = Number(data.nominal_bayar || 0) + paymentAmount;
    const sisaBaru = Number(data.nominal_tagihan) - totalBayarBaru;

    let status = "belum";
    if (totalBayarBaru > 0 && sisaBaru > 0) status = "cicil";
    if (sisaBaru <= 0) status = "lunas";

    await client.query(
      `UPDATE pembayaran
       SET nominal_bayar = $1,
           sisa_tunggakan = $2,
           sisa_tagihan = $3,
           status = $4,
           tanggal_bayar = CASE
             WHEN $4::varchar = 'lunas' THEN CURRENT_DATE
             ELSE tanggal_bayar
           END
       WHERE id = $5 AND tenant_id = $6 AND unit_id = $7`,
      [
        totalBayarBaru,
        Math.max(0, sisaBaru),
        Math.max(0, sisaBaru),
        status,
        req.params.id,
        req.tenantId,
        access.unitId,
      ]
    );

    const { detail, cash } = await createPembayaranDetailWithCash(client, {
      tenantId: req.tenantId,
      pembayaran: data,
      nominal: paymentAmount,
      petugas,
      actorUserId: req.user?.id,
      settlementKey,
    });
    const invoiceId = detail.id;

    await client.query("COMMIT");

    try {
      await notifyPembayaranDiterima({
        tenantId: req.tenantId,
        santriId: data.santri_id,
        pembayaranId: data.id,
        invoiceId,
        namaTagihan: data.nama_tagihan,
        nominal: paymentAmount,
      });
    } catch (notifErr) {
      console.log("PEMBAYARAN BAYAR IN-APP NOTIFICATION ERROR:", notifErr.message);
    }

    res.json({ success: true, invoice_id: invoiceId, buku_kas_id: cash.id });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch {}
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal menyimpan pembayaran");
  } finally {
    client.release();
  }
});

router.delete("/:id", requirePermission("pembayaran.manage"), async (req, res) => {
  try {
    const access = await resolveActiveUnit(req);
    requireUnitScope(access);
    const owned = await assertPembayaranInTenant(req.tenantId, req.params.id);
    if (!owned.ok) {
      return res.status(404).json({ success: false, error: owned.error });
    }

    const pembayaran = await pool.query(
      `SELECT id, nominal_bayar
       FROM pembayaran
       WHERE id = $1 AND tenant_id = $2 AND unit_id = $3`,
      [req.params.id, req.tenantId, access.unitId]
    );
    if (pembayaran.rows.length === 0) {
      return res.status(403).json({ success: false, error: "Akses unit ditolak", code: "UNIT_ACCESS_DENIED" });
    }

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
       WHERE id = $1 AND tenant_id = $2 AND unit_id = $3
       RETURNING id`,
      [req.params.id, req.tenantId, access.unitId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Pembayaran tidak ditemukan" });
    }

    res.json({ success: true });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal menghapus pembayaran");
  }
});

router.get("/riwayat/:id", async (req, res) => {
  try {
    const access = await resolveActiveUnit(req);
    requireUnitScope(access);
    const owned = await assertPembayaranInTenant(req.tenantId, req.params.id);
    if (!owned.ok) {
      return res.status(404).json({ success: false, error: owned.error });
    }

    const result = await pool.query(
      `SELECT pd.*
       FROM pembayaran_detail pd
       JOIN pembayaran p
         ON p.id = pd.pembayaran_id
        AND p.tenant_id = pd.tenant_id
       WHERE pd.pembayaran_id = $1
         AND pd.tenant_id = $2
         AND p.unit_id = $3
       ORDER BY id DESC`,
      [req.params.id, req.tenantId, access.unitId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.log(err);
    sendUnitError(res, err, err.message || "Gagal memuat riwayat pembayaran");
  }
});

module.exports = router;
