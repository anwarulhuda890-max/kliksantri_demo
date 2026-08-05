import { useActiveUnit } from "../context/ActiveUnitContext";

export default function UnitWorkspaceSelector() {
  const { units, activeUnitId, allUnitsAllowed, loading, setActiveUnitId } = useActiveUnit();
  if (loading || (!allUnitsAllowed && units.length <= 1)) return null;
  return (
    <div style={wrapStyle}>
      <div>
        <strong>Ruang kerja unit</strong>
        <span style={hintStyle}>Fondasi bertahap—belum memfilter semua modul lama.</span>
      </div>
      <select style={selectStyle} value={activeUnitId ?? "all"} onChange={(event) => setActiveUnitId(event.target.value)}>
        {allUnitsAllowed ? <option value="all">Semua Unit</option> : null}
        {units.filter((unit) => unit.is_active).map((unit) => (
          <option key={unit.id} value={unit.id}>{unit.nama}</option>
        ))}
      </select>
    </div>
  );
}

const wrapStyle = { margin: "0 var(--space-6) var(--space-4)", padding: "12px 16px", border: "1px solid var(--border)", borderRadius: 12, background: "var(--card)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, flexWrap: "wrap" };
const hintStyle = { display: "block", marginTop: 3, color: "var(--text-secondary)", fontSize: 12 };
const selectStyle = { minWidth: 210, padding: "9px 12px", borderRadius: 9, border: "1px solid var(--border)", background: "var(--background)", color: "var(--text-primary)" };
