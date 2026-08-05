import axios from "axios";
import { API_BASE_URL } from "./api";
import { clearPlatformSession, getPlatformToken } from "../utils/platformStorage";

const platformApi = axios.create({
  baseURL: API_BASE_URL,
});

platformApi.interceptors.request.use((config) => {
  const token = getPlatformToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

platformApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const sessionExpired = error.response?.data?.code === "SESSION_EXPIRED";
      clearPlatformSession();
      if (sessionExpired) {
        sessionStorage.setItem(
          "platform_auth_message",
          "Hak akses atau sesi Anda telah diperbarui. Silakan login ulang.",
        );
      }
      const onLogin = window.location.pathname.startsWith("/platform/login");
      if (!onLogin) {
        window.location.assign("/platform/login");
      }
    }
    return Promise.reject(error);
  }
);

export default platformApi;
