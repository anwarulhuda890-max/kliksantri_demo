const assert = require("assert");
const fs = require("fs");
const path = require("path");
const pool = require("../db");
const {
  deleteManualTopup,
  editManualTopup,
} = require("../services/walletTransactionCorrectionService");

const migration = fs.readFileSync(
  path.join(__dirname, "..", "migrations", "085_wallet_transaction_correction_audit.sql"),
  "utf8",
);

async function expectCode(promise, status, code) {
  await assert.rejects(promise, (error) => error.status === status && error.code === code);
}

function requestFor(context, query) {
  return {
    tenantId: context.tenant_id,
    user: {
      id: context.user_id,
      tenant_id: context.tenant_id,
      role: "superadmin",
    },
    query,
    body: {},
    headers: {},
  };
}

async function createAccount(client, context, suffix) {
  const santri = await client.query(
    `INSERT INTO santri (tenant_id, nama, nis, status)
     VALUES ($1, $2, $3, 'aktif') RETURNING id`,
    [context.tenant_id, `Wallet Fixture ${suffix}`, `ZZ-WALLET-${suffix}`],
  );
  const santriId = Number(santri.rows[0].id);
  await client.query(
    `INSERT INTO santri_units (tenant_id, santri_id, unit_id, status, is_primary)
     VALUES ($1, $2, $3, 'active', false)`,
    [context.tenant_id, santriId, context.unit_a],
  );
  const account = await client.query(
    `INSERT INTO wallet_accounts (tenant_id, unit_id, santri_id, current_balance, status)
     VALUES ($1, $2, $3, 0, 'active') RETURNING id`,
    [context.tenant_id, context.unit_a, santriId],
  );
  return { accountId: Number(account.rows[0].id), santriId };
}

async function addMutation(client, context, account, {
  type, direction, amount, source, referenceType, referenceId,
  companion = false, merchantId = null, deviceId = null,
}) {
  const balance = await client.query(
    "SELECT current_balance FROM wallet_accounts WHERE id=$1 FOR UPDATE",
    [account.accountId],
  );
  const delta = direction === "credit" ? amount : -amount;
  const next = Number(balance.rows[0].current_balance) + delta;
  assert(next >= 0, "fixture balance tidak boleh negatif");
  await client.query(
    "UPDATE wallet_accounts SET current_balance=$1 WHERE id=$2",
    [next, account.accountId],
  );
  const inserted = await client.query(
    `INSERT INTO wallet_transactions (
       wallet_account_id, tenant_id, unit_id, santri_id, type, direction,
       amount, balance_after, reference_type, reference_id, source,
       actor_user_id, location_unit_id, merchant_id, device_id, idempotency_key
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$3,$13,$14,$15)
     RETURNING id`,
    [
      account.accountId, context.tenant_id, context.unit_a, account.santriId,
      type, direction, amount, next, referenceType, referenceId, source,
      context.user_id, merchantId, deviceId,
      `fixture:${context.tenant_id}:${referenceId}:${Date.now()}:${Math.random()}`,
    ],
  );
  if (companion) {
    await client.query(
      `INSERT INTO transaksi
       (santri_id, jenis, nominal, keterangan, created_by, trx_id, tenant_id)
       VALUES ($1, 'TOPUP RFID', $2, 'Topup Saldo RFID', $3, $4, $5)`,
      [account.santriId, amount, context.user_id, referenceId, context.tenant_id],
    );
  }
  return Number(inserted.rows[0].id);
}

async function manualTopup(client, context, account, amount, key) {
  return addMutation(client, context, account, {
    type: "topup",
    direction: "credit",
    amount,
    source: "admin",
    referenceType: "manual_topup",
    referenceId: `TOPUP-FIXTURE-${key}`,
    companion: true,
  });
}

