import { useState, useEffect, useCallback, useRef } from 'react';
import { hafalanApi } from '../api/hafalan.api';
import { getApiErrorMessage } from '../utils/apiError';
import { useActiveChild } from '../context/ActiveChildContext';

export function useHafalan(activeSantriId, bulan, tahun, enabled = true) {
  const { activeUnitId } = useActiveChild();
  const [data, setData] = useState([]);
  const [ringkasan, setRingkasan] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const reqRef = useRef(0);

  const fetchHafalan = useCallback(
    async ({ silent = false } = {}) => {
      if (!activeSantriId || !activeUnitId || !enabled) return;

      const reqId = ++reqRef.current;

      if (!silent) setIsLoading(true);
      else setIsRefreshing(true);

      setError(null);

      try {
        const res = await hafalanApi.getHafalan({ bulan, tahun });

        if (reqId !== reqRef.current) return;

        setData(res.data ?? []);
        setRingkasan(res.ringkasan ?? null);
      } catch (err) {
        if (reqId !== reqRef.current) return;
        setError(getApiErrorMessage(err, 'Gagal memuat data hafalan. Silakan coba lagi.'));
      } finally {
        if (reqId === reqRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [activeSantriId, activeUnitId, bulan, tahun, enabled]
  );

  useEffect(() => {
    reqRef.current += 1;
    setData([]);
    setRingkasan(null);
    setError(null);
    setIsLoading(false);
    setIsRefreshing(false);
    if (enabled) fetchHafalan({ silent: false });
  }, [enabled, fetchHafalan]);

  return {
    data,
    ringkasan,
    isLoading,
    isRefreshing,
    error,
    refresh: () => fetchHafalan({ silent: true }),
  };
}
