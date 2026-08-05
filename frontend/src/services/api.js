import axios from "axios";
import {
  TENANT_INACTIVE_MESSAGE,
  TENANT_SUSPEND_SESSION_KEY,
  isTenantSuspendedResponse,
} from "../constants/tenant";
import { clearSession } from "../utils/storage";

const DEV_API_FALLBACK = "http://10.10.2.140:3000";

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? DEV_API_FALLBACK : "")
).replace(/\/$/, "");

if (!API_BASE_URL) {
  console.error(
    "VITE_API_BASE_URL is required for production builds. Set it in frontend/.env",
  );
}

const api = axios.create({
  baseURL: API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status;
    const data = error.response?.data;

    if (isTenantSuspendedResponse(status, data)) {
      clearSession();
      sessionStorage.setItem(
        TENANT_SUSPEND_SESSION_KEY,
        data?.message || data?.error || TENANT_INACTIVE_MESSAGE
      );

      if (window.location.pathname !== "/") {
        window.location.href = "/";
      }
    }

    if (status === 401) {
      clearSession();
      const sessionExpired = data?.code === "SESSION_EXPIRED";
      sessionStorage.setItem(
        "auth_message",
        sessionExpired
          ? "Hak akses atau sesi Anda telah diperbarui. Silakan login ulang."
          : data?.error || "Sesi login berakhir. Silakan login ulang."
      );

      if (window.location.pathname !== "/") {
        window.location.href = "/";
        return new Promise(() => {});
      }
    }

    return Promise.reject(error);
  }
);

export default api;
