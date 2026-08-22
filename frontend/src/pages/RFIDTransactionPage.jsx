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
import {
  Table,
  TableScroll,
  TablePagination,
} from "../components/ui/table";
import { FilterBar, FormField, Input, Select } from "../components/ui/form";
import { DEFAULT_PAGE_SIZE } from "../hooks/useClientPagination";
import { inferTransactionMethod, transactionMethodLabel } from "../constants/wallet";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { buildUnitScopeParams } from "../utils/unitScopeParams";

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
    </AppShell>
  );
}

export default RFIDTransactionPage;
