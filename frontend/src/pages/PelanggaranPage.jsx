import { useEffect, useMemo, useState } from "react";
import { FaSearch } from "react-icons/fa";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import Card from "../components/ui/Card";
import SectionHeading from "../components/ui/SectionHeading";
import Button from "../components/ui/Button";
import DataTableCard from "../components/ui/DataTableCard";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import SearchableSantriSelect from "../components/santri/SearchableSantriSelect";
import {
  OperationalPageStyles,
  resolvePoinTone,
} from "../components/shared/OperationalPageStyles";
import { Table, TableScroll, TableActions, TablePagination, useClientPagination } from "../components/ui/table";
import { LegacyPageStyles } from "../components/shared/PageResponsiveStyles";
import {
  FormField,
  Input,
  Select,
  Textarea,
  FormGrid,
  FormActionBar,
} from "../components/ui/form";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { buildUnitScopeParams, requireActiveUnitForWrite } from "../utils/unitScopeParams";

const FORM_INIT = {
  santri_id: "",
  tanggal: "",
  jam: "",
  jenis: "",
  tingkat: "",
  poin: 0,
  catatan: "",
  tindakan: "",
  petugas: "",
};

function PelanggaranPage() {
  const { activeUnitId, allUnitsAllowed } = useActiveUnit();
  const readScopeParams = useMemo(
    () => buildUnitScopeParams({ activeUnitId, allUnitsAllowed }),
    [activeUnitId, allUnitsAllowed],
  );
  const [pelanggaran, setPelanggaran] = useState([]);
  const [editId, setEditId] = useState(null);
  const [search, setSearch] = useState("");
  const [santri, setSantri] = useState([]);
  const [santriLookupError, setSantriLookupError] = useState("");
  const [form, setForm] = useState(FORM_INIT);

  const getPelanggaran = async () => {
    try {
      const response = await api.get("/pelanggaran", { params: readScopeParams });
      setPelanggaran(response.data.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const getSantri = async () => {
    setSantri([]);
    setSantriLookupError("");
    try {
      const response = await api.get("/pelanggaran/student-lookup", { params: readScopeParams });
      setSantri(response.data.data || []);
    } catch (err) {
      console.error(err);
      setSantriLookupError(err.response?.data?.error || "Gagal memuat daftar santri untuk Pelanggaran.");
    }
  };

  const deletePelanggaran = async (id) => {
    if (!window.confirm("Hapus data ini?")) return;

    try {
      await api.delete(`/pelanggaran/${id}`, { params: { unit_id: activeUnitId } });
      getPelanggaran();
    } catch (err) {
      console.error(err);
      alert("Gagal hapus");
    }
  };

  const editPelanggaran = (p) => {
    setForm({
      santri_id: p.santri_id,
      tanggal: p.tanggal?.split("T")[0],
      jam: p.jam || "",
      jenis: p.jenis,
      tingkat: p.tingkat || "",
      poin: p.poin,
      catatan: p.catatan || "",
      tindakan: p.tindakan || "",
      petugas: p.petugas || "",
    });
    setEditId(p.id);
  };

  const createPelanggaran = async () => {
    try {
      const payload = { ...form, poin: Number(form.poin) };
      const unitPayload = requireActiveUnitForWrite({ activeUnitId });

      if (editId) {
        await api.put(`/pelanggaran/${editId}`, { ...payload, ...unitPayload });
      } else {
        await api.post("/pelanggaran", { ...payload, ...unitPayload });
      }

      alert("Data berhasil disimpan");

      setEditId(null);
      setForm(FORM_INIT);
      getPelanggaran();
    } catch (err) {
      console.error(err);
      alert("Gagal simpan");
    }
  };

  useEffect(() => {
    getPelanggaran();
    setSantri([]);
    setSantriLookupError("");
    setForm((current) => ({ ...current, santri_id: "" }));
    getSantri();
  }, [readScopeParams]);

  const filtered = useMemo(
    () =>
      pelanggaran.filter((p) =>
        p.nama?.toLowerCase().includes(search.toLowerCase()),
      ),
    [pelanggaran, search],
  );

  const { page, setPage, paginatedItems, totalItems, pageSize } = useClientPagination(filtered);

  useEffect(() => {
    setPage(1);
  }, [search, setPage]);

  return (
    <AppShell title="Pelanggaran Santri" breadcrumb="Keamanan / Pelanggaran">
      <LegacyPageStyles />
      <OperationalPageStyles />
      <div className="ops-page legacy-page">
        <div className="ops-page__form-card">
        <Card padding="md" shadow="card" border={false} radius="xl">
          <SectionHeading variant="eyebrow" spacing="first">
            Input Pelanggaran
          </SectionHeading>

          <FormGrid>
            <FormField label="Santri" htmlFor="pel-santri" required>
              <SearchableSantriSelect
                id="pel-santri"
                error={santriLookupError}
                santri={santri}
                value={form.santri_id}
                onChange={(santriId) => setForm({ ...form, santri_id: santriId })}
              />
            </FormField>
            <FormField label="Tanggal" htmlFor="pel-tgl">
              <Input
                id="pel-tgl"
                type="date"
                value={form.tanggal}
                onChange={(e) => setForm({ ...form, tanggal: e.target.value })}
              />
            </FormField>
            <FormField label="Jam" htmlFor="pel-jam">
              <Input
                id="pel-jam"
                type="time"
                value={form.jam}
                onChange={(e) => setForm({ ...form, jam: e.target.value })}
              />
            </FormField>
            <FormField label="Jenis Pelanggaran" htmlFor="pel-jenis">
              <Input
                id="pel-jenis"
                type="text"
                value={form.jenis}
                onChange={(e) => setForm({ ...form, jenis: e.target.value })}
              />
            </FormField>
            <FormField label="Tingkat" htmlFor="pel-tingkat">
              <Select
                id="pel-tingkat"
                value={form.tingkat}
                onChange={(e) => setForm({ ...form, tingkat: e.target.value })}
              >
                <option value="">Pilih Tingkat</option>
                <option value="Ringan">Ringan</option>
                <option value="Sedang">Sedang</option>
                <option value="Berat">Berat</option>
              </Select>
            </FormField>
            <FormField label="Poin" htmlFor="pel-poin">
              <Input
                id="pel-poin"
                type="number"
                value={form.poin}
                onChange={(e) => setForm({ ...form, poin: e.target.value })}
              />
            </FormField>
            <FormField label="Petugas" htmlFor="pel-petugas">
              <Input
                id="pel-petugas"
                type="text"
                value={form.petugas}
                onChange={(e) => setForm({ ...form, petugas: e.target.value })}
              />
            </FormField>
            <FormField label="Catatan" htmlFor="pel-catatan" fullWidth>
              <Textarea
                id="pel-catatan"
                value={form.catatan}
                onChange={(e) => setForm({ ...form, catatan: e.target.value })}
                rows={3}
              />
            </FormField>
            <FormField label="Tindakan" htmlFor="pel-tindakan" fullWidth>
              <Textarea
                id="pel-tindakan"
                value={form.tindakan}
                onChange={(e) => setForm({ ...form, tindakan: e.target.value })}
                rows={3}
              />
            </FormField>
          </FormGrid>

          <FormActionBar className="form-action-bar-v3--compact">
            <Button variant="primary" onClick={createPelanggaran}>
              Simpan
            </Button>
          </FormActionBar>
        </Card>
        </div>

        <div className="ops-page__card">
          <DataTableCard
            title="Daftar Pelanggaran"
            subtitle="Rekap pelanggaran santri"
            border
            actions={
              <span className="ops-page__meta">
                {filtered.length} pelanggaran
              </span>
            }
          >
            <div className="ops-page__filter filter-bar-v3 filter-bar-v3--table">
              <span className="filter-bar-v3__label">
                <FaSearch size={11} aria-hidden />
                Cari pelanggaran
              </span>
              <div className="filter-bar-v3__fields">
                <SearchInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari nama santri..."
                />
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="ops-page__empty">
              <EmptyState
                title={pelanggaran.length === 0 ? "Belum ada pelanggaran" : "Tidak ada hasil pencarian"}
                description={
                  pelanggaran.length === 0
                    ? "Input pelanggaran pertama untuk memulai."
                    : "Coba kata kunci lain atau hapus filter pencarian."
                }
              />
              </div>
            ) : (
              <>
              <TableScroll>
                <Table>
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Kamar / Asrama</th>
                      <th>Tanggal</th>
                      <th>Jenis</th>
                      <th>Poin</th>
                      <th>Tindakan</th>
                      <th>Petugas</th>
                      <th className="table-v3__cell--actions">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedItems.map((p) => (
                      <tr key={p.id}>
                        <td className="table-v3__cell--strong">{p.nama}</td>
                        <td>{p.kamar || "—"}</td>
                        <td>{p.tanggal}</td>
                        <td>{p.jenis}</td>
                        <td>
                          <span className={`ops-poin ops-poin--${resolvePoinTone(p.poin)}`}>
                            {p.poin}
                          </span>
                        </td>
                        <td>{p.tindakan || "—"}</td>
                        <td>{p.petugas || "—"}</td>
                        <td className="table-v3__cell--actions">
                          <TableActions
                            items={[
                              { type: "edit", onClick: () => editPelanggaran(p) },
                              { type: "delete", onClick: () => deletePelanggaran(p.id) },
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
                totalItems={totalItems}
                onPageChange={setPage}
              />
              </>
            )}
          </DataTableCard>
        </div>
      </div>
    </AppShell>
  );
}

export default PelanggaranPage;
