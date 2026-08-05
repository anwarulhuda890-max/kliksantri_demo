import { useEffect, useMemo, useState } from "react";
import AppShell from "../layouts/AppShell";
import api from "../services/api";
import Card from "../components/ui/Card";
import Button from "../components/ui/Button";
import Modal from "../components/Modal";
import StatusBadge from "../components/ui/StatusBadge";
import { FormField, FormGrid, Input, Select } from "../components/ui/form";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { getUser } from "../utils/storage";

const TYPES = ["PESANTREN", "MADIN", "PAUD", "TK", "SD", "MI", "SMP", "MTS", "SMA", "MA", "SMK", "CUSTOM"];
const emptyForm = { nama: "", kode: "", unit_type: "", sort_order: 0 };

export default function UnitPendidikanPage() {
  const user = getUser();
  const canManage = user?.permissions?.includes("unit.manage") || user?.role === "superadmin";
  const { units, refreshUnits } = useActiveUnit();
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [features, setFeatures] = useState([]);
  const [preview, setPreview] = useState([]);
  const [featureUnit, setFeatureUnit] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!form.unit_type) return;
    api.get(`/units/presets/${form.unit_type}`).then((res) => setPreview(res.data?.data?.features || [])).catch(() => setPreview([]));
  }, [form.unit_type]);

  const sorted = useMemo(() => [...units].sort((a, b) => a.sort_order - b.sort_order || a.nama.localeCompare(b.nama)), [units]);
  const startCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); setError(""); };
  const startEdit = (unit) => { setEditing(unit); setForm({ nama: unit.nama, kode: unit.kode, unit_type: unit.unit_type, sort_order: unit.sort_order }); setOpen(true); setError(""); };

  async function saveUnit(event) {
    event.preventDefault(); setError("");
    try {
      if (editing) await api.patch(`/units/${editing.id}`, form);
      else await api.post("/units", form);
      setOpen(false); await refreshUnits();
    } catch (err) { setError(err.response?.data?.error || "Gagal menyimpan unit"); }
  }

  async function openFeatures(unit) {
    setFeatureUnit(unit); setError("");
    try { const res = await api.get(`/units/${unit.id}/features`); setFeatures(res.data?.data || []); }
    catch (err) { setError(err.response?.data?.error || "Gagal memuat fitur unit"); setFeatures([]); }
  }

  async function saveFeatures() {
    try {
      await api.put(`/units/${featureUnit.id}/features`, { features: features.map(({ key, enabled }) => ({ key, enabled })) });
      setFeatureUnit(null);
    } catch (err) { setError(err.response?.data?.error || "Gagal menyimpan fitur unit"); }
  }

  async function toggleStatus(unit) {
    const action = unit.is_active ? "deactivate" : "activate";
    if (!window.confirm(`${unit.is_active ? "Nonaktifkan" : "Aktifkan"} unit ${unit.nama}?`)) return;
    try { await api.post(`/units/${unit.id}/${action}`); await refreshUnits(); }
    catch (err) { setError(err.response?.data?.error || "Gagal mengubah status unit"); }
  }

  return (
    <AppShell title="Unit Pendidikan" description="Fondasi ruang kerja mandiri setiap unit di bawah yayasan.">
      {error ? <div style={errorStyle}>{error}</div> : null}
      <div style={toolbarStyle}>
        <p style={{ margin: 0, color: "var(--text-secondary)" }}>Preset adalah konfigurasi awal dan dapat dikustom.</p>
        {canManage ? <Button onClick={startCreate}>+ Tambah Unit</Button> : null}
      </div>
      <div style={gridStyle}>
        {sorted.map((unit) => (
          <Card key={unit.id} padding="md" accent={unit.is_active ? "primary" : "warning"}>
            <div style={titleRowStyle}><div><h3 style={{ margin: 0 }}>{unit.nama}</h3><small>{unit.kode} · {unit.unit_type}</small></div><StatusBadge status={unit.is_active ? "Aktif" : "Nonaktif"} /></div>
            <p style={descriptionStyle}>Preset: {unit.preset_key || "—"}. Urutan: {unit.sort_order}</p>
            <div style={actionsStyle}>
              <Button size="sm" variant="outline" onClick={() => openFeatures(unit)}>Fitur</Button>
              {canManage ? <Button size="sm" variant="secondary" onClick={() => startEdit(unit)}>Edit</Button> : null}
              {canManage ? <Button size="sm" variant={unit.is_active ? "danger" : "success"} onClick={() => toggleStatus(unit)}>{unit.is_active ? "Nonaktifkan" : "Aktifkan"}</Button> : null}
            </div>
          </Card>
        ))}
      </div>

      <Modal open={open} title={editing ? "Edit Unit Pendidikan" : "Tambah Unit Pendidikan"} onClose={() => setOpen(false)}>
        <form onSubmit={saveUnit}>
          <FormGrid>
            <FormField label="Nama unit"><Input value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} required /></FormField>
            <FormField label="Jenis/preset"><Select value={form.unit_type} onChange={(e) => setForm({ ...form, unit_type: e.target.value, kode: e.target.value })} required><option value="">Pilih jenis</option>{TYPES.map((type) => <option key={type}>{type}</option>)}</Select></FormField>
            <FormField label="Kode canonical"><Input value={form.kode} onChange={(e) => setForm({ ...form, kode: e.target.value.toUpperCase() })} required /></FormField>
            <FormField label="Urutan"><Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} /></FormField>
          </FormGrid>
          {form.unit_type && preview.length ? <div style={previewStyle}><strong>Preview preset</strong><div>{preview.map((f) => <span key={f.key} style={featurePillStyle}>{f.key}{!f.available ? " (belum tersedia)" : ""}</span>)}</div></div> : null}
          <div style={modalActionsStyle}><Button type="button" variant="secondary" onClick={() => setOpen(false)}>Batal</Button><Button type="submit">Simpan</Button></div>
        </form>
      </Modal>

      <Modal open={Boolean(featureUnit)} title={`Fitur ${featureUnit?.nama || "Unit"}`} onClose={() => setFeatureUnit(null)}>
        <div style={featureListStyle}>{features.map((feature, index) => <label key={feature.key} style={featureRowStyle}><span><strong>{feature.key}</strong><small style={{ display: "block" }}>{feature.implemented ? `Sumber: ${feature.source}` : "Belum tersedia pada UI"}</small></span><input type="checkbox" checked={feature.enabled} disabled={!canManage || !feature.implemented} onChange={(e) => setFeatures((items) => items.map((item, i) => i === index ? { ...item, enabled: e.target.checked } : item))} /></label>)}</div>
        <div style={modalActionsStyle}><Button variant="secondary" onClick={() => setFeatureUnit(null)}>Tutup</Button>{canManage ? <Button onClick={saveFeatures}>Simpan Fitur</Button> : null}</div>
      </Modal>
    </AppShell>
  );
}

const toolbarStyle = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 18, flexWrap: "wrap" };
const gridStyle = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 16 };
const titleRowStyle = { display: "flex", justifyContent: "space-between", gap: 12 };
const descriptionStyle = { color: "var(--text-secondary)", fontSize: 13 };
const actionsStyle = { display: "flex", gap: 8, flexWrap: "wrap" };
const errorStyle = { padding: 12, marginBottom: 16, borderRadius: 10, background: "var(--danger-subtle)", color: "var(--danger)" };
const previewStyle = { marginTop: 16, padding: 14, background: "var(--neutral-subtle)", borderRadius: 10 };
const featurePillStyle = { display: "inline-block", padding: "4px 8px", margin: "6px 6px 0 0", borderRadius: 999, background: "var(--card)", border: "1px solid var(--border)", fontSize: 12 };
const modalActionsStyle = { display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 20 };
const featureListStyle = { display: "grid", gap: 8, maxHeight: 430, overflow: "auto" };
const featureRowStyle = { display: "flex", justifyContent: "space-between", padding: 12, border: "1px solid var(--border)", borderRadius: 10 };
