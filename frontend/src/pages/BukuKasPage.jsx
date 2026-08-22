import { useEffect, useMemo, useState } from "react";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import Card from "../components/ui/Card";
import KpiCard from "../components/ui/KpiCard";
import KpiGrid from "../components/ui/KpiGrid";
import SectionHeading from "../components/ui/SectionHeading";
import Button from "../components/ui/Button";
import DataTableCard from "../components/ui/DataTableCard";
import TableToolbar from "../components/ui/TableToolbar";
import SearchInput from "../components/ui/SearchInput";
import EmptyState from "../components/ui/EmptyState";
import StatusBadge from "../components/ui/StatusBadge";
import { Table, TableScroll, TableActions, TablePagination, useClientPagination } from "../components/ui/table";
import { KeuanganPageStyles } from "../components/shared/PageResponsiveStyles";
import {
  FormField,
  Input,
  Select,
  Textarea,
  FormGrid,
  FormActionBar,
  FilterBar,
} from "../components/ui/form";
import { exportExcel } from "../utils/exportExcel";
import { formatCurrency, formatNumber } from "../utils/formatCurrency";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { buildUnitScopeParams, requireActiveUnitForWrite } from "../utils/unitScopeParams";

function BukuKasPage() {
  const { activeUnitId, activeUnit, allUnitsAllowed } = useActiveUnit();
  const [data, setData] = useState([]);
  const [search, setSearch] = useState("");
  const [editId, setEditId] = useState(null);
  const [bulan, setBulan] = useState(new Date().getMonth() + 1);
  const [tahun, setTahun] = useState(new Date().getFullYear());
  const [form, setForm] = useState({
    tanggal: "",
    jenis: "Masuk",
    kategori: "",
    keterangan: "",
    nominal: "",
    petugas: "",
  });
  const [message, setMessage] = useState("");

  const readScopeParams = useMemo(
    () => buildUnitScopeParams({ activeUnitId, allUnitsAllowed }),
    [activeUnitId, allUnitsAllowed],
  );

  const getData = async () => {
    const response = await api.get("/buku-kas", {
      params: readScopeParams,
    });
    setData(response.data.data);
  };

  const simpan = async () => {
    try {
      const unitPayload = requireActiveUnitForWrite({ activeUnitId });
      if (editId) {
        await api.put(`/buku-kas/${editId}`, {
          ...form,
          nominal: Number(form.nominal),
          ...unitPayload,
        });
      } else {
        await api.post("/buku-kas", {
          ...form,
          nominal: Number(form.nominal),
          ...unitPayload,
        });
      }

      setEditId(null);
      setForm({
        tanggal: "",
        jenis: "Masuk",
        kategori: "",
        keterangan: "",
        nominal: "",
        petugas: "",
      });
      

      await getData();

      setMessage(editId ? "Data berhasil diupdate" : "Data berhasil disimpan");
    } catch (err) {
      console.error(err);
      setMessage(err.response?.data?.error || err.message || "Gagal menyimpan Buku Kas");
    }
  };

  const hapus = async (id) => {
    if (!window.confirm("Hapus transaksi?")) return;

    try {
      const unitPayload = requireActiveUnitForWrite({ activeUnitId });
      await api.delete(`/buku-kas/${id}`, { params: unitPayload });
      await getData();
    } catch (err) {
      console.error(err);
      setMessage(err.response?.data?.error || err.message || "Gagal menghapus Buku Kas");
    }
  };

  const editData = (d) => {
    setForm({
      tanggal: d.tanggal?.split("T")[0] || d.tanggal,
      jenis: d.jenis,
      kategori: d.kategori,
      keterangan: d.keterangan || "",
      nominal: d.nominal,
      petugas: d.petugas || "",
    });
    setEditId(d.id);
  };

  useEffect(() => {
    getData();
  }, [readScopeParams]);

  const dataTahunan = data.filter(
    (d) => Number(String(d.tanggal).split("-")[0]) === tahun,
  );

  const dataBulanan = dataTahunan.filter(
    (d) => Number(String(d.tanggal).split("-")[1]) === bulan,
  );

  const totalMasuk = dataBulanan
    .filter((d) => d.jenis === "Masuk")
    .reduce((sum, d) => sum + Number(d.nominal), 0);

  const totalKeluar = dataBulanan
    .filter((d) => d.jenis === "Keluar")
    .reduce((sum, d) => sum + Number(d.nominal), 0);

  const filtered = dataBulanan.filter(
    (d) =>
      d.kategori?.toLowerCase().includes(search.toLowerCase()) ||
      d.keterangan?.toLowerCase().includes(search.toLowerCase()) ||
      d.petugas?.toLowerCase().includes(search.toLowerCase()),
  );

  const { page, setPage, paginatedItems, totalItems, pageSize } = useClientPagination(filtered);

  useEffect(() => {
    setPage(1);
  }, [search, bulan, tahun, setPage]);

  const saldoKas = totalMasuk - totalKeluar;
  const jumlahTransaksi = filtered.length;

  const handleExport = () => {
    const rows = filtered.map((d) => ({
      Tanggal: new Date(d.tanggal).toLocaleDateString("id-ID"),
      Jenis: d.jenis,
      Kategori: d.kategori,
      Keterangan: d.keterangan,
      Nominal: Number(d.nominal),
      Petugas: d.petugas,
    }));

    exportExcel(rows, "BukuKas");
  };

  const bulanLabel = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ][bulan - 1];

  return (
    <AppShell title="Buku Kas" breadcrumb="Keuangan / Buku Kas">
      <KeuanganPageStyles />
      <div className="keuangan-page">
      <div style={{ marginBottom: 12, color: "var(--text-secondary)", fontSize: 13, fontWeight: 600 }}>
        Workspace: {activeUnit?.nama || (allUnitsAllowed ? "Semua Unit" : "Unit belum dipilih")}
        {!activeUnitId && allUnitsAllowed ? " — pilih unit terlebih dahulu untuk melakukan transaksi/perubahan data." : ""}
      </div>
      <Card padding="md" shadow="card" border={false} radius="xl">
        <FilterBar label="Periode">
          <Select value={bulan} onChange={(e) => setBulan(Number(e.target.value))} aria-label="Bulan">
            <option value={1}>Januari</option>
            <option value={2}>Februari</option>
            <option value={3}>Maret</option>
            <option value={4}>April</option>
            <option value={5}>Mei</option>
            <option value={6}>Juni</option>
            <option value={7}>Juli</option>
            <option value={8}>Agustus</option>
            <option value={9}>September</option>
            <option value={10}>Oktober</option>
            <option value={11}>November</option>
            <option value={12}>Desember</option>
          </Select>
          <Select value={tahun} onChange={(e) => setTahun(Number(e.target.value))} aria-label="Tahun">
            <option value={2025}>2025</option>
            <option value={2026}>2026</option>
            <option value={2027}>2027</option>
            <option value={2028}>2028</option>
          </Select>
        </FilterBar>
      </Card>

      <div style={{ marginTop: "var(--space-6)" }}>
        <KpiGrid>
          <KpiCard
            label="Total Pemasukan"
            value={formatCurrency(totalMasuk)}
            accent="success"
          />
          <KpiCard
            label="Total Pengeluaran"
            value={formatCurrency(totalKeluar)}
            accent="danger"
          />
          <KpiCard label="Saldo" value={formatCurrency(saldoKas)} accent="primary" />
          <KpiCard label="Jumlah Transaksi" value={formatNumber(jumlahTransaksi)} accent="neutral" />
        </KpiGrid>
      </div>

      <div style={{ marginTop: "var(--space-6)" }}>
        <Card padding="md" shadow="card" border={false} radius="xl">
          <SectionHeading variant="eyebrow" spacing="first">
            Tambah Transaksi
          </SectionHeading>

          <FormGrid style={{ marginTop: "var(--space-4)" }}>
            <FormField label="Tanggal" htmlFor="kas-tgl" required>
              <Input
                id="kas-tgl"
                type="date"
                value={form.tanggal}
                onChange={(e) => setForm({ ...form, tanggal: e.target.value })}
              />
            </FormField>
            <FormField label="Jenis" htmlFor="kas-jenis" required>
              <Select
                id="kas-jenis"
                value={form.jenis}
                onChange={(e) => setForm({ ...form, jenis: e.target.value })}
              >
                <option>Masuk</option>
                <option>Keluar</option>
              </Select>
            </FormField>
            <FormField label="Kategori" htmlFor="kas-kategori" required>
              <Select
                id="kas-kategori"
                value={form.kategori}
                onChange={(e) => setForm({ ...form, kategori: e.target.value })}
              >
                <option value="">Pilih Kategori</option>
                <option value="Sahriyah">Sahriyah</option>
                <option value="Daftar Ulang">Daftar Ulang</option>
                <option value="Donasi">Donasi</option>
                <option value="Topup RFID">Topup RFID</option>
                <option value="Operasional">Operasional</option>
                <option value="Listrik">Listrik</option>
                <option value="Air">Air</option>
                <option value="Insentif Guru">Insentif Guru</option>
                <option value="Lainnya">Lainnya</option>
              </Select>
            </FormField>
            <FormField label="Nominal" htmlFor="kas-nominal" required>
              <Input
                id="kas-nominal"
                type="number"
                value={form.nominal}
                onChange={(e) => setForm({ ...form, nominal: e.target.value })}
              />
            </FormField>
            <FormField label="Petugas" htmlFor="kas-petugas">
              <Input
                id="kas-petugas"
                value={form.petugas}
                onChange={(e) => setForm({ ...form, petugas: e.target.value })}
              />
            </FormField>
            <FormField label="Keterangan" htmlFor="kas-keterangan" fullWidth>
              <Textarea
                id="kas-keterangan"
                value={form.keterangan}
                onChange={(e) => setForm({ ...form, keterangan: e.target.value })}
                rows={2}
              />
            </FormField>
          </FormGrid>

          <FormActionBar className="form-action-bar-v3--compact">
            <Button onClick={simpan} disabled={!activeUnitId}>{editId ? "Update" : "Simpan"}</Button>
            {!activeUnitId ? (
              <span role="status" style={{ color: "var(--danger)", fontSize: 13, fontWeight: 600 }}>
                Pilih unit terlebih dahulu untuk melakukan transaksi/perubahan data.
              </span>
            ) : null}
            {message ? (
              <span role="status" style={{ color: "var(--text-secondary)", fontSize: 13, fontWeight: 600 }}>
                {message}
              </span>
            ) : null}
          </FormActionBar>
        </Card>
      </div>

      <div style={{ marginTop: "var(--space-6)" }}>
        <DataTableCard
          title="Daftar Transaksi"
          subtitle={`Arus kas ${bulanLabel} ${tahun}`}
          actions={
            <span style={{ fontSize: "13px", color: "var(--text-secondary)", fontWeight: 600 }}>
              {filtered.length} transaksi
            </span>
          }
        >
          <TableToolbar
            search={
              <SearchInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari kategori, keterangan, petugas..."
              />
            }
            actions={
              <Button variant="success" onClick={handleExport}>
                Export Excel
              </Button>
            }
          />

          {filtered.length === 0 ? (
            <EmptyState
              title={dataBulanan.length === 0 ? "Belum ada transaksi" : "Tidak ada hasil pencarian"}
              description={
                dataBulanan.length === 0
                  ? "Catat transaksi pertama untuk periode ini."
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
                    <th>Kategori</th>
                    <th>Keterangan</th>
                    <th>Nominal</th>
                    <th>Petugas</th>
                    <th className="table-v3__cell--actions">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedItems.map((d) => (
                    <tr key={d.id}>
                      <td>
                        {new Date(d.tanggal).toLocaleDateString("id-ID", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td>
                        <StatusBadge status={d.jenis === "Masuk" ? "aktif" : "ditolak"}>
                          {d.jenis}
                        </StatusBadge>
                      </td>
                      <td className="table-v3__cell--strong">{d.kategori}</td>
                      <td>{d.keterangan || "—"}</td>
                      <td className="table-v3__cell--strong">
                        Rp {Number(d.nominal).toLocaleString()}
                      </td>
                      <td>{d.petugas || "—"}</td>
                      <td className="table-v3__cell--actions">
                        <TableActions
                          items={[
                            { type: "edit", onClick: () => editData(d) },
                            { type: "delete", onClick: () => hapus(d.id) },
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

export default BukuKasPage;
