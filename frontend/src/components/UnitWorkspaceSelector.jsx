import { useActiveUnit } from "../context/ActiveUnitContext";

export default function UnitWorkspaceSelector() {
  const { units, activeUnitId, allUnitsAllowed, loading, error, setActiveUnitId } = useActiveUnit();
  const activeUnits = units.filter((unit) => unit.is_active);

  if (loading) return <div style={loadingStyle}>Memuat ruang kerja unit...</div>;
  if (error) return <div style={errorStyle}>Ruang kerja unit belum dapat dimuat. Muat ulang halaman atau hubungi operator.</div>;
  return (
    <div style={wrapStyle}>
      <div>
        <strong>Ruang kerja unit</strong>
        <span style={hintStyle}>{allUnitsAllowed ? "Pilih Semua Unit atau satu unit aktif." : "Akses dibatasi ke unit penugasan Anda."}</span>
      </div>
      <select
        style={selectStyle}
        value={activeUnitId ?? (allUnitsAllowed ? "all" : "")}
        onChange={(event) => setActiveUnitId(event.target.value)}
        disabled={!allUnitsAllowed && activeUnits.length <= 1}
      >
        {allUnitsAllowed ? <option value="all">Semua Unit</option> : null}
        {!allUnitsAllowed && !activeUnitId ? <option value="">Unit belum tersedia</option> : null}
        {activeUnits.map((unit) => (
          <option key={unit.id} value={unit.id}>{unit.nama}</option>
        ))}
      </select>
    </div>
  );
}

const wrapStyle = { margin: "0 var(--space-6) var(--space-4)", padding: "12px 16px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" };
const hintStyle = { display: "block", marginTop: 3, color: "var(--text-secondary)", fontSize: 12 };
const selectStyle = { minWidth: 210, padding: "9px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--background)", color: "var(--text-primary)" };
const errorStyle = { margin: "0 var(--space-6) var(--space-4)", padding: "10px 14px", border: "1px solid var(--danger)", borderRadius: 10, background: "var(--danger-subtle)", color: "var(--danger)", fontSize: 13 };
const loadingStyle = { margin: "0 var(--space-6) var(--space-4)", padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface-muted)", color: "var(--text-secondary)", fontSize: 13 };
