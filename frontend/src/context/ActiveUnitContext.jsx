/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { getUser } from "../utils/storage";

const ActiveUnitContext = createContext(null);

export function ActiveUnitProvider({ children }) {
  const user = getUser();
  const tenantKey = user?.tenant_id ? `klikpesantren:active-unit:${user.tenant_id}` : null;
  const [units, setUnits] = useState([]);
  const [allUnitsAllowed, setAllUnitsAllowed] = useState(false);
  const [activeUnitId, setActiveUnitIdState] = useState(null);
  const [loading, setLoading] = useState(Boolean(localStorage.getItem("token")));
  const [error, setError] = useState("");

  const refreshUnits = useCallback(async () => {
    if (!localStorage.getItem("token")) {
      setLoading(false);
      return;
    }
    try {
      setError("");
      const response = await api.get("/units");
      const nextUnits = response.data?.data || [];
      const allowAll = response.data?.access?.all_units === true;
      setUnits(nextUnits);
      setAllUnitsAllowed(allowAll);
      const stored = tenantKey ? localStorage.getItem(tenantKey) : null;
      if (allowAll && (!stored || stored === "all")) setActiveUnitIdState(null);
      else if (nextUnits.some((unit) => String(unit.id) === String(stored))) setActiveUnitIdState(Number(stored));
      else if (nextUnits.length === 1) setActiveUnitIdState(Number(nextUnits[0].id));
      else setActiveUnitIdState(null);
    } catch (requestError) {
      setUnits([]);
      setAllUnitsAllowed(false);
      setError(requestError.response?.data?.error || "Ruang kerja unit belum dapat dimuat");
    } finally {
      setLoading(false);
    }
  }, [tenantKey]);

  useEffect(() => {
    // Loading unit options is an external API synchronization performed once per tenant session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshUnits();
  }, [refreshUnits]);

  const setActiveUnitId = useCallback((value) => {
    const normalized = value == null || value === "all" || value === "" ? null : Number(value);
    setActiveUnitIdState(normalized);
    if (tenantKey) localStorage.setItem(tenantKey, normalized == null ? "all" : String(normalized));
  }, [tenantKey]);

  const value = useMemo(() => ({
    units,
    activeUnitId,
    activeUnit: units.find((unit) => Number(unit.id) === Number(activeUnitId)) || null,
    allUnitsAllowed,
    loading,
    error,
    setActiveUnitId,
    refreshUnits,
  }), [units, activeUnitId, allUnitsAllowed, loading, error, setActiveUnitId, refreshUnits]);

  return <ActiveUnitContext.Provider value={value}>{children}</ActiveUnitContext.Provider>;
}

export function useActiveUnit() {
  const context = useContext(ActiveUnitContext);
  if (!context) throw new Error("useActiveUnit harus digunakan di dalam ActiveUnitProvider");
  return context;
}
