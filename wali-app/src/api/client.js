import { create } from 'axios';
import { storage } from '../utils/storage';
import {
  isTenantSuspendedResponse,
} from '../constants/tenant';

const DEV_API_FALLBACK = 'http://10.10.2.140:3000';

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_BASE_URL || (__DEV__ ? DEV_API_FALLBACK : '')).replace(
  /\/$/,
  '',
);

if (!__DEV__ && !API_BASE_URL.startsWith('https://')) {
  throw new Error('Konfigurasi layanan production tidak valid.');
}

const api = create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(
  async (config) => {
    const token = await storage.getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    const santriId = await storage.getActiveSantriId();
    if (santriId) {
      config.headers['X-Santri-Id'] = String(santriId);
    }
    const unitId = await storage.getActiveUnitId();
    if (unitId) {
      config.headers['X-Unit-Id'] = String(unitId);
    }

    return config;
  },
  (error) => Promise.reject(error),
);

let _logoutCallback = null;
let _sessionInvalidationInFlight = false;

export function setLogoutCallback(fn) {
  _logoutCallback = fn;
}

function logAxiosError(error) {
  if (!__DEV__) return;
  console.warn('[api]', {
    code: error?.code || null,
    status: error?.response?.status || null,
  });
}

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    logAxiosError(error);
    const status = error.response?.status;

    if (
      !_sessionInvalidationInFlight &&
      (status === 401 || isTenantSuspendedResponse(status, error.response?.data))
    ) {
      _sessionInvalidationInFlight = true;
      try {
        await storage.clearSession();
        _logoutCallback?.();
      } finally {
        _sessionInvalidationInFlight = false;
      }
    }

    return Promise.reject(error);
  },
);

export { API_BASE_URL };
export default api;
