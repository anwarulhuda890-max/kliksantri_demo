import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FaUndo } from "react-icons/fa";
import AppShell from "../layouts/AppShell";
import api from "../services/api";
import Card from "../components/ui/Card";
import Modal from "../components/Modal";
import Button from "../components/ui/Button";
import StatusBadge from "../components/ui/StatusBadge";
import DataTableCard from "../components/ui/DataTableCard";
import TableToolbar from "../components/ui/TableToolbar";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import SantriSearchPicker from "../components/rfid/SantriSearchPicker";
import { Table, TableScroll, TableActions, TablePagination } from "../components/ui/table";
import { FilterBar, FormField, Input, FormActionBar } from "../components/ui/form";
import { DEFAULT_PAGE_SIZE } from "../hooks/useClientPagination";
import { formatCurrency } from "../utils/formatCurrency";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { buildUnitScopeParams } from "../utils/unitScopeParams";

function trxTypeLabel(trxType) {
  if (trxType === "payment") return "PEMBAYARAN";
  if (trxType === "topup") return "TOPUP";
  if (trxType === "refund") return "REFUND";
  return String(trxType || "").toUpperCase();
}

function getApiError(err, fallback = "Terjadi kesalahan. Silakan coba lagi.") {
  return err?.response?.data?.error || fallback;
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

function RFIDRefundPage() {
  const { activeUnitId, allUnitsAllowed } = useActiveUnit();
  const scopeParams = useMemo(
    () => buildUnitScopeParams({ activeUnitId, allUnitsAllowed }),
    [activeUnitId, allUnitsAllowed],
  );
  const writeScopeParams = useMemo(
    () => (activeUnitId ? { unit_id: activeUnitId } : null),
    [activeUnitId],
  );
  const defaultRange = getDefaultDateRange();
  const [selectedSantri, setSelectedSantri] = useState(null);
  const [santriId, setSantriId] = useState("");
  const [transaksi, setTransaksi] = useState([]);
  const [pagination, setPagination] = useState({ limit: DEFAULT_PAGE_SIZE, offset: 0, total: 0 });
  const [page, setPage] = useState(1);
  const [tableSearch, setTableSearch] = useState("");
  const [startDate, setStartDate] = useState(defaultRange.start_date);
  const [endDate, setEndDate] = useState(defaultRange.end_date);
  const [confirmItem, setConfirmItem] = useState(null);
  const [isRefunding, setIsRefunding] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const searchDebounceRef = useRef(null);

  const fetchTransactions = useCallback(
    async (pageNum = 1) => {
      if (!santriId) {
        setTransaksi([]);
        setPagination({ limit: DEFAULT_PAGE_SIZE, offset: 0, total: 0 });
        return;
      }

      setIsLoading(true);

      try {
        const params = {
          ...scopeParams,
          type: "payment",
          santri_id: santriId,
          start_date: startDate,
          end_date: endDate,
          limit: DEFAULT_PAGE_SIZE,
          offset: (pageNum - 1) * DEFAULT_PAGE_SIZE,
        };

        if (tableSearch.trim()) params.search = tableSearch.trim();

        const trxRes = await api.get("/rfid/transactions", { params });
        setTransaksi(trxRes.data.data || []);
        setPagination(
          trxRes.data.pagination || { limit: DEFAULT_PAGE_SIZE, offset: 0, total: 0 },
        );
        setPage(pageNum);
      } catch (err) {
        console.error(err);
        alert(getApiError(err, "Gagal memuat data refund RFID"));
      } finally {
        setIsLoading(false);
      }
    },
    [santriId, startDate, endDate, tableSearch, scopeParams],
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
  }, [santriId, startDate, endDate, tableSearch, fetchTransactions]);

  const openRefundConfirm = (item) => {
    if (item.trx_type !== "payment") return;
    setConfirmItem(item);
  };

  const closeRefundConfirm = () => {
    if (isRefunding) return;
    setConfirmItem(null);
  };

  const executeRefund = async () => {
    if (!confirmItem || isRefunding) return;

    setIsRefunding(true);

    try {
      await api.post("/rfid/refund", {
        transaksi_id: confirmItem.id,
      });

      alert("Refund berhasil");
      setConfirmItem(null);
      await fetchTransactions(page);
    } catch (err) {
      console.error(err);
      alert(getApiError(err, "Refund gagal"));
    } finally {
      setIsRefunding(false);
    }
  };

  const pageSize = pagination.limit || DEFAULT_PAGE_SIZE;

  return (
    <AppShell title="Refund RFID" breadcrumb="Keamanan / RFID Refund">
      <Card padding="sm" shadow="card" border={false} radius="xl">
        <FilterBar label="Filter" className="rfid-filter-compact">
          <SantriSearchPicker
            id="refund-santri-search"
            label="Santri"
            value={santriId}
            onChange={setSantriId}
            onSelect={setSelectedSantri}
            selectedSantri={selectedSantri}
            params={writeScopeParams}
            className="rfid-filter-santri"
            required
          />
          <FormField label="Dari" htmlFor="refund-start-date" className="rfid-filter-date">
            <Input
              id="refund-start-date"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </FormField>
          <FormField label="Sampai" htmlFor="refund-end-date" className="rfid-filter-date">
            <Input
              id="refund-end-date"
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </FormField>
        </FilterBar>
      </Card>

      <div style={{ marginTop: "var(--space-6)" }}>
        <DataTableCard
          title="Transaksi Refund"
          subtitle="Proses refund transaksi pembayaran RFID (7 hari terakhir default)"
          actions={
            <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
              {pagination.total || 0} transaksi
            </span>
          }
        >
          <TableToolbar
            search={
              <SearchInput
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Cari merchant..."
                disabled={!santriId}
              />
            }
          />

          {!santriId ? (
            <EmptyState
              title="Pilih santri terlebih dahulu"
              description="Gunakan pencarian santri di atas untuk menampilkan transaksi payment."
            />
          ) : isLoading ? (
            <EmptyState title="Memuat data..." description="Mohon tunggu sebentar." />
          ) : transaksi.length === 0 ? (
            <EmptyState
              title="Tidak ada transaksi payment"
              description="Coba ubah rentang tanggal atau filter pencarian."
            />
          ) : (
            <>
              <TableScroll>
                <Table>
                  <thead>
                    <tr>
                      <th>Tanggal</th>
                      <th>Merchant</th>
                      <th>Nominal</th>
                      <th>Jenis</th>
                      <th className="table-v3__cell--actions">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {transaksi.map((item) => (
                      <tr key={item.id}>
                        <td className="table-v3__cell--mono">
                          {new Date(item.created_at).toLocaleString()}
                        </td>
                        <td>{item.nama_merchant || "—"}</td>
                        <td className="table-v3__cell--strong">
                          {formatCurrency(item.nominal)}
                        </td>
                        <td>
                          <StatusBadge status={item.trx_type}>
                            {trxTypeLabel(item.trx_type)}
                          </StatusBadge>
                        </td>
                        <td className="table-v3__cell--actions">
                          <TableActions
                            items={[
                              {
                                type: "custom",
                                icon: FaUndo,
                                title: "Refund",
                                variant: "success",
                                hidden: item.trx_type !== "payment",
                                onClick: () => openRefundConfirm(item),
                              },
                            ]}
                          />
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
      </div>

      <Modal
        open={Boolean(confirmItem)}
        title="Konfirmasi Refund RFID"
        onClose={closeRefundConfirm}
        width={480}
      >
        {confirmItem ? (
          <>
            <div className="form-modal-summary-v3">
              <p><strong>Santri:</strong> {confirmItem.nama_santri || selectedSantri?.nama || "—"}</p>
              <p><strong>Nominal:</strong> {formatCurrency(confirmItem.nominal)}</p>
              <p>
                <strong>Tanggal:</strong>{" "}
                {new Date(confirmItem.created_at).toLocaleString("id-ID")}
              </p>
              <p><strong>Merchant:</strong> {confirmItem.nama_merchant || "—"}</p>
              <p><strong>Device:</strong> {confirmItem.device_id || "—"}</p>
            </div>
            <FormActionBar className="form-action-bar-v3--compact">
              <Button onClick={executeRefund} disabled={isRefunding}>
                {isRefunding ? "Memproses..." : "Ya, Refund"}
              </Button>
              <Button variant="outline" onClick={closeRefundConfirm} disabled={isRefunding}>
                Batal
              </Button>
            </FormActionBar>
          </>
        ) : null}
      </Modal>
    </AppShell>
  );
}

export default RFIDRefundPage;
