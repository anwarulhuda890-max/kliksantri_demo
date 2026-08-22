import { useEffect, useState } from "react";
import AppShell from "../layouts/AppShell";
import api from "../services/api";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import EmptyState from "../components/ui/EmptyState";
import { FormField, Input } from "../components/ui/form";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { buildUnitScopeParams, requireActiveUnitForWrite } from "../utils/unitScopeParams";

function MataPelajaranPage() {
  const { activeUnitId, allUnitsAllowed } = useActiveUnit();
  const scopeParams = buildUnitScopeParams({ activeUnitId, allUnitsAllowed });
  const [kelas, setKelas] = useState([]);
  const [kelasId, setKelasId] = useState("");
  const [mapel, setMapel] = useState([]);
  const [nama, setNama] = useState("");
  const [loading, setLoading] = useState(false);

  const load = async (selectedKelas = kelasId) => {
    const response = await api.get("/mata-pelajaran", {
      params: selectedKelas ? { ...scopeParams, kelas_id: selectedKelas } : scopeParams,
    });
    setMapel(response.data.data || []);
  };

  useEffect(() => {
    setKelasId("");
    Promise.all([
      api.get("/kelas", { params: scopeParams }),
      api.get("/mata-pelajaran", { params: scopeParams }),
    ])
      .then(([kelasResponse, mapelResponse]) => {
        setKelas(kelasResponse.data.data || []);
        setMapel(mapelResponse.data.data || []);
      })
      .catch((err) => alert(err?.response?.data?.error || "Gagal memuat mata pelajaran"));
  }, [activeUnitId, allUnitsAllowed]);

  const create = async () => {
    if (!nama.trim()) return alert("Nama mata pelajaran wajib diisi");
    setLoading(true);
    try {
      await api.post("/mata-pelajaran", { ...requireActiveUnitForWrite({ activeUnitId }), nama: nama.trim() });
      setNama("");
      await load();
    } catch (err) {
      alert(err?.response?.data?.error || "Gagal menambah mata pelajaran");
    } finally {
      setLoading(false);
    }
  };

  const toggle = async (item) => {
    if (!kelasId) return alert("Pilih kelas terlebih dahulu");
    setLoading(true);
    try {
      if (item.ditugaskan) {
        await api.delete(`/mata-pelajaran/assign/${kelasId}/${item.id}`, { params: requireActiveUnitForWrite({ activeUnitId }) });
      } else {
        await api.post("/mata-pelajaran/assign", {
          ...requireActiveUnitForWrite({ activeUnitId }),
          kelas_id: Number(kelasId),
          mata_pelajaran_id: item.id,
        });
      }
      await load(kelasId);
    } catch (err) {
      alert(err?.response?.data?.error || "Gagal mengubah mapel kelas");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell title="Mata Pelajaran" breadcrumb="Akademik / Mata Pelajaran">
      <Card padding="md" shadow="card" border={false} radius="xl">
        <FormField label="Tambah Mata Pelajaran" htmlFor="nama-mapel">
          <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "end" }}>
            <Input id="nama-mapel" value={nama} onChange={(e) => setNama(e.target.value)} placeholder="Contoh: Bahasa Arab" disabled={loading} />
            <Button type="button" variant="primary" onClick={create} disabled={loading || !activeUnitId}>Tambah</Button>
          </div>
        </FormField>
      </Card>

      <Card padding="md" shadow="card" border={false} radius="xl">
        <FormField label="Atur Mapel per Kelas" htmlFor="mapel-kelas">
          <select id="mapel-kelas" className="form-select-v3" value={kelasId} onChange={(e) => { setKelasId(e.target.value); load(e.target.value); }}>
            <option value="">Pilih Kelas</option>
            {kelas.map((item) => <option key={item.id} value={item.id}>{item.nama_kelas}</option>)}
          </select>
        </FormField>

        {!kelasId ? (
          <EmptyState title="Pilih kelas" description="Pilih kelas untuk mengatur mata pelajaran yang digunakan." />
        ) : mapel.length === 0 ? (
          <EmptyState title="Belum ada mata pelajaran" description="Tambahkan mata pelajaran terlebih dahulu." />
        ) : (
          <div style={{ display: "grid", gap: "var(--space-2)", marginTop: "var(--space-4)" }}>
            {mapel.map((item) => (
              <label key={item.id} style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <input type="checkbox" checked={Boolean(item.ditugaskan)} onChange={() => toggle(item)} disabled={loading} />
                <span>{item.nama}</span>
              </label>
            ))}
          </div>
        )}
      </Card>
    </AppShell>
  );
}
export default MataPelajaranPage;