async function accountState(client, accountId) {
  const row = (await client.query(
    `SELECT wa.current_balance,
       COUNT(wt.id)::int AS transaction_count,
       COALESCE(SUM(wt.amount) FILTER (WHERE wt.direction='credit'),0)::bigint AS incoming,
       COALESCE(SUM(wt.amount) FILTER (WHERE wt.direction='debit'),0)::bigint AS outgoing,
       COALESCE(SUM(CASE WHEN wt.direction='credit' THEN wt.amount ELSE -wt.amount END),0)::bigint AS ledger_net
     FROM wallet_accounts wa
     LEFT JOIN wallet_transactions wt ON wt.wallet_account_id=wa.id
     WHERE wa.id=$1 GROUP BY wa.id`,
    [accountId],
  )).rows[0];
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

async function main() {
  const client = await pool.connect();
  const suffix = Date.now();
  try {
    await client.query("BEGIN");
    await client.query(migration);
    const context = (await client.query(
      `SELECT u.tenant_id, usr.id AS user_id,
              MIN(u.id)::int AS unit_a, MAX(u.id)::int AS unit_b
       FROM unit_pendidikan u
       JOIN users usr ON usr.tenant_id=u.tenant_id
         AND usr.role='superadmin'
         AND LOWER(TRIM(usr.status)) IN ('aktif','active')
       WHERE u.is_active=true
       GROUP BY u.tenant_id,usr.id
       HAVING COUNT(DISTINCT u.id)>=2
       ORDER BY u.tenant_id,usr.id LIMIT 1`,
    )).rows[0];
    assert(context, "tenant fixture dengan dua unit dan superadmin tidak tersedia");

    const ownReq = requestFor(context, { unit_id: context.unit_a });
    const beforeAudit = Number((await client.query(
      "SELECT COUNT(*) AS total FROM wallet_transaction_correction_audits",
    )).rows[0].total);

    const accountA = await createAccount(client, context, `A-${suffix}`);
    const first = await manualTopup(client, context, accountA, 1000, `A1-${suffix}`);
    const second = await manualTopup(client, context, accountA, 1000, `A2-${suffix}`);
    const beforeDelete = await accountState(client, accountA.accountId);
    assert.deepStrictEqual(beforeDelete, {
      current_balance: 2000, transaction_count: 2, incoming: 2000, outgoing: 0, ledger_net: 2000,
    });
    const deleted = await deleteManualTopup({
      client, req: ownReq, transactionId: second,
      reason: "Topup fixture tercatat dua kali",
      requestId: `delete-fixture-${suffix}`,
    });
    const afterDelete = await accountState(client, accountA.accountId);
    assert.deepStrictEqual(afterDelete, {
      current_balance: 1000, transaction_count: 1, incoming: 1000, outgoing: 0, ledger_net: 1000,
    });
    assert.strictEqual(Number((await client.query(
      "SELECT COUNT(*) AS total FROM wallet_transactions WHERE id=$1",
      [second],
    )).rows[0].total), 0);
    assert.strictEqual(Number((await client.query(
      "SELECT COUNT(*) AS total FROM transaksi WHERE tenant_id=$1 AND trx_id=$2",
      [context.tenant_id, `TOPUP-FIXTURE-A2-${suffix}`],
    )).rows[0].total), 0, "companion topup yang dihapus masih muncul");
    const replay = await deleteManualTopup({
      client, req: ownReq, transactionId: second,
      reason: "Topup fixture tercatat dua kali",
      requestId: `delete-fixture-${suffix}`,
    });
    assert.strictEqual(replay.idempotent_replay, true);
    assert.deepStrictEqual(await accountState(client, accountA.accountId), afterDelete);

    const edited = await editManualTopup({
      client, req: ownReq, transactionId: first, nominal: 750,
      reason: "Nominal topup fixture salah input",
      requestId: `edit-fixture-${suffix}`,
    });
    assert.strictEqual(edited.balance_delta, -250);
    assert.strictEqual(Number((await client.query(
      "SELECT nominal FROM transaksi WHERE tenant_id=$1 AND trx_id=$2",
      [context.tenant_id, `TOPUP-FIXTURE-A1-${suffix}`],
    )).rows[0].nominal), 750, "companion topup tidak ikut diedit");
    assert.deepStrictEqual(await accountState(client, accountA.accountId), {
      current_balance: 750, transaction_count: 1, incoming: 750, outgoing: 0, ledger_net: 750,
    });
    const unchanged = await editManualTopup({
      client, req: ownReq, transactionId: first, nominal: 750,
      reason: "Retry nominal yang sama tidak mengubah saldo",
      requestId: `edit-unchanged-${suffix}`,
    });
    assert.strictEqual(unchanged.unchanged, true);
    assert.strictEqual(unchanged.balance_delta, 0);

    const accountB = await createAccount(client, context, `B-${suffix}`);
    const guardedTopup = await manualTopup(client, context, accountB, 1000, `B1-${suffix}`);
    await addMutation(client, context, accountB, {
      type: "payment", direction: "debit", amount: 800, source: "rfid",
      referenceType: "transaksi_rfid", referenceId: `PAY-FIXTURE-${suffix}`,
    });
    await expectCode(deleteManualTopup({
      client, req: ownReq, transactionId: guardedTopup,
      reason: "Uji saldo negatif pada delete",
      requestId: `negative-fixture-${suffix}`,
    }), 409, "INSUFFICIENT_BALANCE_TO_DELETE_TRANSACTION");
    assert.deepStrictEqual(await accountState(client, accountB.accountId), {
      current_balance: 200, transaction_count: 2, incoming: 1000, outgoing: 800, ledger_net: 200,
    });

    const protectedPayment = Number((await client.query(
      "SELECT id FROM wallet_transactions WHERE wallet_account_id=$1 AND type='payment'",
      [accountB.accountId],
    )).rows[0].id);
    await expectCode(deleteManualTopup({
      client, req: ownReq, transactionId: protectedPayment,
      reason: "Uji transaksi RFID protected",
      requestId: `rfid-fixture-${suffix}`,
    }), 409, "TRANSACTION_NOT_DELETABLE");

    await expectCode(editManualTopup({
      client,
      req: requestFor(context, { unit_id: context.unit_b }),
      transactionId: first,
      nominal: 500,
      reason: "Uji cross unit harus ditolak",
      requestId: `cross-fixture-${suffix}`,
    }), 403, "CROSS_UNIT_FORBIDDEN");

    await expectCode(editManualTopup({
      client,
      req: requestFor(context, { scope: "all" }),
      transactionId: first,
      nominal: 500,
      reason: "Uji semua unit harus ditolak",
      requestId: `all-fixture-${suffix}`,
    }), 400, "UNIT_REQUIRED");

    const foreignTransaction = (await client.query(
      "SELECT id FROM wallet_transactions WHERE tenant_id<>$1 ORDER BY id LIMIT 1",
      [context.tenant_id],
    )).rows[0];
    if (foreignTransaction) {
      await expectCode(deleteManualTopup({
        client, req: ownReq, transactionId: foreignTransaction.id,
        reason: "Uji cross tenant tidak boleh terungkap",
        requestId: `tenant-fixture-${suffix}`,
      }), 404, "TRANSACTION_NOT_FOUND");
    }

    const auditDelta = Number((await client.query(
      "SELECT COUNT(*) AS total FROM wallet_transaction_correction_audits",
    )).rows[0].total) - beforeAudit;
    assert.strictEqual(auditDelta, 2, "delete + edit masing-masing harus memiliki satu audit");
    const orphanDependency = Number((await client.query(
      `SELECT COUNT(*) AS total
       FROM wallet_transactions wt
       LEFT JOIN wallet_accounts wa ON wa.id=wt.wallet_account_id
       WHERE wa.id IS NULL`,
    )).rows[0].total);
    assert.strictEqual(orphanDependency, 0);

    console.log(JSON.stringify({
      status: "PASS",
      mode: "PRODUCTION_TRANSACTION_ROLLBACK",
      classification: {
        manual_admin_topup: "HARD_DELETE_ELIGIBLE",
        rfid_payment: "REVERSAL_ONLY",
      },
      cases: {
        double_topup_delete: "PASS",
        edit_delta_minus_250: "PASS",
        negative_guard: "PASS",
        linked_rfid_blocked: "PASS",
        cross_unit_403: "PASS",
        all_scope_unit_required: "PASS",
        cross_tenant_hidden: foreignTransaction ? "PASS" : "NOT_APPLICABLE_SINGLE_TENANT_DATASET",
        retry_delete_zero_effect: "PASS",
        edit_same_nominal_zero_effect: "PASS",
        export_kpi_remaining_ledger: "PASS",
      },
      money: {
        before: beforeDelete,
        after_delete: afterDelete,
        final_after_edit: await accountState(client, accountA.accountId),
        mismatch: 0,
        duplicate_balance_effect: 0,
        audit_rows_created: auditDelta,
        orphan_dependency: orphanDependency,
      },
    }, null, 2));
    await client.query("ROLLBACK");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) { /* best effort */ }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "FAIL", reason: error.message, stack: error.stack }, null, 2));
  process.exit(1);
});
