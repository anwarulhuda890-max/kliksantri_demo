const { accessError } = require("./unitAccessService");
const { resolveWalletAccess } = require("./walletUnitService");

class WalletCorrectionError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function correctionError(message, status, code) {
  return new WalletCorrectionError(message, status, code);
}

function requirePositiveInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw correctionError(`${field} tidak valid`, 400, "INVALID_TRANSACTION_CORRECTION");
  }
  return parsed;
}

function requireReason(value) {
  const reason = String(value || "").trim();
  if (reason.length < 5 || reason.length > 500) {
    throw correctionError("Alasan wajib diisi (5-500 karakter)", 400, "CORRECTION_REASON_REQUIRED");
  }
  return reason;
}

function requireRequestId(value) {
  const requestId = String(value || "").trim();
  if (requestId.length < 8 || requestId.length > 180) {
    throw correctionError("Idempotency key wajib dan tidak valid", 400, "IDEMPOTENCY_KEY_REQUIRED");
  }
  return requestId;
}

function isManualTopupShape(row) {
  return String(row.type || "").toLowerCase() === "topup"
    && String(row.direction || "").toLowerCase() === "credit"
    && String(row.source || "").toLowerCase() === "admin"
    && String(row.reference_type || "").toLowerCase() === "manual_topup"
    && Boolean(String(row.reference_id || "").trim())
    && row.merchant_id == null
    && row.device_id == null;
}

async function findPriorRequest(client, { tenantId, action, requestId }) {
  const { rows } = await client.query(
    `SELECT id, original_transaction_id, resulting_balance, new_nominal,
            balance_delta, created_at
     FROM wallet_transaction_correction_audits
     WHERE tenant_id = $1 AND action = $2 AND request_id = $3
     LIMIT 1`,
    [tenantId, action, requestId],
  );
  if (!rows[0]) return null;
  return {
    success: true,
    idempotent_replay: true,
    audit_id: Number(rows[0].id),
    transaction_id: Number(rows[0].original_transaction_id),
    nominal: rows[0].new_nominal == null ? null : Number(rows[0].new_nominal),
    balance_delta: Number(rows[0].balance_delta),
    saldo_akhir: Number(rows[0].resulting_balance),
  };
}

async function lockCorrectionRequest(client, { tenantId, action, requestId }) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext($1))",
    [`wallet-correction:${tenantId}:${action}:${requestId}`],
  );
}

async function lockTransaction(client, { tenantId, transactionId }) {
  const { rows } = await client.query(
    `SELECT wt.*, wa.current_balance
     FROM wallet_transactions wt
     JOIN wallet_accounts wa
       ON wa.id = wt.wallet_account_id
      AND wa.tenant_id = wt.tenant_id
      AND wa.unit_id = wt.unit_id
     WHERE wt.tenant_id = $1 AND wt.id = $2
     FOR UPDATE OF wt, wa`,
    [tenantId, transactionId],
  );
  return rows[0] || null;
}

async function assertStandaloneManualTopup(client, row) {
  if (!isManualTopupShape(row)) {
    throw correctionError(
      "Transaksi ini terkait transaksi lain dan tidak dapat diubah atau dihapus langsung.",
      409,
      "TRANSACTION_NOT_DELETABLE",
    );
  }

  const companion = await client.query(
    `SELECT id, santri_id, jenis, nominal, keterangan, created_by, created_at, trx_id
     FROM transaksi
     WHERE tenant_id = $1 AND trx_id = $2
     FOR UPDATE`,
    [row.tenant_id, row.reference_id],
  );

  if (
    companion.rows.length !== 1
    || Number(companion.rows[0].santri_id) !== Number(row.santri_id)
    || Number(companion.rows[0].nominal) !== Number(row.amount)
    || String(companion.rows[0].jenis || "").trim().toUpperCase() !== "TOPUP RFID"
  ) {
    throw correctionError(
      "Transaksi manual tidak memiliki pasangan ledger yang aman untuk dikoreksi.",
      409,
      "TRANSACTION_NOT_DELETABLE",
    );
  }

  const dependency = await client.query(
    `SELECT
       EXISTS (
         SELECT 1 FROM transaksi_rfid tr
         WHERE tr.tenant_id = $1
           AND (tr.trx_id = $2 OR tr.trx_id = 'REFUND-OF-' || $2)
       ) AS rfid_linked,
       EXISTS (
         SELECT 1 FROM wallet_transactions child
         WHERE child.tenant_id = $1
           AND child.id <> $3
           AND (
             child.reference_id = $3::text
             OR child.reference_id = $4
             OR (
               child.reference_id = $2
               AND NOT (
                 LOWER(TRIM(child.type)) = 'topup'
                 AND LOWER(TRIM(child.source)) = 'admin'
                 AND LOWER(TRIM(child.reference_type)) = 'manual_topup'
               )
             )
           )
       ) AS wallet_linked`,
    [row.tenant_id, row.reference_id, row.id, row.idempotency_key],
  );

  if (dependency.rows[0]?.rfid_linked || dependency.rows[0]?.wallet_linked) {
    throw correctionError(
      "Transaksi ini terkait transaksi lain dan tidak dapat diubah atau dihapus langsung.",
      409,
      "TRANSACTION_NOT_DELETABLE",
    );
  }

  return companion.rows[0];
}

