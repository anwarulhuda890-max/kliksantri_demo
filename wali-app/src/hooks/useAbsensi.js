import { useState, useEffect, useCallback, useRef } from 'react';
import { absensiApi } from '../api/absensi.api';
import { getApiErrorMessage } from '../utils/apiError';
import { useActiveChild } from '../context/ActiveChildContext';

export function useAbsensi(activeSantriId, bulan, tahun, enabled = true) {
  const { activeUnitId } = useActiveChild();
  const [ringkasan, setRingkasan] = useState(null);
  const [riwayat, setRiwayat] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const reqRef = useRef(0);

  const fetchAbsensi = useCallback(
    async ({ silent = false } = {}) => {
      if (!activeSantriId || !activeUnitId || !enabled) return;

      const reqId = ++reqRef.current;

      if (!silent) setIsLoading(true);
      else setIsRefreshing(true);

      setError(null);

      try {
        const res = await absensiApi.getAbsensi({ bulan, tahun });

        if (reqId !== reqRef.current) return;

        setRingkasan(res.ringkasan ?? null);
        setRiwayat(res.riwayat ?? []);
      } catch (err) {
        if (reqId !== reqRef.current) return;
        setError(getApiErrorMessage(err, 'Gagal memuat data absensi. Silakan coba lagi.'));
      } finally {
        if (reqId === reqRef.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [activeSantriId, activeUnitId, bulan, tahun, enabled]
  );

  // Reset dan fetch ulang saat santri atau bulan/tahun berubah
  useEffect(() => {
    reqRef.current += 1;
    setRingkasan(null);
    setRiwayat([]);
    setError(null);
    setIsLoading(false);
    setIsRefreshing(false);
    if (enabled) fetchAbsensi({ silent: false });
  }, [enabled, fetchAbsensi]);

  return {
    ringkasan,
    riwayat,
    isLoading,
    isRefreshing,
    error,
    refresh: () => fetchAbsensi({ silent: true }),
  };
}
