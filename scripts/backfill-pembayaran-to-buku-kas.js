process.env.NODE_ENV = process.env.NODE_ENV || "production";

const pool = require("../db");

function asNumber(value) {
  return Number(value || 0);
}

function buildSettlementKey(detailId) {
  return `pembayaran_detail:${detailId}`;
}

function buildKeterangan(row) {
  const periode = [row.bulan, row.tahun].filter(Boolean).join(" ");
  return [
    `Pembayaran ${row.nama_tagihan || "tagihan"}`,
    periode || null,
    `ref pembayaran #${row.pembayaran_id}/detail #${row.detail_id}`,
  ].filter(Boolean).join(" - ");
}

async function loadCandidates(client, tenantId) {
  const { rows } = await client.query(
    `SELECT pd.id AS detail_id,
            pd.pembayaran_id,
            pd.nominal,
            pd.tanggal,
            pd.unit_id AS detail_unit_id,
            pd.petugas,
            pd.actor_user_id,
            pd.settlement_buku_kas_id,
            pd.settlement_idempotency_key,
            p.unit_id AS payment_unit_id,
            p.nama_tagihan,
            p.bulan,
            p.tahun,
            p.status,
            p.settlement_buku_kas_id AS payment_cash_id,
            existing.id AS existing_cash_id
     FROM pembayaran_detail pd
     JOIN pembayaran p
       ON p.tenant_id = pd.tenant_id
      AND p.id = pd.pembayaran_id
     LEFT JOIN LATERAL (
       SELECT id
       FROM buku_kas bk
       WHERE bk.tenant_id = pd.tenant_id
         AND bk.idempotency_key = COALESCE(pd.settlement_idempotency_key, $2 || pd.id::text)
       LIMIT 1
     ) existing ON TRUE
     WHERE pd.tenant_id = $1
       AND COALESCE(pd.nominal, 0) > 0
     ORDER BY pd.id`,
    [tenantId, "pembayaran_detail:"],
  );
  return rows;
}

function classifyRows(rows) {
  const candidate = [];
  const duplicate = [];
  const review = [];

  for (const row of rows) {
    if (Number(row.detail_unit_id) !== Number(row.payment_unit_id)) {
      review.push({ ...row, reason: "UNIT_MISMATCH" });
      continue;
    }
    if (!row.payment_unit_id) {
      review.push({ ...row, reason: "UNIT_MISSING" });
      continue;
    }
    if (row.settlement_buku_kas_id || row.payment_cash_id || row.existing_cash_id) {
      duplicate.push(row);
      continue;
    }
    candidate.push(row);
  }

  return { candidate, duplicate, review };
}

function summarize(rows) {
  const total = rows.reduce((sum, row) => sum + asNumber(row.nominal), 0);
  const byUnit = new Map();
  for (const row of rows) {
    const unitId = Number(row.payment_unit_id || row.detail_unit_id || 0);
    const current = byUnit.get(unitId) || { unit_id: unitId, count: 0, total: 0 };
    current.count += 1;
    current.total += asNumber(row.nominal);
    byUnit.set(unitId, current);
  }
  return {
    count: rows.length,
    total,
    by_unit: [...byUnit.values()].sort((a, b) => a.unit_id - b.unit_id),
  };
}

async function insertBackfill(client, tenantId, row) {
  const key = row.settlement_idempotency_key || buildSettlementKey(row.detail_id);
  const { rows } = await client.query(
    `INSERT INTO buku_kas (
       tanggal, jenis, kategori, keterangan, nominal, petugas,
       tenant_id, unit_id, actor_user_id, source, idempotency_key
     )
     VALUES ($1, 'Masuk', 'Pembayaran', $2, $3, $4, $5, $6, $7, 'pembayaran', $8)
     ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO UPDATE
       SET idempotency_key = EXCLUDED.idempotency_key
     RETURNING id, unit_id, nominal`,
    [
      row.tanggal,
      buildKeterangan(row),
      asNumber(row.nominal),
      row.petugas || "Backfill Pembayaran",
      tenantId,
      Number(row.payment_unit_id),
      row.actor_user_id || null,
      key,
    ],
  );
  const cash = rows[0];
  await client.query(
    `UPDATE pembayaran_detail
     SET settlement_buku_kas_id = $1,
         settlement_idempotency_key = COALESCE(settlement_idempotency_key, $2)
     WHERE tenant_id = $3 AND id = $4`,
    [cash.id, key, tenantId, row.detail_id],
  );
  await client.query(
    `UPDATE pembayaran
     SET settlement_buku_kas_id = COALESCE(settlement_buku_kas_id, $1),
         settlement_idempotency_key = COALESCE(settlement_idempotency_key, $2)
     WHERE tenant_id = $3 AND id = $4`,
    [cash.id, key, tenantId, row.pembayaran_id],
  );
  return cash;
}

async function main() {
  const tenantId = Number(process.env.BACKFILL_TENANT_ID || 1);
  const dryRun = process.argv.includes("--dry-run");
  const client = await pool.connect();
  try {
    const rows = await loadCandidates(client, tenantId);
    const classified = classifyRows(rows);
    const result = {
      dry_run: dryRun,
      candidate: summarize(classified.candidate),
      skipped_duplicate: summarize(classified.duplicate),
      review_required: summarize(classified.review),
      posted: { count: 0, total: 0, by_unit: [] },
      posted_rows: [],
    };

    if (!dryRun && classified.candidate.length) {
      await client.query("BEGIN");
      const posted = [];
      for (const row of classified.candidate) {
        const cash = await insertBackfill(client, tenantId, row);
        posted.push({ ...row, cash_id: cash.id, cash_unit_id: cash.unit_id, cash_nominal: cash.nominal });
      }
      await client.query("COMMIT");
      result.posted = summarize(posted);
      result.posted_rows = posted.map((row) => ({
        detail_id: row.detail_id,
        pembayaran_id: row.pembayaran_id,
        cash_id: row.cash_id,
        unit_id: Number(row.cash_unit_id),
        nominal: asNumber(row.cash_nominal),
      }));
    }

    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
