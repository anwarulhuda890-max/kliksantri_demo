const crypto = require("node:crypto");
const pool = require("../db");
const { resolveActiveUnit, assertUnitAccess, accessError } = require("./unitAccessService");

const VALID_JENIS = new Set(["Masuk", "Keluar"]);
const VALID_TRANSFER_DIRECTIONS = new Set(["unit_to_foundation", "foundation_to_unit"]);

function parsePositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function normalizeNominal(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) {
    const error = new Error("Nominal harus berupa rupiah bulat dan lebih dari 0");
    error.status = 400;
    error.code = "INVALID_NOMINAL";
    throw error;
  }
  return n;
}

function normalizeJenis(value) {
  const jenis = String(value || "").trim();
  if (!VALID_JENIS.has(jenis)) {
    const error = new Error("Jenis harus Masuk atau Keluar");
    error.status = 400;
    error.code = "INVALID_JENIS";
    throw error;
  }
  return jenis;
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

function handleServiceError(res, err, fallback = "Operasi keuangan gagal") {
  const status = Number(err?.status || 500);
  if (status >= 500) console.error(err);
  res.status(status).json({
    success: false,
    error: err?.message || fallback,
    code: err?.code || (status >= 500 ? "FINANCE_ERROR" : "FINANCE_ACCESS_DENIED"),
  });
}

function buildPeriod(query = {}) {
  return {
    bulan: parsePositiveInt(query.bulan, new Date().getMonth() + 1),
    tahun: parsePositiveInt(query.tahun, new Date().getFullYear()),
  };
}

function cashDeltaSql(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return `CASE WHEN ${prefix}jenis = 'Masuk' THEN ${prefix}nominal ELSE -${prefix}nominal END`;
}

async function getUnitCashRunningBalance(client, { tenantId, unitId, asOf = null }) {
  const normalizedTenantId = Number(tenantId);
  const normalizedUnitId = Number(unitId);
  if (!Number.isInteger(normalizedTenantId) || normalizedTenantId <= 0
      || !Number.isInteger(normalizedUnitId) || normalizedUnitId <= 0) {
    throw accessError("Tenant atau unit Buku Kas tidak valid", 400, "INVALID_UNIT");
  }
  const { rows } = await client.query(
    `/* canonical_unit_cash_running_balance */
     SELECT
       COALESCE(SUM(nominal) FILTER (WHERE jenis = 'Masuk'), 0)::bigint AS pemasukan,
       COALESCE(SUM(nominal) FILTER (WHERE jenis = 'Keluar'), 0)::bigint AS pengeluaran,
       COALESCE(SUM(${cashDeltaSql()}), 0)::bigint AS saldo
     FROM buku_kas
     WHERE tenant_id = $1
       AND unit_id = $2
       AND tanggal < (COALESCE($3::date, CURRENT_DATE) + INTERVAL '1 day')`,
    [normalizedTenantId, normalizedUnitId, asOf],
  );
  return {
    pemasukan: Number(rows[0]?.pemasukan || 0),
    pengeluaran: Number(rows[0]?.pengeluaran || 0),
    saldo: Number(rows[0]?.saldo || 0),
  };
}

async function listBukuKas(req, client = pool) {
  const access = await resolveActiveUnit(req, client);
  const { bulan, tahun } = buildPeriod(req.query);
  const search = String(req.query.q || req.query.search || "").trim();

  const params = [access.tenantId, bulan, tahun];
  let where = `bk.tenant_id = $1 AND EXTRACT(MONTH FROM bk.tanggal) = $2 AND EXTRACT(YEAR FROM bk.tanggal) = $3`;
  if (access.mode === "UNIT") {
    params.push(access.unitId);
    where += ` AND bk.unit_id = $${params.length}`;
  }
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    where += ` AND (
      LOWER(COALESCE(bk.kategori, '')) LIKE $${params.length}
      OR LOWER(COALESCE(bk.keterangan, '')) LIKE $${params.length}
      OR LOWER(COALESCE(bk.petugas, '')) LIKE $${params.length}
      OR LOWER(COALESCE(u.nama, '')) LIKE $${params.length}
      OR LOWER(COALESCE(u.kode, '')) LIKE $${params.length}
    )`;
  }

  const { rows } = await client.query(
    `SELECT bk.*, u.nama AS unit_nama, u.kode AS unit_kode
     FROM buku_kas bk
     JOIN unit_pendidikan u
       ON u.id = bk.unit_id
      AND u.tenant_id = bk.tenant_id
     WHERE ${where}
     ORDER BY bk.tanggal DESC, bk.id DESC`,
    params,
  );

  const { rows: summaryRows } = await client.query(
    `SELECT
       COALESCE(SUM(nominal) FILTER (WHERE jenis = 'Masuk'), 0)::bigint AS pemasukan,
       COALESCE(SUM(nominal) FILTER (WHERE jenis = 'Keluar'), 0)::bigint AS pengeluaran,
       COALESCE(SUM(${cashDeltaSql()}), 0)::bigint AS saldo
     FROM buku_kas bk
     JOIN unit_pendidikan u ON u.id = bk.unit_id AND u.tenant_id = bk.tenant_id
     WHERE ${where}`,
    params,
  );
  const periodSummary = summaryRows[0] || {};
  const runningSummary = access.mode === "UNIT"
    ? await getUnitCashRunningBalance(client, {
      tenantId: access.tenantId,
      unitId: access.unitId,
    })
    : null;

  return {
    meta: {
      scope: access.mode === "UNIT" ? "unit" : "all",
      unit_id: access.mode === "UNIT" ? access.unitId : null,
      unit_name: access.unit?.nama || null,
      read_only: access.mode !== "UNIT",
      periode: { bulan, tahun },
    },
    summary: {
      pemasukan: Number(periodSummary.pemasukan || 0),
      pengeluaran: Number(periodSummary.pengeluaran || 0),
      saldo_periode: Number(periodSummary.saldo || 0),
      saldo: runningSummary?.saldo ?? Number(periodSummary.saldo || 0),
      saldo_berjalan: runningSummary?.saldo ?? Number(periodSummary.saldo || 0),
      jumlah_transaksi: rows.length,
    },
    data: rows,
  };
}

