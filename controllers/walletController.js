const crypto = require("node:crypto");
const pool = require("../db");
const {
  getWalletAccountForSantri,
  resolveWalletAccess,
  sendUnitError,
} = require("../services/walletUnitService");

function isSantriAktif(status) {
  const normalized = String(status ?? "aktif").trim().toLowerCase();
  return normalized === "" || normalized === "aktif" || normalized === "active";
}

exports.withdrawSaldo = async (req, res) => {
  const tenantId = Number(req.tenantId);
  const santriId = Number(req.body?.santri_id);
  const nominal = Number(req.body?.nominal);
  const keterangan = String(req.body?.keterangan || "Penarikan manual Dompet Santri").trim();

  if (!Number.isInteger(santriId) || santriId <= 0) {
    return res.status(400).json({ success: false, error: "Santri wajib dipilih" });
  }

  if (!Number.isSafeInteger(nominal) || nominal <= 0) {
    return res.status(400).json({
      success: false,
      error: "Nominal penarikan harus berupa rupiah bulat dan lebih dari 0",
    });
  }

  if (!keterangan || keterangan.length > 250) {
    return res.status(400).json({
      success: false,
      error: "Keterangan wajib diisi dan maksimal 250 karakter",
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const access = await resolveWalletAccess(req, client, { requireSpecific: true });

    const walletAccount = await getWalletAccountForSantri(client, {
      tenantId,
      unitId: access.unitId,
      santriId,
      lock: true,
    });

    if (!walletAccount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false, error: "Santri tidak ditemukan" });
    }

    if (!isSantriAktif(walletAccount.santri_status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        error: "Santri nonaktif tidak dapat melakukan penarikan",
      });
    }

    const saldoAwal = Number(walletAccount.current_balance || 0);
    if (saldoAwal < nominal) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        success: false,
        error: "Saldo tidak cukup",
        saldo_sekarang: saldoAwal,
      });
    }

    const saldoAkhir = saldoAwal - nominal;
    const trxId = `WITHDRAWAL-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

    await client.query(
      `UPDATE wallet_accounts
       SET current_balance = $1,
           updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3 AND unit_id = $4`,
      [saldoAkhir, walletAccount.id, tenantId, access.unitId],
    );

    await client.query(
      `INSERT INTO wallet_transactions (
         wallet_account_id, tenant_id, unit_id, santri_id, type, direction,
         amount, balance_after, reference_type, reference_id, source,
         actor_user_id, location_unit_id, idempotency_key
       )
       VALUES ($1, $2, $3, $4, 'withdrawal', 'debit', $5, $6, 'manual_withdrawal', $7, 'admin', $8, $3, $9)`,
      [
        walletAccount.id,
        tenantId,
        access.unitId,
        santriId,
        nominal,
        saldoAkhir,
        trxId,
        req.user?.id || null,
        `${tenantId}:${access.unitId}:${trxId}`,
      ],
    );

    await client.query(
      `INSERT INTO transaksi
       (santri_id, jenis, nominal, keterangan, created_by, trx_id, tenant_id)
       VALUES ($1, 'PENARIKAN DOMPET', $2, $3, $4, $5, $6)`,
      [santriId, nominal, keterangan, req.user.id, trxId, tenantId],
    );

    await client.query(
      `INSERT INTO audit_logs (device_id, event_type, detail, tenant_id)
       VALUES ('BACKEND', 'WALLET_WITHDRAWAL', $1, $2)`,
      [`${walletAccount.nama} | Rp ${nominal} | ${keterangan}`, tenantId],
    );

    await client.query("COMMIT");

    return res.json({
      success: true,
      data: {
        trx_id: trxId,
        santri_id: santriId,
        nominal,
        saldo_awal: saldoAwal,
        saldo_akhir: saldoAkhir,
        transaction_method: "manual",
        nama_petugas: req.user.nama || req.user.username || "Petugas",
      },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[wallet.withdrawSaldo]", err);
    return sendUnitError(res, err, "Penarikan saldo gagal");
  } finally {
    client.release();
  }
};
