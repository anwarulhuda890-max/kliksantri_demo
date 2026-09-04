import React, {
  createContext,
  useContext,
  useReducer,
  useCallback,
} from 'react';
import { authApi } from '../api/auth.api';
import { storage } from '../utils/storage';
import { setLogoutCallback } from '../api/client';
import {
  registerPushTokenBackground,
  unregisterPushToken,
} from '../services/pushNotificationService';
import { BUILD_BRAND } from '../config/buildBrand';

const AuthContext = createContext(null);

const initialState = {
  isLoading: true,
  isAuthenticated: false,
  token: null,
  wali: null,
  anak: [],
  santriIds: [],
  mustChangePin: false,
  restoreError: null,
};

function authReducer(state, action) {
  switch (action.type) {
    case 'RESTORE_TOKEN':
      return {
        ...state,
        isLoading: false,
        isAuthenticated: true,
        token: action.token,
        wali: action.wali,
        anak: action.anak,
        santriIds: action.santriIds,
        mustChangePin: action.mustChangePin,
      };
    case 'LOGIN':
      return {
        ...state,
        isLoading: false,
        isAuthenticated: true,
        token: action.token,
        wali: action.wali,
        anak: action.anak,
        santriIds: action.santriIds,
        mustChangePin: action.mustChangePin,
      };
    case 'PIN_CHANGED':
      return {
        ...state,
        mustChangePin: false,
        wali: state.wali ? { ...state.wali, must_change_pin: false } : null,
      };
    case 'TOKEN_REPLACED':
      return { ...state, token: action.token };
    case 'LOGOUT':
      return { ...initialState, isLoading: false };
    case 'SET_LOADING':
      return { ...state, isLoading: action.value, restoreError: null };
    case 'RESTORE_ERROR':
      return { ...state, isLoading: false, restoreError: action.message };
    default:
      return state;
  }
}

export function AuthProvider({ children }) {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const pushRegisterInFlightRef = React.useRef(false);
  const pushRegisteredRef = React.useRef(false);

  const registerPushAfterAuthReady = useCallback(async (source) => {
    if (pushRegisteredRef.current) {
      return;
    }

    if (pushRegisterInFlightRef.current) {
      return;
    }

    pushRegisterInFlightRef.current = true;
    const result = await registerPushTokenBackground({ source });
    pushRegisterInFlightRef.current = false;

    if (result?.ok) {
      pushRegisteredRef.current = true;
    } else {
      pushRegisteredRef.current = false;
    }
  }, []);

  const logout = useCallback(async () => {
    pushRegisterInFlightRef.current = false;
    pushRegisteredRef.current = false;
    try {
      await unregisterPushToken();
    } finally {
      await storage.clearSession();
      dispatch({ type: 'LOGOUT' });
    }
  }, []);

  const handleInvalidSession = useCallback(() => {
    pushRegisterInFlightRef.current = false;
    pushRegisteredRef.current = false;
    dispatch({ type: 'LOGOUT' });
  }, []);

  // Daftarkan logout callback ke axios interceptor
  React.useEffect(() => {
    setLogoutCallback(handleInvalidSession);
    return () => setLogoutCallback(null);
  }, [handleInvalidSession]);

  const restoreSession = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', value: true });
    try {
      const token = await storage.getToken();

      if (!token) {
        dispatch({ type: 'SET_LOADING', value: false });
        return;
      }

      // Validasi token ke server
      const res = await authApi.me();
      const wali = res.wali;
      const anak = res.anak ?? [];
      const santriIds = res.santri_ids ?? [];

      if (!wali || !Array.isArray(anak) || anak.length === 0) {
        await storage.clearSession();
        dispatch({ type: 'LOGOUT' });
        return;
      }

      await storage.saveSession(token, wali, anak, santriIds);

      dispatch({
        type: 'RESTORE_TOKEN',
        token,
        wali,
        anak,
        santriIds,
        mustChangePin: wali.must_change_pin === true,
      });
      if (wali.must_change_pin !== true) {
        registerPushAfterAuthReady('restoreSession');
      }

    } catch (error) {
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        await storage.clearSession();
        dispatch({ type: 'LOGOUT' });
        return;
      }
      dispatch({
        type: 'RESTORE_ERROR',
        message: 'Sesi tersimpan belum dapat diperiksa. Periksa koneksi lalu coba lagi.',
      });
    }
  }, [registerPushAfterAuthReady]);

  const login = useCallback(async (nomor_hp, pin, tenant_slug) => {
    const res = await authApi.login(nomor_hp, pin, tenant_slug, BUILD_BRAND.brandKey);

    const {
      token,
      wali,
      anak = [],
      santri_ids: santriIds = [],
      tenant,
      must_change_pin: responseMustChangePin,
    } = res;

    const mustChangePin = responseMustChangePin === true || wali?.must_change_pin === true;

    if (!token || !wali || !Array.isArray(anak) || anak.length === 0) {
      const error = new Error('Akun belum memiliki santri aktif.');
      error.code = 'NO_CHILDREN';
      throw error;
    }

    const slug = tenant?.slug || tenant_slug || 'default';
    await storage.saveSession(token, wali, anak, santriIds, slug);

    dispatch({ type: 'LOGIN', token, wali, anak, santriIds, mustChangePin });
    if (!mustChangePin) {
      registerPushAfterAuthReady('login');
    }

    return { anak, santriIds, tenant };
  }, [registerPushAfterAuthReady]);

  const markPinChanged = useCallback(() => {
    dispatch({ type: 'PIN_CHANGED' });
    registerPushAfterAuthReady('pinChanged');
  }, [registerPushAfterAuthReady]);

  const replaceToken = useCallback(async (token) => {
    await storage.setToken(token);
    dispatch({ type: 'TOKEN_REPLACED', token });
  }, []);

  React.useEffect(() => {
    if (!state.isAuthenticated || !state.token || state.mustChangePin) return;
    registerPushAfterAuthReady('authStateEffect');
  }, [state.isAuthenticated, state.token, state.mustChangePin, registerPushAfterAuthReady]);

  return (
    <AuthContext.Provider value={{
      ...state,
      login,
      logout,
      restoreSession,
      markPinChanged,
      replaceToken,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
