import { useState, useEffect, useCallback, useRef } from 'react';
import { santriApi } from '../api/santri.api';
import { getApiErrorMessage } from '../utils/apiError';
import { useActiveChild } from '../context/ActiveChildContext';

export function useDashboard(activeSantriId) {
  const { activeUnitId } = useActiveChild();
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const requestRef = useRef(0);

  const fetchDashboard = useCallback(async () => {
    if (!activeSantriId || !activeUnitId) return;
    const requestId = ++requestRef.current;

    setIsLoading(true);
    setError(null);

    try {
      const res = await santriApi.getDashboard();
      if (requestId !== requestRef.current) return;
      setData(res.data);
    } catch (err) {
      if (requestId !== requestRef.current) return;
      const msg = getApiErrorMessage(err, 'Gagal memuat data dashboard. Silakan coba lagi.');
      setError(msg);
    } finally {
      if (requestId === requestRef.current) setIsLoading(false);
    }
  }, [activeSantriId, activeUnitId]);

  // Fetch ulang setiap kali santri aktif berganti
  useEffect(() => {
    requestRef.current += 1;
    setData(null);
    fetchDashboard();
  }, [fetchDashboard]);

  return {
    data,
    isLoading,
    error,
    refresh: fetchDashboard,
  };
}
