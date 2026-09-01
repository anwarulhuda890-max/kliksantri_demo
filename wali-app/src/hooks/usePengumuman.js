import { useState, useEffect, useCallback, useRef } from 'react';
import { pengumumanApi } from '../api/pengumuman.api';
import { getApiErrorMessage } from '../utils/apiError';
import { useActiveChild } from '../context/ActiveChildContext';

export function usePengumuman(enabled = true) {
  const { activeSantriId, activeUnitId } = useActiveChild();
  const [data, setData] = useState([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const reqRef = useRef(0);

  const fetchList = useCallback(async ({ silent = false } = {}) => {
    if (!activeSantriId || !activeUnitId || !enabled) return;
    const reqId = ++reqRef.current;

    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);

    setError(null);

    try {
      const res = await pengumumanApi.getList({ limit: 50 });

      if (reqId !== reqRef.current) return;

      setData(res.data ?? []);
      setTotal(res.total ?? 0);
    } catch (err) {
      if (reqId !== reqRef.current) return;
      setError(getApiErrorMessage(err, 'Gagal memuat pengumuman. Silakan coba lagi.'));
    } finally {
      if (reqId === reqRef.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [activeSantriId, activeUnitId, enabled]);

  useEffect(() => {
    reqRef.current += 1;
    setData([]);
    setTotal(0);
    setError(null);
    setIsLoading(false);
    setIsRefreshing(false);
    if (enabled) fetchList({ silent: false });
  }, [enabled, fetchList]);

  return {
    data,
    total,
    isLoading,
    isRefreshing,
    error,
    refresh: () => fetchList({ silent: true }),
  };
}