async function lockAndReconcileLedger(client, row) {
  const { rows } = await client.query(
    `SELECT id, direction, amount, balance_after, created_at
     FROM wallet_transactions
     WHERE wallet_account_id = $1
     ORDER BY created_at, id
     FOR UPDATE`,
    [row.wallet_account_id],
  );

  let running = 0;
  for (const ledgerRow of rows) {
    running += String(ledgerRow.direction).toLowerCase() === "credit"
      ? Number(ledgerRow.amount)
      : -Number(ledgerRow.amount);
    if (running !== Number(ledgerRow.balance_after) || running < 0) {
      throw correctionError(
        "Saldo akun tidak reconcile dengan ledger. Koreksi dibatalkan.",
        409,
        "WALLET_BALANCE_MISMATCH",
      );
    }
  }

  if (running !== Number(row.current_balance)) {
    throw correctionError(
      "Saldo akun tidak reconcile dengan ledger. Koreksi dibatalkan.",
      409,
      "WALLET_BALANCE_MISMATCH",
    );
  }

  return rows;
}

function assertProspectiveBalances(ledgerRows, row, delta, { deleting }) {
  const targetIndex = ledgerRows.findIndex((ledgerRow) => Number(ledgerRow.id) === Number(row.id));
  if (targetIndex < 0) {
    throw correctionError("Transaksi tidak ditemukan pada ledger akun.", 409, "WALLET_BALANCE_MISMATCH");
  }
  for (let index = 0; index < ledgerRows.length; index += 1) {
    const ledgerRow = ledgerRows[index];
    const affected = deleting ? index > targetIndex : index >= targetIndex;
    if (affected && Number(ledgerRow.balance_after) + delta < 0) {
      throw correctionError(
        deleting
          ? "Saldo tidak mencukupi untuk menghapus transaksi ini."
          : "Perubahan nominal akan menyebabkan saldo negatif.",
        409,
        deleting
          ? "INSUFFICIENT_BALANCE_TO_DELETE_TRANSACTION"
          : "INSUFFICIENT_BALANCE_TO_EDIT_TRANSACTION",
      );
    }
  }
}

function snapshotRow(row, companion) {
  return {
    wallet_transaction: {
      id: Number(row.id),
      wallet_account_id: Number(row.wallet_account_id),
      tenant_id: Number(row.tenant_id),
      unit_id: Number(row.unit_id),
      santri_id: Number(row.santri_id),
      type: row.type,
      direction: row.direction,
      amount: Number(row.amount),
      balance_after: Number(row.balance_after),
      reference_type: row.reference_type,
      reference_id: row.reference_id,
      source: row.source,
      actor_user_id: row.actor_user_id,
      location_unit_id: row.location_unit_id,
      merchant_id: row.merchant_id,
      device_id: row.device_id,
      idempotency_key: row.idempotency_key,
      created_at: row.created_at,
    },
    companion_transaction: companion,
  };
}

