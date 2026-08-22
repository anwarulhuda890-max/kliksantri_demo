import { useEffect, useMemo, useState } from "react";
import { FaSearch, FaSignInAlt } from "react-icons/fa";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import Card from "../components/ui/Card";
import SectionHeading from "../components/ui/SectionHeading";
import Button from "../components/ui/Button";
import DataTableCard from "../components/ui/DataTableCard";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import StatusBadge from "../components/ui/StatusBadge";
import SearchableSantriSelect from "../components/santri/SearchableSantriSelect";
import {
  OperationalPageStyles,
  resolveStatusClass,
} from "../components/shared/OperationalPageStyles";
import { Table, TableScroll, TableActions, TablePagination, useClientPagination } from "../components/ui/table";
import {
  FormField,
  Input,
  Textarea,
  FormGrid,
  FormActionBar,
} from "../components/ui/form";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { buildUnitScopeParams, requireActiveUnitForWrite } from "../utils/unitScopeParams";

function PerizinanPage() {
  const { activeUnitId, allUnitsAllowed } = useActiveUnit();
  const readScopeParams = useMemo(
    () => buildUnitScopeParams({ activeUnitId, allUnitsAllowed }),
    [activeUnitId, allUnitsAllowed],
  );
  const [perizinan, setPerizinan] = useState([]);
  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState(null);
  const [santri, setSantri] = useState([]);
  const [form, setForm] = useState({
    santri_id: "",
    tanggal: "",
    tujuan: "",
    alasan: "",
    tanggal_kembali: "",
    target_jam_kembali: "",
    jam_keluar: "",
    status: "keluar",
    catatan: "",
  });

  const getPerizinan = async () => {
    try {
      const response = await api.get("/perizinan", { params: readScopeParams });
      setPerizinan(response.data.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const getSantri = async () => {
    try {
      const response = await api.get("/santri", { params: readScopeParams });
      setSantri(response.data.data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const createPerizinan = async () => {
    try {
      const unitPayload = requireActiveUnitForWrite({ activeUnitId });
      if (editId) {
        await api.put(`/perizinan/${editId}`, { ...form, ...unitPayload });
      } else {
        await api.post("/perizinan", { ...form, ...unitPayload });
      }

      alert("Data berhasil disimpan");

      setEditId(null);
      setForm({
        santri_id: "",
        tanggal: "",
        tujuan: "",
        alasan: "",
        tanggal_kembali: "",
        target_jam_kembali: "",
        jam_keluar: "",
        status: "keluar",
        catatan: "",
      });

      getPerizinan();
    } catch (err) {
      console.error(err);
      alert("Gagal simpan");
    }
  };

  const kembali = async (id) => {
    try {
      await api.put(`/perizinan/kembali/${id}`, { unit_id: activeUnitId });
      getPerizinan();
    } catch (err) {
      console.error(err);
    }
  };

  const editPerizinan = (p) => {
    setForm({
      santri_id: p.santri_id,
      tanggal: p.tanggal?.split("T")[0],
      tujuan: p.tujuan || "",
      alasan: p.alasan || "",
      tanggal_kembali: p.tanggal_kembali?.split("T")[0] || "",
      target_jam_kembali: p.target_jam_kembali || "",
      jam_keluar: p.jam_keluar || "",
      status: p.status || "keluar",
      catatan: p.catatan || "",
    });
    setEditId(p.id);
  };

  const deletePerizinan = async (id) => {
    if (!window.confirm("Hapus data ini?")) return;

    try {
      await api.delete(`/perizinan/${id}`, { params: { unit_id: activeUnitId } });
      getPerizinan();
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    getPerizinan();
    getSantri();
  }, [readScopeParams]);

  const filtered = useMemo(
    () =>
      perizinan.filter((p) =>
        p.nama?.toLowerCase().includes(search.toLowerCase()),
      ),
    [perizinan, search],
  );

  const { page, setPage, paginatedItems, totalItems, pageSize } = useClientPagination(filtered);

  useEffect(() => {
    setPage(1);
  }, [search, setPage]);

  return (
    <AppShell title="Perizinan Santri" breadcrumb="Keamanan / Perizinan">
      <OperationalPageStyles />
      <div className="ops-page">
        <div className="ops-page__form-card">
        <Card padding="md" shadow="card" border={false} radius="xl">
          <SectionHeading variant="eyebrow" spacing="first">
            Input Perizinan
          </SectionHeading>

          <FormGrid>
            <FormField label="Santri" htmlFor="izin-santri" required>
              <SearchableSantriSelect
                id="izin-santri"
                santri={santri}
                value={form.santri_id}
                onChange={(santriId) => setForm({ ...form, santri_id: santriId })}
              />
            </FormField>
            <FormField label="Tanggal Keluar" htmlFor="izin-tgl">
              <Input
                id="izin-tgl"
                type="date"
                value={form.tanggal}
                onChange={(e) => setForm({ ...form, tanggal: e.target.value })}
              />
            </FormField>
            <FormField label="Jam Keluar" htmlFor="izin-jam-keluar">
              <Input
                id="izin-jam-keluar"
                type="time"
                value={form.jam_keluar}
                onChange={(e) => setForm({ ...form, jam_keluar: e.target.value })}
              />
            </FormField>
            <FormField label="Tujuan" htmlFor="izin-tujuan">
              <Input
                id="izin-tujuan"
                type="text"
                value={form.tujuan}
                onChange={(e) => setForm({ ...form, tujuan: e.target.value })}
              />
            </FormField>
            <FormField label="Tanggal Kembali" htmlFor="izin-tgl-kembali">
              <Input
                id="izin-tgl-kembali"
                type="date"
                value={form.tanggal_kembali}
                onChange={(e) => setForm({ ...form, tanggal_kembali: e.target.value })}
              />
            </FormField>
            <FormField label="Target Jam Kembali" htmlFor="izin-jam-kembali">
              <Input
                id="izin-jam-kembali"
                type="time"
                value={form.target_jam_kembali}
                onChange={(e) => setForm({ ...form, target_jam_kembali: e.target.value })}
              />
            </FormField>
            <FormField label="Alasan" htmlFor="izin-alasan" fullWidth>
              <Textarea
                id="izin-alasan"
                value={form.alasan}
                onChange={(e) => setForm({ ...form, alasan: e.target.value })}
                rows={3}
              />
            </FormField>
            <FormField label="Catatan" htmlFor="izin-catatan" fullWidth>
              <Textarea
                id="izin-catatan"
                value={form.catatan}
                onChange={(e) => setForm({ ...form, catatan: e.target.value })}
                rows={3}
              />
            </FormField>
          </FormGrid>

          <FormActionBar className="form-action-bar-v3--compact">
            <Button variant="primary" onClick={createPerizinan}>
              Simpan
            </Button>
          </FormActionBar>
        </Card>
        </div>

        <div className="ops-page__card">
          <DataTableCard
            title="Daftar Perizinan"
            subtitle="Kelola izin keluar santri"
            border
            actions={
              <span className="ops-page__meta">
                {filtered.length} perizinan
              </span>
            }
          >
            <div className="ops-page__filter filter-bar-v3 filter-bar-v3--table">
              <span className="filter-bar-v3__label">
                <FaSearch size={11} aria-hidden />
                Cari perizinan
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
                title={perizinan.length === 0 ? "Belum ada perizinan" : "Tidak ada hasil pencarian"}
                description={
                  perizinan.length === 0
                    ? "Input perizinan pertama untuk memulai."
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
                      <th>Tujuan</th>
                      <th>Alasan</th>
                      <th>Keluar</th>
                      <th>Target Kembali</th>
                      <th>Jam Kembali</th>
                      <th>Catatan</th>
                      <th>Status</th>
                      <th className="table-v3__cell--actions">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedItems.map((p) => (
                      <tr key={p.id}>
                        <td className="table-v3__cell--strong">{p.nama}</td>
                        <td>{p.kamar || "—"}</td>
                        <td>{p.tanggal}</td>
                        <td>{p.tujuan || "—"}</td>
                        <td>{p.alasan || "—"}</td>
                        <td>{p.jam_keluar}</td>
                        <td>{p.tanggal_kembali || "—"}</td>
                        <td>{p.jam_kembali || "—"}</td>
                        <td>{p.catatan || "—"}</td>
                        <td>
                          <span className={`ops-status ops-status--${resolveStatusClass(p.status)}`}>
                            <StatusBadge status={p.status} />
                          </span>
                        </td>
                        <td className="table-v3__cell--actions">
                          <TableActions
                            items={[
                              { type: "edit", onClick: () => editPerizinan(p) },
                              { type: "delete", onClick: () => deletePerizinan(p.id) },
                              {
                                type: "custom",
                                icon: FaSignInAlt,
                                title: "Kembali",
                                variant: "success",
                                hidden: p.status !== "keluar",
                                onClick: () => kembali(p.id),
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

export default PerizinanPage;
