import { useEffect, useMemo, useState } from "react";
import AppShell from "../layouts/AppShell";
import api from "../services/api";
import * as XLSX from "xlsx";
import Card from "../components/ui/Card";
import StatusBadge from "../components/ui/StatusBadge";
import Button from "../components/ui/Button";
import DataTableCard from "../components/ui/DataTableCard";
import TableToolbar from "../components/ui/TableToolbar";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import { Table, TableScroll, TablePagination, useClientPagination } from "../components/ui/table";
import { FilterBar, FormField, Select } from "../components/ui/form";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { buildUnitScopeParams } from "../utils/unitScopeParams";

function trxTypeLabel(trxType) {
  if (trxType === "topup") return "TOPUP";
  if (trxType === "payment") return "PEMBAYARAN";
  if (trxType === "refund") return "REFUND";
  if (trxType === "withdrawal") return "PENARIKAN";
  return String(trxType || "").toUpperCase();
}

function RFIDMutasiPage() {
  const { activeUnitId, allUnitsAllowed } = useActiveUnit();
  const readScopeParams = useMemo(
    () => buildUnitScopeParams({ activeUnitId, allUnitsAllowed }),
    [activeUnitId, allUnitsAllowed],
  );
  const [santri, setSantri] = useState([]);
  const [infoSantri, setInfoSantri] = useState(null);
  const [selectedSantri, setSelectedSantri] = useState("");
  const [mutasi, setMutasi] = useState([]);
  const [tableSearch, setTableSearch] = useState("");

  const loadSantri = async () => {
    try {
      const res = await api.get("/santri", { params: readScopeParams });
      setSantri(res.data.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const loadMutasi = async () => {
    if (!selectedSantri || !activeUnitId) return;

    try {
      const res = await api.get("/rfid/mutasi", {
        params: { unit_id: activeUnitId, santri_id: selectedSantri },
      });
      const rows = res.data.data || [];

      

      setMutasi(rows);

      if (rows.length > 0) {
        setInfoSantri({
          nama: rows[0].nama,
          uid_rfid: rows[0].uid_rfid,
          saldo: rows[0].saldo,
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadSantri();
  }, [readScopeParams]);

  useEffect(() => {
    loadMutasi();
  }, [activeUnitId, selectedSantri]);

  const filteredMutasi = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return mutasi;
    return mutasi.filter((item) =>
      [item.trx_type, item.nominal, item.saldo_awal, item.saldo_akhir, item.trx_id, item.created_at]
        .some((field) => String(field || "").toLowerCase().includes(q)),
    );
  }, [mutasi, tableSearch]);

  const { page, setPage, paginatedItems, totalItems, pageSize } = useClientPagination(filteredMutasi);

  useEffect(() => {
    setPage(1);
  }, [tableSearch, selectedSantri, setPage]);

  const exportExcel = () => {
    if (mutasi.length === 0) {
      alert("Tidak ada data");
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(mutasi);
    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(workbook, worksheet, "Mutasi Dompet");

    XLSX.writeFile(workbook, "mutasi-rfid.xlsx");
  };

  return (
    <AppShell
      title="Mutasi Dompet"
      description="Riwayat perubahan saldo Dompet Santri"
      breadcrumb="Keuangan / Dompet Santri / Mutasi"
    >
      <Card padding="sm" shadow="card" border={false} radius="xl">
        <FilterBar label="Filter" className="rfid-filter-compact">
          <FormField label="Santri" htmlFor="mutasi-santri" className="rfid-filter-santri">
            <Select
              id="mutasi-santri"
              value={selectedSantri}
              onChange={(e) => setSelectedSantri(e.target.value)}
            >
              <option value="">Pilih Santri</option>
              {santri.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nama}
                </option>
              ))}
            </Select>
          </FormField>
        </FilterBar>
      </Card>

      <div style={{ marginTop: "var(--space-6)" }}>
        <DataTableCard
          title="Mutasi Saldo"
          subtitle={
            infoSantri
              ? `${infoSantri.nama} · Kamar/Asrama ${infoSantri.kamar || "—"} · UID ${infoSantri.uid_rfid} · Saldo Rp ${Number(infoSantri.saldo).toLocaleString()}`
              : "Pilih santri untuk melihat mutasi saldo"
          }
          actions={
            <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
              {filteredMutasi.length} mutasi
            </span>
          }
        >
          <TableToolbar
            search={
              <SearchInput
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Cari jenis, nominal, TRX ID..."
                disabled={!selectedSantri}
              />
            }
            actions={
              <Button variant="success" onClick={exportExcel}>
                Export Excel
              </Button>
            }
          />

          {!selectedSantri ? (
            <EmptyState
              title="Pilih santri terlebih dahulu"
              description="Pilih santri untuk menampilkan riwayat perubahan saldo dompet."
            />
          ) : filteredMutasi.length === 0 ? (
            <EmptyState
              title={mutasi.length === 0 ? "Belum ada mutasi" : "Tidak ada hasil pencarian"}
              description={
                mutasi.length === 0
                  ? "Mutasi saldo akan muncul setelah ada transaksi."
                  : "Coba kata kunci lain atau hapus filter pencarian."
              }
            />
          ) : (
            <>
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <th>Tanggal</th>
                    <th>Jenis</th>
                    <th>Nominal</th>
                    <th>Saldo Awal</th>
                    <th>Saldo Akhir</th>
                    <th>TRX ID</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map((item) => (
                    <tr key={item.trx_id}>
                      <td className="table-v3__cell--mono">
                        {new Date(item.created_at).toLocaleString()}
                      </td>
                      <td>
                        <StatusBadge status={item.trx_type}>
                          {trxTypeLabel(item.trx_type)}
                        </StatusBadge>
                      </td>
                      <td className="table-v3__cell--strong">
                        Rp {Number(item.nominal).toLocaleString()}
                      </td>
                      <td>Rp {Number(item.saldo_awal).toLocaleString()}</td>
                      <td>Rp {Number(item.saldo_akhir).toLocaleString()}</td>
                      <td className="table-v3__cell--mono">{item.trx_id}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
            <TablePagination
              page={page}
              pageSize={pageSize}
              totalItems={totalItems}
              onPageChange={setPage}
            />
            </>
          )}        </DataTableCard>
      </div>
    </AppShell>
  );
}

export default RFIDMutasiPage;