async function insertAudit(client, {
  row, companion, action, newNominal, delta, resultingBalance,
  actorUserId, reason, requestId, afterSnapshot,
}) {
  const { rows } = await client.query(
    `INSERT INTO wallet_transaction_correction_audits (
       tenant_id, unit_id, wallet_account_id, santri_id, original_transaction_id,
       action, original_type, original_direction, original_nominal, new_nominal,
       balance_delta, resulting_balance, original_source, original_reference_type,
       original_reference_id, original_idempotency_key, original_created_at,
       actor_user_id, reason, request_id, before_snapshot, after_snapshot, deleted_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6::varchar,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       $18,$19,$20,$21::jsonb,$22::jsonb,
       CASE WHEN $6::varchar = 'delete'::varchar THEN NOW() ELSE NULL END
     )
     RETURNING id, created_at`,
    [
      row.tenant_id, row.unit_id, row.wallet_account_id, row.santri_id, row.id,
      action, row.type, row.direction, row.amount, newNominal,
      delta, resultingBalance, row.source, row.reference_type,
      row.reference_id, row.idempotency_key, row.created_at,
      actorUserId || null, reason, requestId,
      JSON.stringify(snapshotRow(row, companion)),
      afterSnapshot ? JSON.stringify(afterSnapshot) : null,
    ],
  );
  return rows[0];
}

async function updateAffectedBalances(client, row, delta, { includeTarget }) {
  await client.query(
    `UPDATE wallet_transactions
     SET balance_after = balance_after + $1
     WHERE wallet_account_id = $2
       AND (
         (created_at, id) > (
           SELECT created_at, id FROM wallet_transactions WHERE id = $3
         )
         OR ($4::boolean AND id = $3)
       )`,
    [delta, row.wallet_account_id, row.id, includeTarget],
  );
}

async function assertFinalReconciliation(client, { accountId, expectedBalance }) {
  const { rows } = await client.query(
    `WITH ordered AS (
       SELECT balance_after,
              SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END)
                OVER (ORDER BY created_at, id) AS expected_running
       FROM wallet_transactions
       WHERE wallet_account_id = $1
     ),
     ledger AS (
       SELECT COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount ELSE -amount END), 0)::bigint AS net
       FROM wallet_transactions
       WHERE wallet_account_id = $1
     )
     SELECT wa.current_balance, ledger.net,
            COALESCE((SELECT COUNT(*) FROM ordered WHERE balance_after <> expected_running), 0)::int
              AS running_mismatch
     FROM wallet_accounts wa CROSS JOIN ledger
     WHERE wa.id = $1`,
    [accountId],
  );
  const state = rows[0];
  if (
    !state
    || Number(state.current_balance) !== Number(expectedBalance)
    || Number(state.net) !== Number(expectedBalance)
    || Number(state.running_mismatch) !== 0
  ) {
    throw correctionError(
      "Rekonsiliasi akhir Wallet gagal. Seluruh koreksi dibatalkan.",
      409,
      "WALLET_BALANCE_MISMATCH",
    );
  }
}

async function editManualTopup({ client, req, transactionId, nominal, reason, requestId }) {
  const tenantId = Number(req.tenantId);
  const id = requirePositiveInteger(transactionId, "ID transaksi");
  const newNominal = requirePositiveInteger(nominal, "Nominal baru");
  const normalizedReason = requireReason(reason);
  const normalizedRequestId = requireRequestId(requestId);
  const access = await resolveWalletAccess(req, client, { requireSpecific: true });

  await lockCorrectionRequest(client, {
    tenantId, action: "edit", requestId: normalizedRequestId,
  });
  const prior = await findPriorRequest(client, {
    tenantId, action: "edit", requestId: normalizedRequestId,
  });
  if (prior) return prior;

  const row = await lockTransaction(client, { tenantId, transactionId: id });
  if (!row) throw correctionError("Transaksi tidak ditemukan", 404, "TRANSACTION_NOT_FOUND");
  if (Number(row.unit_id) !== Number(access.unitId)) {
    throw accessError("Transaksi bukan milik unit aktif", 403, "CROSS_UNIT_FORBIDDEN");
  }

  const companion = await assertStandaloneManualTopup(client, row);
  const ledgerRows = await lockAndReconcileLedger(client, row);
  const oldNominal = Number(row.amount);
  const delta = newNominal - oldNominal;
  if (delta === 0) {
    return {
      success: true,
      unchanged: true,
      transaction_id: id,
      nominal: oldNominal,
      balance_delta: 0,
      saldo_akhir: Number(row.current_balance),
    };
  }

  const resultingBalance = Number(row.current_balance) + delta;
  if (resultingBalance < 0) {
    throw correctionError(
      "Perubahan nominal akan menyebabkan saldo negatif.",
      409,
      "INSUFFICIENT_BALANCE_TO_EDIT_TRANSACTION",
    );
  }
  assertProspectiveBalances(ledgerRows, row, delta, { deleting: false });

  const afterSnapshot = {
    wallet_transaction: { ...snapshotRow(row, companion).wallet_transaction, amount: newNominal },
    balance_delta: delta,
    resulting_balance: resultingBalance,
  };
  const audit = await insertAudit(client, {
    row, companion, action: "edit", newNominal, delta, resultingBalance,
    actorUserId: req.user?.id, reason: normalizedReason,
    requestId: normalizedRequestId, afterSnapshot,
  });

  await client.query(
    `UPDATE wallet_transactions SET amount = $1 WHERE tenant_id = $2 AND id = $3`,
    [newNominal, tenantId, id],
  );
  await updateAffectedBalances(client, row, delta, { includeTarget: true });
  await client.query(
    `UPDATE transaksi SET nominal = $1 WHERE tenant_id = $2 AND id = $3`,
    [newNominal, tenantId, companion.id],
  );
  await client.query(
    `UPDATE wallet_accounts SET current_balance = $1, updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3 AND unit_id = $4`,
    [resultingBalance, row.wallet_account_id, tenantId, access.unitId],
  );
  await assertFinalReconciliation(client, {
    accountId: row.wallet_account_id,
    expectedBalance: resultingBalance,
  });

  return {
    success: true,
    audit_id: Number(audit.id),
    transaction_id: id,
    nominal: newNominal,
    balance_delta: delta,
    saldo_akhir: resultingBalance,
  };
}

