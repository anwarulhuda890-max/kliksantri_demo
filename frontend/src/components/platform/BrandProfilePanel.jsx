import { useCallback, useEffect, useState } from "react";
import platformApi from "../../services/platformApi";
import Card from "../ui/Card";
import SectionHeading from "../ui/SectionHeading";
import PlatformButton from "./PlatformButton";

const lifecycle = ["DRAFT", "APPROVED", "BUILD_READY", "PUBLISHED"];
const empty = { mode: "universal", brand_key: "", app_name: "", short_name: "", slogan: "", primary_color: "#15803D", package_id: "", play_store_url: "", play_store_status: "NOT_PUBLISHED", status: "DRAFT", current_version_name: "1.0.0", current_version_code: 1, firebase_config_ref: "" };

function Field({ label, children }) { return <label style={{ display: "grid", gap: 6, fontSize: 12, fontWeight: 700, color: "#475569" }}><span>{label}</span>{children}</label>; }
const inputStyle = { width: "100%", boxSizing: "border-box", border: "1px solid #CBD5E1", borderRadius: 10, padding: "10px 12px", color: "#0F172A", background: "#FFFFFF" };

export default function BrandProfilePanel({ tenantId, tenantName, tenantSlug, tenantDomain }) {
  const [form, setForm] = useState(empty);
  const [effective, setEffective] = useState(null);
  const [inherited, setInherited] = useState(true);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setMessage("");
    try {
      const { data } = await platformApi.get(`/platform/brands/tenant/${tenantId}`);
      const own = data.data;
      setInherited(Boolean(data.inherited)); setEffective(data.effective);
      setForm(own ? { ...empty, ...own, mode: "white_label" } : { ...empty, mode: "universal", brand_key: tenantSlug || "", app_name: tenantName || "", short_name: tenantName || "" });
    } catch (error) { setMessage(error.response?.data?.error || "Gagal memuat Brand Profile"); }
    finally { setBusy(false); }
  }, [tenantId, tenantName, tenantSlug]);

  useEffect(() => {
    const timer = window.setTimeout(load, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  const change = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));

  async function suggestPackage() {
    try {
      const { data } = await platformApi.post(`/platform/brands/tenant/${tenantId}/suggest-package`, { brand_key: form.brand_key || tenantSlug });
      setForm((current) => ({ ...current, package_id: data.package_id }));
    } catch (error) { setMessage(error.response?.data?.error || "Package ID tidak dapat dibuat"); }
  }

  async function uploadAsset(kind, file) {
    if (!file) return;
    const body = new FormData(); body.append("file", file);
    try {
      setBusy(true);
      const { data } = await platformApi.post(`/platform/brands/tenant/${tenantId}/assets/${kind}`, body);
      const key = kind === "splash" ? "splash_logo_url" : `${kind}_url`;
      setForm((current) => ({ ...current, [key]: data.data.url }));
    } catch (error) { setMessage(error.response?.data?.error || "Upload asset gagal"); }
    finally { setBusy(false); }
  }

  async function save() {
    try {
      setBusy(true); setMessage("");
      const payload = form.mode === "universal" ? { mode: "universal" } : { ...form, custom_domain_id: form.custom_domain_id ? Number(form.custom_domain_id) : null, current_version_code: Number(form.current_version_code) };
      await platformApi.put(`/platform/brands/tenant/${tenantId}`, payload);
      setMessage("Brand Profile tersimpan."); await load();
    } catch (error) { setMessage(error.response?.data?.error || "Brand Profile gagal disimpan"); }
    finally { setBusy(false); }
  }

  const shown = inherited ? effective : form;
  return <div style={{ marginBottom: 20 }}><Card padding="md" shadow="card" radius="xl">
    <SectionHeading spacing="first" variant="divider">Branding / White-label</SectionHeading>
    <div style={{ padding: 12, borderRadius: 12, background: "#F8FAFC", marginBottom: 16 }}>
      <strong>{shown?.app_name || "WaliSantri"}</strong><div style={{ color: "#64748B", fontSize: 12 }}>Powered by KlikPesantren · selalu aktif</div>
    </div>
    {busy && <p>Memuat konfigurasi branding...</p>}
    {message && <p style={{ color: message.includes("tersimpan") ? "#15803D" : "#B91C1C" }}>{message}</p>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
      <Field label="Mode"><select style={inputStyle} value={form.mode} onChange={change("mode")}><option value="universal">Universal (WaliSantri)</option><option value="white_label">White-label</option></select></Field>
      {form.mode === "white_label" && <>
        <Field label="Brand Key"><input style={inputStyle} value={form.brand_key} onChange={change("brand_key")} /></Field>
        <Field label="App Name"><input style={inputStyle} value={form.app_name} onChange={change("app_name")} /></Field>
        <Field label="Short Name"><input style={inputStyle} value={form.short_name} onChange={change("short_name")} /></Field>
        <Field label="Slogan"><input style={inputStyle} value={form.slogan || ""} onChange={change("slogan")} /></Field>
        <Field label="Primary Color"><input style={{ ...inputStyle, height: 42 }} type="color" value={form.primary_color} onChange={change("primary_color")} /></Field>
        <Field label="Package ID"><div style={{ display: "flex", gap: 8 }}><input style={inputStyle} value={form.package_id || ""} onChange={change("package_id")} readOnly={form.status === "PUBLISHED"} /><PlatformButton size="sm" variant="secondary" onClick={suggestPackage} disabled={form.status === "PUBLISHED"}>Generate</PlatformButton></div></Field>
        {[['logo','Logo'],['icon','Icon'],['splash','Splash logo']].map(([kind,label]) => <Field key={kind} label={label}><input type="file" accept="image/*" onChange={(event) => uploadAsset(kind, event.target.files?.[0])} /><small>{form[kind === 'splash' ? 'splash_logo_url' : `${kind}_url`] || 'Belum ada asset'}</small></Field>)}
        <Field label="Custom Domain"><select style={inputStyle} value={form.custom_domain_id || ""} onChange={change("custom_domain_id")}><option value="">Tidak ditautkan (opsional)</option>{tenantDomain?.id && <option value={tenantDomain.id}>{tenantDomain.hostname}</option>}</select></Field>
        <Field label="Lifecycle"><select style={inputStyle} value={form.status} onChange={change("status")}>{lifecycle.map((status) => <option key={status}>{status}</option>)}</select></Field>
        <Field label="Version Name"><input style={inputStyle} value={form.current_version_name} onChange={change("current_version_name")} /></Field>
        <Field label="Version Code"><input style={inputStyle} type="number" min="1" value={form.current_version_code} onChange={change("current_version_code")} /></Field>
        <Field label="Firebase config reference"><input style={inputStyle} value={form.firebase_config_ref || ""} onChange={change("firebase_config_ref")} placeholder="Reference secret, bukan JSON" /></Field>
        <Field label="Play Store URL"><input style={inputStyle} value={form.play_store_url || ""} onChange={change("play_store_url")} /></Field>
        <Field label="Play Store Status"><select style={inputStyle} value={form.play_store_status} onChange={change("play_store_status")}><option>NOT_PUBLISHED</option><option>IN_REVIEW</option><option>PUBLISHED</option><option>SUSPENDED</option></select></Field>
      </>}
    </div>
    {form.mode === "white_label" && <div style={{ marginTop: 14 }}><small>Derived colors (otomatis, read-only)</small><div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}>{Object.entries(form.derived_colors || { primary: form.primary_color }).map(([key,value]) => <span key={key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11 }}><i style={{ width: 20, height: 20, borderRadius: 6, background: value, border: "1px solid #CBD5E1" }} />{key}: {value}</span>)}</div></div>}
    <div style={{ marginTop: 18 }}><PlatformButton variant="primary" onClick={save} disabled={busy}>Simpan Brand Profile</PlatformButton></div>
  </Card></div>;
}
