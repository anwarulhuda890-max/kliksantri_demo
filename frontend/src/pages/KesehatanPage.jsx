import { useCallback, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import Card from "../components/ui/Card";
import SectionHeading from "../components/ui/SectionHeading";
import Button from "../components/ui/Button";
import StatusBadge from "../components/ui/StatusBadge";
import DataTableCard from "../components/ui/DataTableCard";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import SearchableSantriSelect from "../components/santri/SearchableSantriSelect";
import { Table, TableScroll, TableActions, TablePagination } from "../components/ui/table";
import { LegacyPageStyles } from "../components/shared/PageResponsiveStyles";
import {
  OperationalPageStyles,
  resolveHealthClass,
} from "../components/shared/OperationalPageStyles";
import { FaSearch } from "react-icons/fa";
import {
  FormField,
  Select,
  Textarea,
  FormGrid,
  FormActionBar,
} from "../components/ui/form";
import { hasPermission } from "../utils/hasPermission";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { buildUnitScopeParams, requireActiveUnitForWrite } from "../utils/unitScopeParams";

const FORM_INIT = {
  santri_id: "",
  status_kesehatan: "sehat",
  keluhan: "",
  tindakan_pertama: "",
  status_penanganan: "observasi",
};

const PENANGANAN_OPTIONS = [
  { value: "observasi", label: "Observasi" },
  { value: "istirahat", label: "Istirahat" },
  { value: "sudah_berobat", label: "Sudah Berobat" },
  { value: "pulang", label: "Pulang" },
  { value: "rawat_lanjut", label: "Rawat Lanjut" },
];

function canManageUser() {
  return hasPermission("kesehatan.manage");
}

function formatDt(dt) {
  if (!dt) return "-";
  return new Date(dt).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function penangananLabel(value) {
  return PENANGANAN_OPTIONS.find((o) => o.value === value)?.label ?? value ?? "-";
}

function KesehatanPage() {
  const { activeUnitId, allUnitsAllowed } = useActiveUnit();
  const readScopeParams = useMemo(
    () => buildUnitScopeParams({ activeUnitId, allUnitsAllowed }),
    [activeUnitId, allUnitsAllowed],
  );
  const canManage = canManageUser();
  const [list, setList] = useState([]);
  const [editId, setEditId] = useState(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [santri, setSantri] = useState([]);
  const [santriLookupError, setSantriLookupError] = useState("");
  const [form, setForm] = useState(FORM_INIT);

  const getList = useCallback(async () => {
    try {
      setLoading(true);
      const params = { page, limit: pageSize };
      Object.assign(params, readScopeParams);
      if (search.trim()) params.search = search.trim();
      if (statusFilter) params.status_kesehatan = statusFilter;
      const res = await api.get("/kesehatan", { params });
      setList(res.data.data || []);
      setTotal(res.data.pagination?.total || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, readScopeParams, search, statusFilter]);

  const getSantri = async () => {
    setSantri([]);
    setSantriLookupError("");
    try {
      const response = await api.get("/kesehatan/student-lookup", { params: readScopeParams });
      setSantri(response.data.data || []);
    } catch (err) {
      console.error(err);
      setSantriLookupError(err.response?.data?.error || "Gagal memuat daftar santri untuk Kesehatan.");
    }
  };

  const deleteRow = async (id) => {
    if (!canManage) return;
    if (!window.confirm("Hapus data kesehatan ini?")) return;
    try {
      await api.delete(`/kesehatan/${id}`, { params: { unit_id: activeUnitId } });
      getList();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || "Gagal hapus");
    }
  };

  const editRow = (row) => {
    setForm({
      santri_id: String(row.santri_id),
      status_kesehatan: row.status_kesehatan || "sehat",
      keluhan: row.keluhan || "",
      tindakan_pertama: row.tindakan_pertama || "",
      status_penanganan: row.status_penanganan || "observasi",
    });
    setEditId(row.id);
  };

  const save = async () => {
    if (!canManage) return;
    try {
      const payload = {
        ...form,
        santri_id: Number(form.santri_id),
        ...requireActiveUnitForWrite({ activeUnitId }),
      };
      if (editId) {
        await api.put(`/kesehatan/${editId}`, payload);
      } else {
        await api.post("/kesehatan", payload);
      }
      alert("Data berhasil disimpan");
      setEditId(null);
      setForm(FORM_INIT);
      getList();
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.error || "Gagal simpan");
    }
  };

  useEffect(() => {
    setSantri([]);
    setSantriLookupError("");
    setForm((current) => ({ ...current, santri_id: "" }));
    getSantri();
  }, [readScopeParams]);

  useEffect(() => {
    getList();
  }, [getList]);

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter]);

  const totalPages = Math.max(Math.ceil(total / pageSize), 1);

  const formDisabled = !canManage;

  return (
    <AppShell title="Kesehatan Santri" breadcrumb="Keamanan / Kesehatan">
      <LegacyPageStyles />
      <OperationalPageStyles />
      <div className="ops-page">
        {canManage ? (
          <div className="ops-page__form-card">
          <Card padding="md" shadow="card" border={false} radius="xl">
            <SectionHeading variant="eyebrow" spacing="first">
              {editId ? "Edit Catatan Kesehatan" : "Tambah Catatan Kesehatan"}
            </SectionHeading>
            <FormGrid>
              <FormField label="Santri" htmlFor="kes-santri" required>
                <SearchableSantriSelect
                  id="kes-santri"
                  error={santriLookupError}
                  santri={santri}
                  value={form.santri_id}
                  onChange={(santriId) => setForm({ ...form, santri_id: santriId })}
                />
              </FormField>
              <FormField label="Status Kesehatan" htmlFor="kes-status">
                <Select
                  id="kes-status"
                  value={form.status_kesehatan}
                  onChange={(e) => setForm({ ...form, status_kesehatan: e.target.value })}
                >
                  <option value="sehat">Sehat</option>
                  <option value="sakit">Sakit</option>
                </Select>
              </FormField>
              <FormField label="Status Penanganan" htmlFor="kes-penanganan">
                <Select
                  id="kes-penanganan"
                  value={form.status_penanganan}
                  onChange={(e) => setForm({ ...form, status_penanganan: e.target.value })}
                >
                  {PENANGANAN_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="Keluhan" htmlFor="kes-keluhan" fullWidth>
                <Textarea
                  id="kes-keluhan"
                  rows={3}
                  value={form.keluhan}
                  onChange={(e) => setForm({ ...form, keluhan: e.target.value })}
                  placeholder={form.status_kesehatan === "sakit" ? "Wajib jika sakit" : "Opsional"}
                />
              </FormField>
              <FormField label="Tindakan Pertama" htmlFor="kes-tindakan" fullWidth>
                <Textarea
                  id="kes-tindakan"
                  rows={3}
                  value={form.tindakan_pertama}
                  onChange={(e) => setForm({ ...form, tindakan_pertama: e.target.value })}
                  placeholder={form.status_kesehatan === "sakit" ? "Wajib jika sakit" : "Opsional"}
                />
              </FormField>
            </FormGrid>
            <FormActionBar className="form-action-bar-v3--compact">
              <Button type="button" variant="primary" onClick={save} disabled={formDisabled}>
                {editId ? "Simpan Perubahan" : "Simpan"}
              </Button>
              {editId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditId(null);
                    setForm(FORM_INIT);
                  }}
                >
                  Batal Edit
                </Button>
              ) : null}
            </FormActionBar>
          </Card>
          </div>
        ) : null}

        <div className="ops-page__card">
          <DataTableCard
            title="Data Kesehatan Santri"
            subtitle="Pantau kondisi dan penanganan santri"
            border
            toolbar={
              <div className="ops-page__filter filter-bar-v3 filter-bar-v3--table">
                <span className="filter-bar-v3__label">
                  <FaSearch size={11} aria-hidden />
                  Cari
                </span>
                <div className="filter-bar-v3__fields">
                <SearchInput
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cari nama santri..."
                />
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  style={{ minWidth: 140 }}
                  aria-label="Filter status kesehatan"
                >
                  <option value="">Semua Status</option>
                  <option value="sehat">Sehat</option>
                  <option value="sakit">Sakit</option>
                </Select>
                </div>
              </div>
            }
          >
            {loading ? (
              <p style={{ padding: "var(--space-4)", color: "var(--text-secondary)" }}>Memuat data...</p>
            ) : list.length === 0 ? (
              <div className="ops-page__empty">
              <EmptyState title="Belum ada data" description="Catatan kesehatan santri akan tampil di sini." />
              </div>
            ) : (
              <>
                <TableScroll>
                  <Table>
                    <thead>
                      <tr>
                        <th>Nama Santri</th>
                        <th>Kamar / Asrama</th>
                        <th>Status</th>
                        <th>Keluhan</th>
                        <th>Tindakan Pertama</th>
                        <th>Penanganan</th>
                        <th>Tanggal</th>
                        {canManage ? <th>Aksi</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((row) => (
                        <tr key={row.id}>
                          <td>{row.nama_santri || "-"}</td>
                          <td>{row.kamar || "-"}</td>
                          <td>
                            <span className={`ops-health ops-health--${resolveHealthClass(row.status_kesehatan)}`}>
                              <StatusBadge status={row.status_kesehatan === "sakit" ? "danger" : "success"}>
                                {row.status_kesehatan}
                              </StatusBadge>
                            </span>
                          </td>
                          <td>{row.keluhan || "-"}</td>
                          <td>{row.tindakan_pertama || "-"}</td>
                          <td>{penangananLabel(row.status_penanganan)}</td>
                          <td>{formatDt(row.created_at)}</td>
                          {canManage ? (
                            <td>
                              <TableActions
                                items={[
                                  { type: "edit", onClick: () => editRow(row) },
                                  { type: "delete", onClick: () => deleteRow(row.id) },
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
                  totalPages={totalPages}
                  totalItems={total}
                  pageSize={pageSize}
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

export default KesehatanPage;