async function deleteManualTopup({ client, req, transactionId, reason, requestId }) {
  const tenantId = Number(req.tenantId);
  const id = requirePositiveInteger(transactionId, "ID transaksi");
  const normalizedReason = requireReason(reason);
  const normalizedRequestId = requireRequestId(requestId);
  const access = await resolveWalletAccess(req, client, { requireSpecific: true });

  await lockCorrectionRequest(client, {
    tenantId, action: "delete", requestId: normalizedRequestId,
  });
  const prior = await findPriorRequest(client, {
    tenantId, action: "delete", requestId: normalizedRequestId,
  });
  if (prior) return prior;

  const row = await lockTransaction(client, { tenantId, transactionId: id });
  if (!row) throw correctionError("Transaksi tidak ditemukan", 404, "TRANSACTION_NOT_FOUND");
  if (Number(row.unit_id) !== Number(access.unitId)) {
    throw accessError("Transaksi bukan milik unit aktif", 403, "CROSS_UNIT_FORBIDDEN");
  }

  const companion = await assertStandaloneManualTopup(client, row);
  const ledgerRows = await lockAndReconcileLedger(client, row);
  const delta = -Number(row.amount);
  const resultingBalance = Number(row.current_balance) + delta;
  if (resultingBalance < 0) {
    throw correctionError(
      "Saldo tidak mencukupi untuk menghapus transaksi ini.",
      409,
      "INSUFFICIENT_BALANCE_TO_DELETE_TRANSACTION",
    );
  }
  assertProspectiveBalances(ledgerRows, row, delta, { deleting: true });

  const audit = await insertAudit(client, {
    row, companion, action: "delete", newNominal: null, delta, resultingBalance,
    actorUserId: req.user?.id, reason: normalizedReason,
    requestId: normalizedRequestId, afterSnapshot: null,
  });

  await updateAffectedBalances(client, row, delta, { includeTarget: false });
  await client.query(
    `DELETE FROM transaksi WHERE tenant_id = $1 AND id = $2`,
    [tenantId, companion.id],
  );
  const deleted = await client.query(
    `DELETE FROM wallet_transactions WHERE tenant_id = $1 AND id = $2 RETURNING id`,
    [tenantId, id],
  );
  if (deleted.rowCount !== 1) {
    throw correctionError("Transaksi gagal dihapus secara atomik", 409, "TRANSACTION_DELETE_RACE");
  }
  await client.query(
    `UPDATE wallet_accounts SET current_balance = $1, updated_at = NOW()
     WHERE id = $2 AND tenant_id = $3 AND unit_id = $4`,
    [resultingBalance, row.wallet_account_id, tenantId, access.unitId],
  );
  await assertFinalReconciliation(client, {
    accountId: row.wallet_account_id,
    expectedBalance: resultingBalance,
  });

  return {
    success: true,
    audit_id: Number(audit.id),
    transaction_id: id,
    nominal: null,
    balance_delta: delta,
    saldo_akhir: resultingBalance,
  };
}

module.exports = {
  WalletCorrectionError,
  deleteManualTopup,
  editManualTopup,
  isManualTopupShape,
};
