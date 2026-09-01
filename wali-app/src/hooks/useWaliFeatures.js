import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { featuresApi } from '../api/features.api';
import { getUnitFeatureFallback } from '../utils/unitFeatures';

export const WALI_FEATURE_FALLBACK = getUnitFeatureFallback();

export function useWaliFeatures(activeChild = null) {
  const fallback = useMemo(
    () => getUnitFeatureFallback(activeChild),
    [activeChild],
  );
  const [features, setFeatures] = useState(fallback);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestRef = useRef(0);
  const scopeKey = `${activeChild?.santri_id ?? activeChild?.id ?? ''}:${activeChild?.unit_id ?? ''}`;

  const fetchFeatures = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (!activeChild?.unit_id) {
      setFeatures(fallback);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      const res = await featuresApi.getFeatures();
      if (requestId !== requestRef.current) return;
      if (Number(res.data?.unit_id) !== Number(activeChild.unit_id)) {
        throw new Error('Unit capability tidak cocok dengan anak aktif.');
      }
      setFeatures({
        ...fallback,
        ...(res.data || {}),
      });
    } catch {
      if (requestId !== requestRef.current) return;
      setFeatures(fallback);
      setError('Konfigurasi fitur belum dapat dimuat.');
    } finally {
      if (requestId === requestRef.current) setIsLoading(false);
    }
  }, [activeChild?.unit_id, fallback]);

  useEffect(() => {
    requestRef.current += 1;
    setFeatures(fallback);
    setError(null);
    fetchFeatures();
  }, [fetchFeatures, fallback, scopeKey]);

  return {
    features,
    isLoading,
    error,
    refresh: fetchFeatures,
  };
}
