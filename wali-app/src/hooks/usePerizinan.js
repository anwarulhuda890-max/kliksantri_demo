import { useState, useEffect, useCallback, useRef } from 'react';
import { perizinanApi } from '../api/perizinan.api';
import { getApiErrorMessage } from '../utils/apiError';
import { useActiveChild } from '../context/ActiveChildContext';

export function usePerizinan(activeSantriId, enabled = true) {
  const { activeUnitId } = useActiveChild();
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const requestRef = useRef(0);

  const fetchPerizinan = useCallback(
    async ({ silent = false } = {}) => {
      if (!activeSantriId || !activeUnitId || !enabled) return;
      const requestId = ++requestRef.current;

      if (!silent) setIsLoading(true);
      else setIsRefreshing(true);

      setError(null);

      try {
        const res = await perizinanApi.getPerizinan({ limit: 50 });
        if (requestId !== requestRef.current) return;
        setData(res.data ?? []);
        setTotal(res.pagination?.total ?? 0);
      } catch (err) {
        if (requestId !== requestRef.current) return;
        setError(getApiErrorMessage(err, 'Gagal memuat data perizinan. Silakan coba lagi.'));
      } finally {
        if (requestId === requestRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [activeSantriId, activeUnitId, enabled]
  );

  useEffect(() => {
    requestRef.current += 1;
    setData([]);
    setTotal(0);
    setError(null);
    setIsLoading(false);
    setIsRefreshing(false);
    if (enabled) fetchPerizinan({ silent: false });
  }, [enabled, fetchPerizinan]);

  return {
    data,
    total,
    isLoading,
    isRefreshing,
    error,
    refresh: () => fetchPerizinan({ silent: true }),
  };
}
