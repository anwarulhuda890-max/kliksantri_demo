import { useState, useEffect, useCallback, useRef } from 'react';
import { pelanggaranApi } from '../api/pelanggaran.api';
import { getApiErrorMessage } from '../utils/apiError';
import { useActiveChild } from '../context/ActiveChildContext';

export function usePelanggaran(activeSantriId, enabled = true) {
  const { activeUnitId } = useActiveChild();
  const [data, setData] = useState([]);
  const [ringkasan, setRingkasan] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  // Guard against race condition: store latest request id
  const reqRef = useRef(0);

  const fetchPelanggaran = useCallback(
    async ({ silent = false } = {}) => {
      if (!activeSantriId || !activeUnitId || !enabled) return;

      const reqId = ++reqRef.current;

      if (!silent) setIsLoading(true);
      else setIsRefreshing(true);

      setError(null);

      try {
        const res = await pelanggaranApi.getPelanggaran({ limit: 50 });

        // Abandon stale responses from previous santri
        if (reqId !== reqRef.current) return;

        setData(res.data ?? []);
        setRingkasan(res.ringkasan ?? null);
      } catch (err) {
        if (reqId !== reqRef.current) return;
        setError(getApiErrorMessage(err, 'Gagal memuat data pelanggaran. Silakan coba lagi.'));
      } finally {
        if (reqId === reqRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [activeSantriId, activeUnitId, enabled]
  );

  // Reset state saat santri berubah, lalu fetch ulang
  useEffect(() => {
    reqRef.current += 1;
    setData([]);
    setRingkasan(null);
    setError(null);
    setIsLoading(false);
    setIsRefreshing(false);
    if (enabled) fetchPelanggaran({ silent: false });
  }, [enabled, fetchPelanggaran]);

  return {
    data,
    ringkasan,
    isLoading,
    isRefreshing,
    error,
    refresh: () => fetchPelanggaran({ silent: true }),
  };
}
