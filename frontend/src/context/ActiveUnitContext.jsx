/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import api from "../services/api";
import { getUser } from "../utils/storage";

const ActiveUnitContext = createContext(null);

function activeUnitsOnly(units) {
  return units.filter((unit) => unit.is_active !== false);
}

export function ActiveUnitProvider({ children }) {
  const user = getUser();
  const tenantKey = user?.tenant_id ? `klikpesantren:active-unit:${user.tenant_id}` : null;
  const [units, setUnits] = useState([]);
  const [allUnitsAllowed, setAllUnitsAllowed] = useState(false);
  const [activeUnitId, setActiveUnitIdState] = useState(null);
  const [activeUnitFeatures, setActiveUnitFeatures] = useState([]);
  const [featureUnitId, setFeatureUnitId] = useState(null);
  const [featureLoading, setFeatureLoading] = useState(false);
  const [featureError, setFeatureError] = useState("");
  const [loading, setLoading] = useState(Boolean(localStorage.getItem("token")));
  const [error, setError] = useState("");

  const refreshUnits = useCallback(async () => {
    if (!localStorage.getItem("token")) {
      setUnits([]);
      setAllUnitsAllowed(false);
      setActiveUnitIdState(null);
      setActiveUnitFeatures([]);
      setFeatureUnitId(null);
      setFeatureError("");
      setError("");
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError("");
      const response = await api.get("/units");
      const nextUnits = response.data?.data || [];
      const nextActiveUnits = activeUnitsOnly(nextUnits);
      const allowAll = response.data?.access?.all_units === true;
      setUnits(nextUnits);
      setAllUnitsAllowed(allowAll);
      const stored = tenantKey ? localStorage.getItem(tenantKey) : null;
      const storedUnit = nextActiveUnits.find((unit) => String(unit.id) === String(stored));

      if (allowAll) {
        setActiveUnitIdState(storedUnit ? Number(storedUnit.id) : null);
        return;
      }

      const scopedUnit = storedUnit || nextActiveUnits[0];
      if (scopedUnit) {
        setActiveUnitIdState(Number(scopedUnit.id));
        if (tenantKey) localStorage.setItem(tenantKey, String(scopedUnit.id));
        return;
      }

      setActiveUnitIdState(null);
      if (tenantKey) localStorage.removeItem(tenantKey);
      setError("Belum memiliki penugasan unit. Minta superadmin mengatur unit untuk akun ini.");
    } catch (requestError) {
      setUnits([]);
      setAllUnitsAllowed(false);
      setActiveUnitIdState(null);
      setActiveUnitFeatures([]);
      setFeatureUnitId(null);
      setFeatureError("");
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

  useEffect(() => {
    let cancelled = false;

    async function loadActiveUnitFeatures() {
      setActiveUnitFeatures([]);
      setFeatureUnitId(null);
      setFeatureError("");
      if (!activeUnitId) {
        setFeatureLoading(false);
        return;
      }

      try {
        setFeatureLoading(true);
        setFeatureError("");
        const response = await api.get(`/units/${activeUnitId}/features`);
        if (!cancelled) {
          setActiveUnitFeatures(response.data?.data || []);
          setFeatureUnitId(Number(activeUnitId));
        }
      } catch (requestError) {
        if (!cancelled) {
          setActiveUnitFeatures([]);
          setFeatureUnitId(Number(activeUnitId));
          setFeatureError(requestError.response?.data?.error || "Fitur unit belum dapat dimuat");
        }
      } finally {
        if (!cancelled) setFeatureLoading(false);
      }
    }

    loadActiveUnitFeatures();

    return () => {
      cancelled = true;
    };
  }, [activeUnitId]);

  const setActiveUnitId = useCallback((value) => {
    const normalized = value == null || value === "all" || value === "" ? null : Number(value);
    setActiveUnitFeatures([]);
    setFeatureUnitId(null);
    setFeatureError("");
    setFeatureLoading(normalized != null);
    if (normalized == null && !allUnitsAllowed) {
      const scopedUnit = activeUnitsOnly(units)[0];
      if (scopedUnit) {
        setActiveUnitIdState(Number(scopedUnit.id));
        if (tenantKey) localStorage.setItem(tenantKey, String(scopedUnit.id));
      }
      return;
    }

    if (normalized != null && !units.some((unit) => unit.is_active !== false && Number(unit.id) === normalized)) {
      return;
    }

    setActiveUnitIdState(normalized);
    if (tenantKey) localStorage.setItem(tenantKey, normalized == null ? "all" : String(normalized));
  }, [allUnitsAllowed, tenantKey, units]);

  const hasActiveUnitFeature = useCallback((featureKey) => {
    if (!featureKey) return true;
    if (!activeUnitId) return allUnitsAllowed;
    const feature = activeUnitFeatures.find((item) => item.key === featureKey);
    return feature?.effective_enabled === true;
  }, [activeUnitFeatures, activeUnitId, allUnitsAllowed]);

  const featureReady =
    activeUnitId == null || Number(featureUnitId) === Number(activeUnitId);

  const value = useMemo(() => ({
    units,
    activeUnitId,
    activeUnit: units.find((unit) => Number(unit.id) === Number(activeUnitId)) || null,
    activeUnitFeatures,
    featureLoading,
    featureReady,
    featureError,
    hasActiveUnitFeature,
    allUnitsAllowed,
    loading,
    error,
    setActiveUnitId,
    refreshUnits,
  }), [
    units,
    activeUnitId,
    activeUnitFeatures,
    featureLoading,
    featureReady,
    featureError,
    hasActiveUnitFeature,
    allUnitsAllowed,
    loading,
    error,
    setActiveUnitId,
    refreshUnits,
  ]);

  return <ActiveUnitContext.Provider value={value}>{children}</ActiveUnitContext.Provider>;
}

export function useActiveUnit() {
  const context = useContext(ActiveUnitContext);
  if (!context) throw new Error("useActiveUnit harus digunakan di dalam ActiveUnitProvider");
  return context;
}
