import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../layouts/AppShell";
import api, { API_BASE_URL } from "../services/api";
import Badge from "../components/ui/Badge";
import Button from "../components/ui/Button";
import DataTableCard from "../components/ui/DataTableCard";
import TableToolbar from "../components/ui/TableToolbar";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import StatusBadge from "../components/ui/StatusBadge";
import Modal from "../components/Modal";
import TableActions from "../components/ui/table/TableActions";
import {
  Table,
  TableScroll,
  TablePagination,
} from "../components/ui/table";
import { FilterBar, FormActionBar, FormField, Input, Select, Textarea } from "../components/ui/form";
import { DEFAULT_PAGE_SIZE } from "../hooks/useClientPagination";
import { inferTransactionMethod, transactionMethodLabel } from "../constants/wallet";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { buildUnitScopeParams } from "../utils/unitScopeParams";
import { hasAnyPermission } from "../utils/hasPermission";

function formatCurrency(value) {
  const amount = Number(value || 0);
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${sign}Rp ${Math.abs(amount).toLocaleString("id-ID")}`;
}

function trxTypeLabel(trxType) {
  if (trxType === "payment") return "PEMBAYARAN";
  if (trxType === "topup") return "TOPUP";
  if (trxType === "refund") return "REFUND";
  if (trxType === "withdrawal") return "PENARIKAN";
  return String(trxType || "").toUpperCase();
}

function trxTypeBadgeVariant(trxType) {
  if (trxType === "refund") return "warning";
  if (trxType === "topup") return "success";
  if (trxType === "withdrawal") return "warning";
  return "danger";
}

function getDefaultDateRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  return {
    start_date: start.toISOString().slice(0, 10),
    end_date: end.toISOString().slice(0, 10),
  };
}

function getApiError(err, fallback = "Terjadi kesalahan. Silakan coba lagi.") {
  return err?.response?.data?.error || fallback;
}

function RFIDTransactionPage() {
  const { activeUnitId, allUnitsAllowed } = useActiveUnit();
  const scopeParams = useMemo(
    () => buildUnitScopeParams({ activeUnitId, allUnitsAllowed }),
    [activeUnitId, allUnitsAllowed],
  );
  const defaultRange = getDefaultDateRange();
  const [transactions, setTransactions] = useState([]);
  const [pagination, setPagination] = useState({
    limit: DEFAULT_PAGE_SIZE,
    offset: 0,
    total: 0,
  });
  const [page, setPage] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [tableSearch, setTableSearch] = useState("");
  const [startDate, setStartDate] = useState(defaultRange.start_date);
  const [endDate, setEndDate] = useState(defaultRange.end_date);
  const [filterType, setFilterType] = useState("");
  const [correction, setCorrection] = useState(null);
  const [newNominal, setNewNominal] = useState("");
  const [reason, setReason] = useState("");
  const [isCorrecting, setIsCorrecting] = useState(false);
  const canManageWallet = hasAnyPermission(["wallet.manage", "rfid.manage"]);

  const searchDebounceRef = useRef(null);

  const fetchTransactions = useCallback(
    async (pageNum = 1) => {
      setIsLoading(true);

      try {
        const params = {
          start_date: startDate,
          end_date: endDate,
          limit: DEFAULT_PAGE_SIZE,
          offset: (pageNum - 1) * DEFAULT_PAGE_SIZE,
        };

        if (tableSearch.trim()) params.search = tableSearch.trim();
        if (filterType) params.type = filterType;
        Object.assign(params, scopeParams);

        const res = await api.get("/rfid/transactions", { params });
        setTransactions(res.data.data || []);
        setPagination(
          res.data.pagination || {
            limit: DEFAULT_PAGE_SIZE,
            offset: 0,
            total: 0,
          },
        );
        setPage(pageNum);
      } catch (err) {
        console.error(err);
        alert(getApiError(err, "Gagal memuat riwayat transaksi"));
      } finally {
        setIsLoading(false);
      }
    },
    [startDate, endDate, tableSearch, filterType, scopeParams],
  );

  useEffect(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    searchDebounceRef.current = setTimeout(() => {
      fetchTransactions(1);
    }, tableSearch.trim() ? 300 : 0);

    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, [startDate, endDate, tableSearch, filterType, fetchTransactions]);

  const pageSize = pagination.limit || DEFAULT_PAGE_SIZE;

  const buildExportUrl = () => {
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
    });

    if (tableSearch.trim()) params.set("search", tableSearch.trim());
    if (filterType) params.set("type", filterType);
    Object.entries(scopeParams).forEach(([key, value]) => params.set(key, value));

    return `${API_BASE_URL}/rfid/transactions/export?${params.toString()}`;
  };

  const openCorrection = (mode, trx) => {
    setCorrection({ mode, trx });
    setNewNominal(mode === "edit" ? String(trx.nominal) : "");
    setReason("");
  };

  const closeCorrection = () => {
    if (isCorrecting) return;
    setCorrection(null);
    setNewNominal("");
    setReason("");
  };

  const correctionDelta = correction?.mode === "delete"
    ? -Number(correction?.trx?.nominal || 0)
    : Number(newNominal || 0) - Number(correction?.trx?.nominal || 0);

  const submitCorrection = async () => {
    if (!correction) return;
    const normalizedReason = reason.trim();
    if (normalizedReason.length < 5) {
      alert("Alasan wajib diisi minimal 5 karakter.");
      return;
    }
    if (
      correction.mode === "edit"
      && (!Number.isSafeInteger(Number(newNominal)) || Number(newNominal) <= 0)
    ) {
      alert("Nominal baru harus berupa rupiah bulat dan lebih dari 0.");
      return;
    }

    setIsCorrecting(true);
    const idempotencyKey = crypto.randomUUID();
    try {
      if (correction.mode === "edit") {
        await api.patch(
          `/rfid/transactions/${correction.trx.id}`,
          {
            nominal: Number(newNominal),
            reason: normalizedReason,
            idempotency_key: idempotencyKey,
          },
          { params: scopeParams, headers: { "Idempotency-Key": idempotencyKey } },
        );
      } else {
        await api.delete(`/rfid/transactions/${correction.trx.id}`, {
          params: scopeParams,
          headers: { "Idempotency-Key": idempotencyKey },
          data: { reason: normalizedReason, idempotency_key: idempotencyKey },
        });
      }
      const successMessage = correction.mode === "edit"
        ? "Transaksi dan saldo dompet berhasil dikoreksi."
        : "Transaksi dihapus dari mutasi dan saldo dompet berhasil dikoreksi.";
      setCorrection(null);
      setNewNominal("");
      setReason("");
      await fetchTransactions(page);
      alert(successMessage);
    } catch (err) {
      alert(getApiError(err, "Koreksi transaksi gagal"));
    } finally {
      setIsCorrecting(false);
    }
  };

  return (
    <AppShell
      title="Riwayat Transaksi"
      description="Riwayat transaksi Dompet Santri dari semua metode"
      breadcrumb="Keuangan / Dompet Santri / Transaksi"
    >
      <DataTableCard
        title="Laporan Transaksi"
        subtitle="Riwayat pembayaran, topup, dan pengembalian saldo"
        actions={
          <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
            {pagination.total || 0} transaksi
          </span>
        }
      >
        <FilterBar label="Filter" className="rfid-filter-compact">
          <FormField label="Dari" htmlFor="trx-start-date" className="rfid-filter-date">
            <Input
              id="trx-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </FormField>
          <FormField label="Sampai" htmlFor="trx-end-date" className="rfid-filter-date">
            <Input
              id="trx-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </FormField>
          <Select value={filterType} onChange={(e) => setFilterType(e.target.value)} aria-label="Tipe transaksi">
            <option value="">Semua Tipe</option>
            <option value="payment">Pembayaran</option>
            <option value="topup">Topup</option>
            <option value="refund">Refund</option>
            <option value="withdrawal">Penarikan</option>
          </Select>
        </FilterBar>

        <TableToolbar
          search={
            <SearchInput
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Cari nama santri..."
            />
          }
          actions={
            <Button
              variant="success"
              onClick={() => {
                window.open(buildExportUrl(), "_blank");
              }}
            >
              Export Excel
            </Button>
          }
        />

        {isLoading ? (
          <EmptyState title="Memuat data..." description="Mohon tunggu sebentar." />
        ) : transactions.length === 0 ? (
          <EmptyState
            title="Tidak ada transaksi"
            description="Ubah rentang tanggal atau filter pencarian."
          />
        ) : (
          <>
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Santri</th>
                    <th>Kamar / Asrama</th>
                    <th>Tipe</th>
                    <th>Metode</th>
                    <th>Petugas</th>
                    <th>Merchant</th>
                    <th>Device</th>
                    <th>Nominal</th>
                    <th>Saldo Awal</th>
                    <th>Saldo Akhir</th>
                    <th>Sync</th>
                    {canManageWallet && activeUnitId ? <th>Aksi</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {transactions.map((trx) => (
                    <tr key={trx.id}>
                      <td className="table-v3__cell--mono">
                        {new Date(trx.created_at).toLocaleString()}
                      </td>
                      <td className="table-v3__cell--strong">{trx.nama_santri}</td>
                      <td>{trx.kamar || "—"}</td>
                      <td>
                        <Badge variant={trxTypeBadgeVariant(trx.trx_type)}>
                          {trxTypeLabel(trx.trx_type)}
                        </Badge>
                      </td>
                      <td>{transactionMethodLabel(inferTransactionMethod(trx))}</td>
                      <td>{trx.nama_petugas || "—"}</td>
                      <td>{trx.nama_merchant || "—"}</td>
                      <td>{trx.device_id || "—"}</td>
                      <td className="table-v3__cell--strong">
                        Rp {Number(trx.nominal).toLocaleString()}
                      </td>
                      <td>Rp {Number(trx.saldo_awal).toLocaleString()}</td>
                      <td>Rp {Number(trx.saldo_akhir).toLocaleString()}</td>
                      <td>
                        <StatusBadge status={trx.sync_status} />
                      </td>
                      {canManageWallet && activeUnitId ? (
                        <td>
                          <TableActions
                            items={[
                              {
                                type: "edit",
                                title: "Edit topup manual",
                                hidden: !trx.correction_eligible,
                                onClick: () => openCorrection("edit", trx),
                              },
                              {
                                type: "delete",
                                title: "Hapus topup manual",
                                hidden: !trx.correction_eligible,
                                onClick: () => openCorrection("delete", trx),
                              },
                            ]}
                          />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
            <TablePagination
              page={page}
              pageSize={pageSize}
              totalItems={pagination.total || 0}
              onPageChange={fetchTransactions}
            />
          </>
        )}
      </DataTableCard>

      <Modal
        open={Boolean(correction)}
        title={correction?.mode === "edit" ? "Edit transaksi dompet" : "Hapus transaksi dompet?"}
        onClose={closeCorrection}
        width={520}
      >
        {correction ? (
          <div style={{ display: "grid", gap: "var(--space-4)", minWidth: 0 }}>
            <div className="form-modal-summary-v3">
              <p><strong>Santri:</strong> {correction.trx.nama_santri || "—"}</p>
              <p><strong>Jenis:</strong> {trxTypeLabel(correction.trx.trx_type)}</p>
              <p><strong>Nominal:</strong> Rp {Number(correction.trx.nominal).toLocaleString("id-ID")}</p>
              <p>
                <strong>Tanggal:</strong>{" "}
                {new Date(correction.trx.created_at).toLocaleString("id-ID")}
              </p>
            </div>

            {correction.mode === "edit" ? (
              <FormField label="Nominal baru" htmlFor="wallet-edit-nominal">
                <Input
                  id="wallet-edit-nominal"
                  type="number"
                  min="1"
                  step="1"
                  value={newNominal}
                  onChange={(event) => setNewNominal(event.target.value)}
                />
              </FormField>
            ) : (
              <p style={{
                margin: 0,
                padding: "12px",
                borderRadius: "var(--radius-sm)",
                background: "var(--danger-subtle, rgba(220, 38, 38, 0.08))",
                color: "var(--text-primary)",
                lineHeight: 1.5,
              }}>
                Transaksi akan dihapus dari mutasi dan saldo dompet akan dikoreksi.
              </p>
            )}

            <div style={{
              padding: "12px",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              overflowWrap: "anywhere",
            }}>
              <strong>Perubahan saldo: {formatCurrency(correctionDelta)}</strong>
            </div>

            <FormField label="Alasan koreksi" htmlFor="wallet-correction-reason">
              <Textarea
                id="wallet-correction-reason"
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Contoh: Topup tercatat dua kali"
              />
            </FormField>

            <FormActionBar>
              <Button
                variant={correction.mode === "delete" ? "danger" : "primary"}
                loading={isCorrecting}
                onClick={submitCorrection}
              >
                {correction.mode === "delete" ? "Hapus Transaksi" : "Simpan Perubahan"}
              </Button>
              <Button variant="outline" disabled={isCorrecting} onClick={closeCorrection}>
                Batal
              </Button>
            </FormActionBar>
          </div>
        ) : null}
      </Modal>
    </AppShell>
  );
}

export default RFIDTransactionPage;