async function writeBukuKas(req, { id = null } = {}, client = pool) {
  const access = await resolveActiveUnit(req, client);
  if (access.mode !== "UNIT") {
    throw accessError("Pilih unit terlebih dahulu untuk melakukan transaksi/perubahan data.", 400, "UNIT_REQUIRED");
  }
  const body = req.body || {};
  const tanggal = body.tanggal || todayDate();
  const jenis = normalizeJenis(body.jenis);
  const kategori = String(body.kategori || "").trim();
  if (!kategori) {
    const error = new Error("Kategori wajib diisi");
    error.status = 400;
    error.code = "KATEGORI_REQUIRED";
    throw error;
  }
  const nominal = normalizeNominal(body.nominal);
  const params = [
    tanggal,
    jenis,
    kategori,
    body.keterangan || null,
    nominal,
    body.petugas || req.user?.nama || req.user?.username || null,
    req.user?.id || null,
    access.tenantId,
    access.unitId,
  ];

  if (id) {
    params.push(id);
    const { rows } = await client.query(
      `UPDATE buku_kas
       SET tanggal = $1, jenis = $2, kategori = $3, keterangan = $4,
           nominal = $5, petugas = $6, actor_user_id = $7
       WHERE tenant_id = $8 AND unit_id = $9 AND id = $10
       RETURNING *`,
      params,
    );
    if (!rows.length) throw accessError("Transaksi tidak ditemukan", 404, "BUKU_KAS_NOT_FOUND");
    return rows[0];
  }

  const { rows } = await client.query(
    `INSERT INTO buku_kas (
       tanggal, jenis, kategori, keterangan, nominal, petugas,
       actor_user_id, tenant_id, unit_id, source
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual')
     RETURNING *`,
    params,
  );
  return rows[0];
}

