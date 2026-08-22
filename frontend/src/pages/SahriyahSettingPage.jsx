import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import Modal from "../components/Modal";
import Button from "../components/ui/Button";
import DataTableCard from "../components/ui/DataTableCard";
import TableToolbar from "../components/ui/TableToolbar";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import { Table, TableScroll, TableActions } from "../components/ui/table";
import {
  FormField,
  Input,
  Textarea,
  FormGrid,
  FormActionBar,
} from "../components/ui/form";
import { KeuanganPageStyles } from "../components/shared/PageResponsiveStyles";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { buildUnitScopeParams, requireActiveUnitForWrite } from "../utils/unitScopeParams";

function SahriyahSettingPage() {
  const { activeUnitId, allUnitsAllowed } = useActiveUnit();
  const readScopeParams = useMemo(
    () => buildUnitScopeParams({ activeUnitId, allUnitsAllowed }),
    [activeUnitId, allUnitsAllowed],
  );
  const [data, setData] = useState([]);
  const [tableSearch, setTableSearch] = useState("");
  const [editModal, setEditModal] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [form, setForm] = useState({ nominal_uang: "", nominal_beras: "", keterangan: "" });
  const [bulkModal, setBulkModal] = useState(false);
  const [bulkForm, setBulkForm] = useState({ nominal_uang: "", nominal_beras: "", keterangan: "" });
  const [isSavingBulk, setIsSavingBulk] = useState(false);

  const getData = async () => {
    try {
      const response = await api.get("/sahriyah-setting", {
        params: { ...readScopeParams, t: Date.now() },
      });
      setData(response.data.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    getData();
  }, [readScopeParams]);

  const filteredData = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    if (!q) return data;
    return data.filter((d) =>
      [d.nama, d.keterangan, d.nominal_uang, d.nominal_beras]
        .some((field) => String(field || "").toLowerCase().includes(q)),
    );
  }, [data, tableSearch]);

  const openEdit = (row) => {
    setEditRow(row);
    setForm({
      nominal_uang: String(row.nominal_uang ?? ""),
      nominal_beras: String(row.nominal_beras ?? ""),
      keterangan: row.keterangan || "",
    });
    setEditModal(true);
  };

  const saveSetting = async () => {
    if (!editRow) return;
    try {
      await api.put(`/sahriyah-setting/${editRow.id}`, {
        nominal_uang: Number(form.nominal_uang),
        nominal_beras: Number(form.nominal_beras),
        keterangan: form.keterangan,
        ...requireActiveUnitForWrite({ activeUnitId }),
      });
      setEditModal(false);
      setEditRow(null);
      await getData();
      alert("Berhasil disimpan");
    } catch (err) {
      console.error(err);
      alert("Gagal menyimpan");
    }
  };

  const saveBulkSetting = async () => {
    if (isSavingBulk) return;

    if (bulkForm.nominal_uang === "" || bulkForm.nominal_beras === "") {
      alert("Nominal uang dan nominal beras wajib diisi");
      return;
    }

    const yakin = window.confirm(
      "Terapkan setting sahriyah ini ke seluruh santri? Setting individual yang sudah ada akan ikut diperbarui.",
    );
    if (!yakin) return;

    setIsSavingBulk(true);

    try {
      const response = await api.put("/sahriyah-setting/bulk", {
        nominal_uang: Number(bulkForm.nominal_uang),
        nominal_beras: Number(bulkForm.nominal_beras),
        keterangan: bulkForm.keterangan,
        ...requireActiveUnitForWrite({ activeUnitId }),
      });
      setBulkModal(false);
      setBulkForm({ nominal_uang: "", nominal_beras: "", keterangan: "" });
      await getData();
      alert(`Setting berhasil diterapkan ke ${response.data.updated_count || 0} santri`);
    } catch (err) {
      console.error(err);
      alert(err?.response?.data?.error || "Gagal menerapkan setting semua santri");
    } finally {
      setIsSavingBulk(false);
    }
  };

  return (
    <AppShell title="Setting Sahriyah" breadcrumb="Keuangan / Setting Sahriyah">
      <KeuanganPageStyles />
      <div className="keuangan-page">
      <DataTableCard
        title="Pengaturan Nominal Sahriyah"
        subtitle="Kelola tarif uang dan beras per kategori"
        actions={
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
              {filteredData.length} setting
            </span>
            <Button size="sm" onClick={() => setBulkModal(true)}>
              Set Semua Santri
            </Button>
          </div>
        }
      >
        <TableToolbar
          search={
            <SearchInput
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="Cari nama, keterangan..."
            />
          }
        />

        {filteredData.length === 0 ? (
          <EmptyState
            title={data.length === 0 ? "Belum ada setting" : "Tidak ada hasil pencarian"}
            description={
              data.length === 0
                ? "Data pengaturan belum tersedia."
                : "Coba kata kunci lain atau hapus filter pencarian."
            }
          />
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Nominal Uang</th>
                  <th>Nominal Beras</th>
                  <th>Keterangan</th>
                  <th className="table-v3__cell--actions">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.map((d) => (
                  <tr key={d.id}>
                    <td className="table-v3__cell--strong">{d.nama}</td>
                    <td>Rp {Number(d.nominal_uang || 0).toLocaleString()}</td>
                    <td>{d.nominal_beras || 0} Kg</td>
                    <td>{d.keterangan || "—"}</td>
                    <td className="table-v3__cell--actions">
                      <TableActions items={[{ type: "edit", onClick: () => openEdit(d) }]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableScroll>
        )}
      </DataTableCard>

      <Modal
        open={editModal}
        title={`Edit Setting — ${editRow?.nama || ""}`}
        onClose={() => setEditModal(false)}
        width={440}
      >
        <FormGrid columns="modal">
          <FormField label="Nominal Uang" htmlFor="setting-uang" required>
            <Input
              id="setting-uang"
              type="number"
              value={form.nominal_uang}
              onChange={(e) => setForm({ ...form, nominal_uang: e.target.value })}
            />
          </FormField>
          <FormField label="Nominal Beras (Kg)" htmlFor="setting-beras" required>
            <Input
              id="setting-beras"
              type="number"
              value={form.nominal_beras}
              onChange={(e) => setForm({ ...form, nominal_beras: e.target.value })}
            />
          </FormField>
          <FormField label="Keterangan" htmlFor="setting-ket" fullWidth>
            <Textarea
              id="setting-ket"
              value={form.keterangan}
              onChange={(e) => setForm({ ...form, keterangan: e.target.value })}
              rows={3}
            />
          </FormField>
        </FormGrid>
        <FormActionBar className="form-action-bar-v3--compact">
          <Button variant="primary" onClick={saveSetting}>
            Simpan
          </Button>
          <Button variant="outline" onClick={() => setEditModal(false)}>
            Batal
          </Button>
        </FormActionBar>
      </Modal>

      <Modal
        open={bulkModal}
        title="Set Sahriyah Semua Santri"
        onClose={() => {
          if (!isSavingBulk) setBulkModal(false);
        }}
        width={460}
      >
        <div className="form-modal-summary-v3">
          <p>
            Setting ini akan diterapkan ke seluruh santri. Setelah itu, santri tertentu
            tetap bisa diedit satu per satu untuk dispensasi.
          </p>
        </div>
        <FormGrid columns="modal">
          <FormField label="Nominal Uang" htmlFor="bulk-setting-uang" required>
            <Input
              id="bulk-setting-uang"
              type="number"
              value={bulkForm.nominal_uang}
              onChange={(e) => setBulkForm({ ...bulkForm, nominal_uang: e.target.value })}
              disabled={isSavingBulk}
            />
          </FormField>
          <FormField label="Nominal Beras (Kg)" htmlFor="bulk-setting-beras" required>
            <Input
              id="bulk-setting-beras"
              type="number"
              value={bulkForm.nominal_beras}
              onChange={(e) => setBulkForm({ ...bulkForm, nominal_beras: e.target.value })}
              disabled={isSavingBulk}
            />
          </FormField>
          <FormField label="Keterangan" htmlFor="bulk-setting-ket" fullWidth>
            <Textarea
              id="bulk-setting-ket"
              value={bulkForm.keterangan}
              onChange={(e) => setBulkForm({ ...bulkForm, keterangan: e.target.value })}
              rows={3}
              disabled={isSavingBulk}
            />
          </FormField>
        </FormGrid>
        <FormActionBar className="form-action-bar-v3--compact">
          <Button variant="primary" onClick={saveBulkSetting} disabled={isSavingBulk}>
            {isSavingBulk ? "Menyimpan..." : "Terapkan ke Semua"}
          </Button>
          <Button variant="outline" onClick={() => setBulkModal(false)} disabled={isSavingBulk}>
            Batal
          </Button>
        </FormActionBar>
      </Modal>
      </div>
    </AppShell>
  );
}

export default SahriyahSettingPage;
