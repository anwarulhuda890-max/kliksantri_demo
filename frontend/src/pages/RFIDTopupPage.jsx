import { useEffect, useMemo, useState } from "react";
import AppShell from "../layouts/AppShell";
import api, { API_BASE_URL } from "../services/api";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import DataTableCard from "../components/ui/DataTableCard";
import TableToolbar from "../components/ui/TableToolbar";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import { Table, TableScroll } from "../components/ui/table";
import { FormField, Input, FormGrid, FormActionBar } from "../components/ui/form";
import { getUser } from "../utils/storage";
import { formatCurrency } from "../utils/formatCurrency";
import SantriSearchPicker from "../components/rfid/SantriSearchPicker";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { buildUnitScopeParams, requireActiveUnitForWrite } from "../utils/unitScopeParams";

function getApiError(err, fallback = "Terjadi kesalahan. Silakan coba lagi.") {
  return err?.response?.data?.error || fallback;
}

function isSantriNonAktif(status) {
  const normalized = String(status ?? "aktif").trim().toLowerCase();
  return normalized !== "aktif" && normalized !== "active" && normalized !== "";
}

function RFIDTopupPage() {
  const { activeUnitId, allUnitsAllowed } = useActiveUnit();
  const readScopeParams = useMemo(
    () => buildUnitScopeParams({ activeUnitId, allUnitsAllowed }),
    [activeUnitId, allUnitsAllowed],
  );
  const writeScopeParams = useMemo(
    () => (activeUnitId ? { unit_id: activeUnitId } : null),
    [activeUnitId],
  );
  const [santriId, setSantriId] = useState("");
  const [selectedSantri, setSelectedSantri] = useState(null);
  const [nominal, setNominal] = useState("");
  const [tableSearch, setTableSearch] = useState("");
  const [tableResults, setTableResults] = useState([]);
  const [isSearchingTable, setIsSearchingTable] = useState(false);
  const [isTopupLoading, setIsTopupLoading] = useState(false);

  useEffect(() => {
    const q = tableSearch.trim();
    if (!q) {
      setTableResults([]);
      return undefined;
    }

    const timer = setTimeout(async () => {
      setIsSearchingTable(true);
      try {
        const res = await api.get("/rfid/santri/search", {
          params: { ...readScopeParams, search: q, limit: 20 },
        });
        setTableResults(res.data.data || []);
      } catch (err) {
        console.error(err);
        setTableResults([]);
      } finally {
        setIsSearchingTable(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [readScopeParams, tableSearch]);

  const submitTopup = async () => {
    const user = getUser() || {};

    if (!user?.id) {
      alert("User tidak ditemukan");
      return;
    }

    if (!santriId) {
      alert("Pilih santri terlebih dahulu");
      return;
    }

    if (!nominal || Number(nominal) <= 0) {
      alert("Nominal topup harus lebih dari 0");
      return;
    }

    if (selectedSantri && isSantriNonAktif(selectedSantri.status)) {
      alert("Santri nonaktif tidak dapat melakukan topup saldo");
      return;
    }

    let unitPayload;
    try {
      unitPayload = requireActiveUnitForWrite({ activeUnitId });
    } catch (err) {
      alert(err.message);
      return;
    }

    if (isTopupLoading) return;

    setIsTopupLoading(true);

    try {
      const res = await api.post("/rfid/topup", {
        santri_id: Number(santriId),
        nominal: Number(nominal),
        user_id: user.id,
        ...unitPayload,
      });

      const saldoAwal = Number(res.data.saldo_awal || 0);
      const saldoAkhir = Number(res.data.saldo_akhir || 0);

      setSelectedSantri((prev) => (prev ? { ...prev, saldo: saldoAkhir } : prev));

      alert(
        `Topup berhasil untuk ${selectedSantri?.nama || "santri"}.\n\nNominal: ${formatCurrency(Number(nominal))}\nSaldo sebelumnya: ${formatCurrency(saldoAwal)}\nSaldo terbaru: ${formatCurrency(saldoAkhir)}`,
      );

      setNominal("");
    } catch (err) {
      console.error(err);
      alert(getApiError(err, "Topup gagal"));
    } finally {
      setIsTopupLoading(false);
    }
  };

  const saldoTampil = Number(selectedSantri?.saldo || 0);
  const isNonAktif = selectedSantri ? isSantriNonAktif(selectedSantri.status) : false;

  return (
    <AppShell
      title="Topup Saldo"
      description="Tambah saldo Dompet Santri tanpa memerlukan kartu"
      breadcrumb="Keuangan / Dompet Santri / Topup"
    >
      <Card padding="md" shadow="card" border={false} radius="xl">
        <FormGrid>
          <SantriSearchPicker
            id="topup-santri"
            label="Santri"
            value={santriId}
            onChange={setSantriId}
            onSelect={setSelectedSantri}
            selectedSantri={selectedSantri}
            params={writeScopeParams}
            disabled={isTopupLoading}
            required
          />
          <FormField label="Nominal" htmlFor="topup-nominal" required>
            <Input
              id="topup-nominal"
              type="number"
              value={nominal}
              onChange={(e) => setNominal(e.target.value)}
              disabled={isTopupLoading}
            />
          </FormField>
        </FormGrid>

        {selectedSantri ? (
          <div className="form-modal-summary-v3" style={{ marginTop: "var(--space-4)" }}>
            <p><strong>Santri:</strong> {selectedSantri.nama} · Kamar/Asrama: {selectedSantri.kamar || "—"}</p>
            <p><strong>NIS:</strong> {selectedSantri.nis || "—"}</p>
            <p><strong>UID Kartu:</strong> {selectedSantri.uid_rfid || "—"}</p>
            <p><strong>Saldo Saat Ini:</strong> {formatCurrency(saldoTampil)}</p>
            {isNonAktif && saldoTampil > 0 ? (
              <p style={{ color: "var(--warning, #b45309)", fontWeight: 600 }}>
                Santri nonaktif masih memiliki saldo dompet {formatCurrency(saldoTampil)}.
              </p>
            ) : null}
            {isNonAktif ? (
              <p style={{ color: "var(--danger, #dc2626)", fontWeight: 600 }}>
                Topup saldo tidak tersedia untuk santri nonaktif.
              </p>
            ) : null}
          </div>
        ) : null}

        <FormActionBar className="form-action-bar-v3--compact">
          <Button
            type="button"
            variant="primary"
            onClick={submitTopup}
            disabled={isTopupLoading || isNonAktif}
          >
            {isTopupLoading ? "Memproses..." : "Topup Saldo"}
          </Button>
        </FormActionBar>
      </Card>

      <div style={{ marginTop: "var(--space-6)" }}>
        <DataTableCard
          title="Saldo Santri"
          subtitle="Cari dengan nama atau NIS; kartu RFID bersifat opsional"
          actions={
            <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
              {tableResults.length} hasil
            </span>
          }
        >
          <TableToolbar
            search={
              <SearchInput
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="Cari NIS, nama, UID kartu..."
              />
            }
            actions={
              <Button
                type="button"
                variant="success"
                onClick={() => {
                  const params = new URLSearchParams();
                  Object.entries(readScopeParams).forEach(([key, value]) => params.set(key, value));
                  window.open(`${API_BASE_URL}/rfid/topup/export?${params.toString()}`, "_blank");
                }}
              >
                Export Excel
              </Button>
            }
          />

          {!tableSearch.trim() ? (
            <EmptyState
              title="Ketik kata kunci pencarian"
              description="Data santri tidak dimuat otomatis. Gunakan kolom pencarian di atas."
            />
          ) : isSearchingTable ? (
            <EmptyState title="Mencari..." description="Mohon tunggu sebentar." />
          ) : tableResults.length === 0 ? (
            <EmptyState title="Tidak ada hasil" description="Coba kata kunci lain." />
          ) : (
            <TableScroll>
              <Table>
                <thead>
                  <tr>
                    <th>NIS</th>
                    <th>Nama</th>
                    <th>Kamar / Asrama</th>
                    <th>Kelas</th>
                    <th>UID RFID</th>
                    <th>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {tableResults.map((s) => (
                    <tr key={s.id}>
                      <td>{s.nis || "—"}</td>
                      <td className="table-v3__cell--strong">{s.nama}</td>
                      <td>{s.kamar || "—"}</td>
                      <td>{s.nama_kelas || "—"}</td>
                      <td className="table-v3__cell--mono">{s.uid_rfid || "—"}</td>
                      <td className="table-v3__cell--strong">
                        {formatCurrency(Number(s.saldo || 0))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}
        </DataTableCard>
      </div>
    </AppShell>
  );
}

export default RFIDTopupPage;