async function deleteBukuKas(req, id, client = pool) {
  const access = await resolveActiveUnit(req, client);
  if (access.mode !== "UNIT") {
    throw accessError("Pilih unit terlebih dahulu untuk melakukan transaksi/perubahan data.", 400, "UNIT_REQUIRED");
  }
  const { rows } = await client.query(
    `DELETE FROM buku_kas
     WHERE id = $1 AND tenant_id = $2 AND unit_id = $3
       AND transfer_id IS NULL
     RETURNING id`,
    [id, access.tenantId, access.unitId],
  );
  if (!rows.length) throw accessError("Transaksi tidak ditemukan atau berasal dari transfer", 404, "BUKU_KAS_NOT_FOUND");
  return rows[0];
}

async function getFoundationAccount(tenantId, client = pool) {
  const { rows } = await client.query(
    `SELECT * FROM cash_accounts
     WHERE tenant_id = $1 AND account_type = 'foundation' AND status = 'active'
     LIMIT 1`,
    [tenantId],
  );
  if (!rows.length) throw accessError("Kas Yayasan belum tersedia", 409, "FOUNDATION_CASH_MISSING");
  return rows[0];
}

async function listFoundationCash(req, client = pool) {
  const tenantId = Number(req.tenantId);
  const account = await getFoundationAccount(tenantId, client);
  const { bulan, tahun } = buildPeriod(req.query);
  const { rows } = await client.query(
    `SELECT *
     FROM cash_account_transactions
     WHERE tenant_id = $1
       AND cash_account_id = $2
       AND EXTRACT(MONTH FROM tanggal) = $3
       AND EXTRACT(YEAR FROM tanggal) = $4
     ORDER BY tanggal DESC, id DESC`,
    [tenantId, account.id, bulan, tahun],
  );
  const { rows: summaryRows } = await client.query(
    `SELECT
       COALESCE(SUM(nominal) FILTER (WHERE jenis = 'Masuk'), 0)::bigint AS pemasukan,
       COALESCE(SUM(nominal) FILTER (WHERE jenis = 'Keluar'), 0)::bigint AS pengeluaran,
       COALESCE(SUM(${cashDeltaSql()}), 0)::bigint AS saldo
     FROM cash_account_transactions
     WHERE tenant_id = $1 AND cash_account_id = $2`,
    [tenantId, account.id],
  );
  return {
    account,
    meta: { scope: "foundation", periode: { bulan, tahun } },
    summary: {
      pemasukan: Number(summaryRows[0]?.pemasukan || 0),
      pengeluaran: Number(summaryRows[0]?.pengeluaran || 0),
      saldo: Number(summaryRows[0]?.saldo || 0),
      jumlah_transaksi: rows.length,
    },
    data: rows,
  };
}

async function createFoundationTransaction(req, client = pool) {
  const account = await getFoundationAccount(req.tenantId, client);
  const body = req.body || {};
  const jenis = normalizeJenis(body.jenis);
  const nominal = normalizeNominal(body.nominal);
  const kategori = String(body.kategori || "").trim();
  if (!kategori) {
    const error = new Error("Kategori wajib diisi");
    error.status = 400;
    error.code = "KATEGORI_REQUIRED";
    throw error;
  }
  const { rows } = await client.query(
    `INSERT INTO cash_account_transactions (
       tenant_id, cash_account_id, tanggal, jenis, kategori, keterangan,
       nominal, petugas, actor_user_id, source, idempotency_key
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'manual',$10)
     ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
     RETURNING *`,
    [
      req.tenantId,
      account.id,
      body.tanggal || todayDate(),
      jenis,
      kategori,
      body.keterangan || null,
      nominal,
      body.petugas || req.user?.nama || req.user?.username || null,
      req.user?.id || null,
      body.idempotency_key || null,
    ],
  );
  if (!rows.length) throw accessError("Transaksi duplikat diabaikan", 409, "IDEMPOTENT_DUPLICATE");
  return rows[0];
}

