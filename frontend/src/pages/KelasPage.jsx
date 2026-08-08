import { useEffect, useMemo, useState } from "react";
import { FaLayerGroup, FaSearch } from "react-icons/fa";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import DataTableCard from "../components/ui/DataTableCard";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import { OperationalPageStyles } from "../components/shared/OperationalPageStyles";
import { Table, TableScroll, TableActions } from "../components/ui/table";
import { FormField, Input, Select, FormGrid, FormActionBar } from "../components/ui/form";
import { exportExcel } from "../utils/exportExcel";
import { formatNumber } from "../utils/formatCurrency";
import { useActiveUnit } from "../context/ActiveUnitContext";

function KelasPage() {
  const { activeUnitId, activeUnit, allUnitsAllowed } = useActiveUnit();
  const [kelas, setKelas] = useState([]);
  const [namaKelas, setNamaKelas] = useState("");
  const [tableSearch, setTableSearch] = useState("");

  const getKelas = async () => {
    try {
      const response = await api.get("/kelas", {
        params: activeUnitId ? { unit_id: activeUnitId } : (allUnitsAllowed ? { scope: "all" } : {}),
      });
      setKelas(response.data.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    // Loading classes synchronizes this page with the selected external API scope.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    getKelas();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUnitId]);

  const filteredKelas = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return kelas;
    return kelas.filter((item) =>
      [item.id, item.nama_kelas].some((field) => String(field || "").toLowerCase().includes(q)),
    );
  }, [kelas, tableSearch]);

  const addKelas = async () => {
    try {
      if (!activeUnitId) return;
      await api.post("/kelas", {
        nama_kelas: namaKelas,
        unit_id: activeUnitId,
      });

      setNamaKelas("");
      getKelas();
    } catch (err) {
      console.error(err);
    }
  };

  const deleteKelas = async (id) => {
    try {
      await api.delete(`/kelas/${id}`, { params: { unit_id: activeUnitId } });
      getKelas();
    } catch (err) {
      console.error(err);
    }
  };

  const handleExport = () => {
    const rows = kelas.map((item) => ({
      ID: item.id,
      NamaKelas: item.nama_kelas,
    }));

    exportExcel(rows, "Kelas");
  };

  return (
    <AppShell title="Data Kelas" breadcrumb="Master Data / Kelas">
      <OperationalPageStyles />
      <div className="ops-page">
        <p className="ops-page__meta">
          Workspace: {activeUnit?.nama || (allUnitsAllowed ? "Semua Unit" : "Unit belum dipilih")}
          {!activeUnitId && allUnitsAllowed ? " — pilih satu unit untuk mengelola kelas." : ""}
        </p>
        <div className="ops-page__summary" style={{ gridTemplateColumns: "repeat(1, minmax(0, 240px))" }}>
          <div className="ops-page__stat">
            <span className="ops-page__stat-label">Total Kelas</span>
            <span className="ops-page__stat-value">{formatNumber(kelas.length)}</span>
          </div>
        </div>

        <div className="ops-page__form-card">
          <Card padding="md" shadow="card" border={false} radius="xl">
            <FormGrid columns="single">
              <FormField label="Nama Kelas" htmlFor="kelas-nama" required>
                <Input
                  id="kelas-nama"
                  type="text"
                  value={namaKelas}
                  onChange={(e) => setNamaKelas(e.target.value)}
                  placeholder="Contoh: Kelas 1A"
                />
              </FormField>
              <FormField label="Unit Pendidikan" htmlFor="kelas-unit" required>
                <Select id="kelas-unit" value={activeUnitId || ""} disabled>
                  <option value="">Pilih unit melalui selector workspace</option>
                  {activeUnit ? <option value={activeUnit.id}>{activeUnit.nama}</option> : null}
                </Select>
              </FormField>
            </FormGrid>
            <FormActionBar className="form-action-bar-v3--compact">
              <Button variant="primary" onClick={addKelas} disabled={!activeUnitId}>
                Tambah
              </Button>
            </FormActionBar>
          </Card>
        </div>

        <div className="ops-page__card">
          <DataTableCard
            title="Daftar Kelas"
            subtitle="Kelola data kelas pesantren"
            border
            actions={
              <span className="ops-page__meta">
                {filteredKelas.length} kelas
              </span>
            }
          >
            <div className="ops-page__filter filter-bar-v3 filter-bar-v3--table">
              <span className="filter-bar-v3__label">
                <FaSearch size={11} aria-hidden />
                Cari kelas
              </span>
              <div className="filter-bar-v3__fields">
                <SearchInput
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  placeholder="Cari ID atau nama kelas..."
                />
              </div>
              <div className="ops-page__filter-actions">
                <Button variant="success" onClick={handleExport}>
                  Export Excel
                </Button>
              </div>
            </div>

            {filteredKelas.length === 0 ? (
              <div className="ops-page__empty">
                <EmptyState
                  title={kelas.length === 0 ? "Belum ada data" : "Tidak ada hasil pencarian"}
                  description={
                    kelas.length === 0
                      ? "Tambahkan data pertama untuk memulai."
                      : "Coba kata kunci lain atau hapus filter pencarian."
                  }
                />
              </div>
            ) : (
              <TableScroll>
                <Table>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Nama Kelas</th>
                      <th>Unit</th>
                      <th className="table-v3__cell--actions">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredKelas.map((item) => (
                      <tr key={item.id}>
                        <td className="table-v3__cell--muted">{item.id}</td>
                        <td className="table-v3__cell--strong">
                          <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                            <FaLayerGroup size={12} color="var(--primary)" aria-hidden />
                            {item.nama_kelas}
                          </span>
                        </td>
                        <td>{item.unit_nama || "—"}</td>
                        <td className="table-v3__cell--actions">
                          <TableActions
                            items={activeUnitId ? [{ type: "delete", onClick: () => deleteKelas(item.id) }] : []}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableScroll>
            )}
          </DataTableCard>
        </div>
      </div>
    </AppShell>
  );
}

export default KelasPage;
