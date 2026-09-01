import { useState, useEffect, useCallback, useRef } from 'react';
import { kesehatanApi } from '../api/kesehatan.api';
import { getApiErrorMessage } from '../utils/apiError';
import { useActiveChild } from '../context/ActiveChildContext';

export function useKesehatan(activeSantriId) {
  const { activeUnitId } = useActiveChild();
  const [current, setCurrent] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const reqRef = useRef(0);

  const fetchKesehatan = useCallback(async ({ silent = false } = {}) => {
    if (!activeSantriId || !activeUnitId) return;

    const reqId = ++reqRef.current;
    if (!silent) setIsLoading(true);
    setError(null);

    try {
      const res = await kesehatanApi.getKesehatan();
      if (reqId !== reqRef.current) return;
      setCurrent(res.current ?? null);
      setTimeline(res.timeline ?? []);
    } catch (err) {
      if (reqId !== reqRef.current) return;
      setError(getApiErrorMessage(err, 'Gagal memuat data kesehatan. Silakan coba lagi.'));
    } finally {
      if (reqId === reqRef.current) {
        setIsLoading(false);
      }
    }
  }, [activeSantriId, activeUnitId]);

  useEffect(() => {
    reqRef.current += 1;
    setCurrent(null);
    setTimeline([]);
    setError(null);
    fetchKesehatan({ silent: false });
  }, [fetchKesehatan]);

  return {
    current,
    timeline,
    isLoading,
    error,
    refresh: () => fetchKesehatan({ silent: true }),
  };
}