async function createCashTransfer(req, client = pool) {
  const body = req.body || {};
  const direction = String(body.direction || "").trim();
  if (!VALID_TRANSFER_DIRECTIONS.has(direction)) {
    const error = new Error("Direction transfer tidak valid");
    error.status = 400;
    error.code = "INVALID_TRANSFER_DIRECTION";
    throw error;
  }
  const tenantId = Number(req.tenantId);
  const amount = normalizeNominal(body.amount || body.nominal);
  const tanggal = body.tanggal || todayDate();
  const keterangan = body.keterangan || null;
  const idempotencyKey = body.idempotency_key || crypto.randomUUID();
  const account = await getFoundationAccount(tenantId, client);
  const unitId = direction === "unit_to_foundation"
    ? Number(body.source_unit_id || body.unit_id)
    : Number(body.destination_unit_id || body.unit_id);
  const unit = await assertUnitAccess(req.user, unitId, tenantId, client);

  await client.query("BEGIN");
  try {
    const existing = await client.query(
      `SELECT id FROM cash_transfers WHERE tenant_id = $1 AND idempotency_key = $2 LIMIT 1`,
      [tenantId, idempotencyKey],
    );
    if (existing.rows.length) {
      await client.query("COMMIT");
      return { duplicate: true, id: existing.rows[0].id };
    }

    const { rows: transferRows } = await client.query(
      `INSERT INTO cash_transfers (
         tenant_id, direction, source_unit_id, destination_unit_id,
         foundation_account_id, amount, tanggal, keterangan, actor_user_id, idempotency_key
       )
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        tenantId,
        direction,
        direction === "unit_to_foundation" ? unit.id : null,
        direction === "foundation_to_unit" ? unit.id : null,
        account.id,
        amount,
        tanggal,
        keterangan,
        req.user?.id || null,
        idempotencyKey,
      ],
    );
    const transfer = transferRows[0];

    const unitJenis = direction === "unit_to_foundation" ? "Keluar" : "Masuk";
    const foundationJenis = direction === "unit_to_foundation" ? "Masuk" : "Keluar";
    await client.query(
      `INSERT INTO buku_kas (
         tenant_id, unit_id, tanggal, jenis, kategori, keterangan, nominal,
         petugas, actor_user_id, source, transfer_id, idempotency_key
       )
       VALUES ($1,$2,$3,$4,'Internal Transfer',$5,$6,$7,$8,'internal_transfer',$9,$10)`,
      [
        tenantId,
        unit.id,
        tanggal,
        unitJenis,
        keterangan || (direction === "unit_to_foundation" ? "Transfer ke Kas Yayasan" : "Transfer dari Kas Yayasan"),
        amount,
        req.user?.nama || req.user?.username || null,
        req.user?.id || null,
        transfer.id,
        `${idempotencyKey}:unit`,
      ],
    );
    await client.query(
      `INSERT INTO cash_account_transactions (
         tenant_id, cash_account_id, transfer_id, tanggal, jenis, kategori,
         keterangan, nominal, petugas, actor_user_id, source, idempotency_key
       )
       VALUES ($1,$2,$3,$4,$5,'Internal Transfer',$6,$7,$8,$9,'internal_transfer',$10)`,
      [
        tenantId,
        account.id,
        transfer.id,
        tanggal,
        foundationJenis,
        keterangan || (direction === "unit_to_foundation" ? "Transfer dari Buku Kas Unit" : "Transfer ke Buku Kas Unit"),
        amount,
        req.user?.nama || req.user?.username || null,
        req.user?.id || null,
        `${idempotencyKey}:foundation`,
      ],
    );
    await client.query("COMMIT");
    return { duplicate: false, ...transfer };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}

async function consolidation(req, client = pool) {
  const tenantId = Number(req.tenantId);
  const { bulan, tahun } = buildPeriod(req.query);
  const account = await getFoundationAccount(tenantId, client);
  const { rows: unitRows } = await client.query(
    `SELECT
       u.id AS unit_id,
       u.kode AS unit_kode,
       u.nama AS unit_nama,
       COALESCE(SUM(${cashDeltaSql("bk")}), 0)::bigint AS saldo,
       COALESCE(SUM(bk.nominal) FILTER (WHERE bk.jenis = 'Masuk' AND bk.transfer_id IS NULL), 0)::bigint AS external_inflow,
       COALESCE(SUM(bk.nominal) FILTER (WHERE bk.jenis = 'Keluar' AND bk.transfer_id IS NULL), 0)::bigint AS external_outflow,
       COALESCE(SUM(bk.nominal) FILTER (WHERE bk.transfer_id IS NOT NULL), 0)::bigint AS internal_transfer
     FROM unit_pendidikan u
     LEFT JOIN buku_kas bk
       ON bk.unit_id = u.id
      AND bk.tenant_id = u.tenant_id
     WHERE u.tenant_id = $1
       AND u.is_active = true
     GROUP BY u.id, u.kode, u.nama, u.sort_order
     ORDER BY u.sort_order, u.id`,
    [tenantId],
  );
  const { rows: foundationRows } = await client.query(
    `SELECT
       COALESCE(SUM(${cashDeltaSql()}), 0)::bigint AS saldo,
       COALESCE(SUM(nominal) FILTER (WHERE jenis = 'Masuk' AND transfer_id IS NULL), 0)::bigint AS external_inflow,
       COALESCE(SUM(nominal) FILTER (WHERE jenis = 'Keluar' AND transfer_id IS NULL), 0)::bigint AS external_outflow,
       COALESCE(SUM(nominal) FILTER (WHERE transfer_id IS NOT NULL), 0)::bigint AS internal_transfer
     FROM cash_account_transactions
     WHERE tenant_id = $1 AND cash_account_id = $2`,
    [tenantId, account.id],
  );
  const foundation = foundationRows[0] || {};
  const unitSaldo = unitRows.reduce((sum, row) => sum + Number(row.saldo || 0), 0);
  const foundationSaldo = Number(foundation.saldo || 0);
  return {
    periode: { bulan, tahun },
    kas_yayasan: {
      id: account.id,
      name: account.name,
      saldo: foundationSaldo,
      external_inflow: Number(foundation.external_inflow || 0),
      external_outflow: Number(foundation.external_outflow || 0),
      internal_transfer: Number(foundation.internal_transfer || 0),
    },
    units: unitRows.map((row) => ({
      unit_id: Number(row.unit_id),
      unit_kode: row.unit_kode,
      unit_nama: row.unit_nama,
      saldo: Number(row.saldo || 0),
      external_inflow: Number(row.external_inflow || 0),
      external_outflow: Number(row.external_outflow || 0),
      internal_transfer: Number(row.internal_transfer || 0),
    })),
    total: {
      posisi_kas: unitSaldo + foundationSaldo,
      external_inflow:
        Number(foundation.external_inflow || 0) +
        unitRows.reduce((sum, row) => sum + Number(row.external_inflow || 0), 0),
      external_outflow:
        Number(foundation.external_outflow || 0) +
        unitRows.reduce((sum, row) => sum + Number(row.external_outflow || 0), 0),
      internal_transfer:
        Number(foundation.internal_transfer || 0) +
        unitRows.reduce((sum, row) => sum + Number(row.internal_transfer || 0), 0),
    },
  };
}

module.exports = {
  consolidation,
  createCashTransfer,
  createFoundationTransaction,
  deleteBukuKas,
  handleServiceError,
  getFoundationAccount,
  getUnitCashRunningBalance,
  listBukuKas,
  listFoundationCash,
  writeBukuKas,
};
