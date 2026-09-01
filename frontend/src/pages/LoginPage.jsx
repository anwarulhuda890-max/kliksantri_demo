import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import axios from "axios";
import { API_BASE_URL } from "../services/api";
import api from "../services/api";
import Button from "../components/ui/Button";
import TenantBrand from "../components/TenantBrand";
import TenantPortalErrorPage from "./TenantPortalErrorPage";
import { setUser, getUser, clearSession } from "../utils/storage";
import { TENANT_SUSPEND_SESSION_KEY } from "../constants/tenant";
import {
  KLIKPESANTREN_LOGIN_BRANDING,
  LAST_TENANT_SLUG_KEY,
  normalizeTenantSlugInput,
  resolvePublicTenantDisplay,
} from "../utils/tenantProfile";
import { TENANT_LOGIN_QUERY_KEY } from "../utils/tenantPortal";

const SLUG_DEBOUNCE_MS = 500;

function LoginPageStyles() {
  return (
    <style>{`
      .login-page {
        min-height: 100vh;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        background: var(--background);
      }

      .login-branding {
        background: var(--dark);
        color: #F8FAFC;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 48px;
        box-sizing: border-box;
      }

      .login-branding-inner {
        max-width: 420px;
        width: 100%;
      }

      .login-tagline {
        margin: var(--space-5) 0 0;
        font-size: 15px;
        line-height: 1.6;
        color: #CBD5E1;
        font-weight: 500;
      }

      .login-powered {
        margin: var(--space-6) 0 0;
        font-size: 12px;
        color: var(--neutral);
        font-weight: 500;
      }

      .login-form-panel {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 32px 24px;
        box-sizing: border-box;
      }

      .login-form-card {
        width: 100%;
        max-width: 400px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-card);
        padding: var(--space-6);
        box-sizing: border-box;
      }

      .login-form-title {
        margin: 0;
        font-size: 22px;
        font-weight: 700;
        color: var(--text-primary);
        line-height: 1.25;
      }

      .login-form-subtitle {
        margin: var(--space-2) 0 var(--space-5);
        font-size: 14px;
        color: var(--text-secondary);
        line-height: 1.5;
      }

      .login-field {
        margin-bottom: var(--space-4);
      }

      .login-label {
        display: block;
        font-size: 13px;
        font-weight: 600;
        color: var(--text-primary);
        margin-bottom: 6px;
      }

      .login-helper {
        margin: 6px 0 0;
        font-size: 12px;
        color: var(--text-secondary);
        line-height: 1.4;
      }

      .login-input {
        width: 100%;
        padding: 11px 12px;
        border-radius: var(--radius-md);
        border: 1px solid var(--border);
        background: var(--surface);
        color: var(--text-primary);
        font-size: 14px;
        box-sizing: border-box;
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
      }

      .login-input::placeholder {
        color: var(--text-muted);
        opacity: 1;
      }

      .login-input:disabled {
        background: var(--surface-muted);
        color: var(--text-muted);
        cursor: not-allowed;
      }

      .login-input:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 3px var(--focus-ring);
      }

      .login-preview-hint {
        margin-bottom: var(--space-4);
        padding: 10px 12px;
        border-radius: var(--radius-sm);
        font-size: 13px;
        font-weight: 600;
        line-height: 1.5;
      }

      .login-preview-hint--info {
        background: var(--info-subtle);
        color: var(--info);
      }

      .login-preview-hint--warn {
        background: var(--warning-subtle);
        color: var(--warning);
      }

      .login-preview-hint--error {
        background: var(--danger-subtle);
        color: var(--danger);
      }

      .login-mobile-brand {
        display: none;
        background: var(--dark);
        padding: var(--space-5);
        box-sizing: border-box;
      }

      @media (max-width: 767px) {
        .login-page {
          grid-template-columns: 1fr;
        }

        .login-branding {
          display: none;
        }

        .login-mobile-brand {
          display: block;
        }

        .login-form-panel {
          padding: var(--space-5) var(--space-4) var(--space-6);
        }
      }
    `}</style>
  );
}

function LoginPage({ tenantSubdomain = false, hostnameTenantSlug = "" }) {
  const [searchParams] = useSearchParams();
  const [tenantSlug, setTenantSlug] = useState(() =>
    tenantSubdomain ? normalizeTenantSlugInput(hostnameTenantSlug) : ""
  );
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState(() => {
    const message = sessionStorage.getItem("auth_message") || "";
    if (message) sessionStorage.removeItem("auth_message");
    return message;
  });
  const [slugStatus, setSlugStatus] = useState("idle");
  const [slugMessage, setSlugMessage] = useState("");
  const [publicProfile, setPublicProfile] = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [tenantSessionConflict, setTenantSessionConflict] = useState(null);

  const slugFromUrl = useMemo(
    () => {
      if (tenantSubdomain) {
        return normalizeTenantSlugInput(hostnameTenantSlug);
      }
      return normalizeTenantSlugInput(
        searchParams.get(TENANT_LOGIN_QUERY_KEY) ||
          searchParams.get("tenant_slug")
      );
    },
    [hostnameTenantSlug, searchParams, tenantSubdomain]
  );

  const display = useMemo(() => {
    const normalized = normalizeTenantSlugInput(tenantSlug);
    if (!normalized) {
      return { ...KLIKPESANTREN_LOGIN_BRANDING, hasCustomName: false };
    }
    if (slugStatus === "found" && publicProfile) {
      return resolvePublicTenantDisplay(publicProfile);
    }
    if (slugStatus === "loading") {
      return resolvePublicTenantDisplay(publicProfile) || {
        ...KLIKPESANTREN_LOGIN_BRANDING,
        name: "Memuat...",
        hasCustomName: false,
      };
    }
    return { ...KLIKPESANTREN_LOGIN_BRANDING, hasCustomName: false };
  }, [tenantSlug, slugStatus, publicProfile]);

  const loginDisabled =
    !normalizeTenantSlugInput(tenantSlug) ||
    slugStatus === "loading" ||
    slugStatus === "not_found" ||
    slugStatus === "suspended" ||
    loginLoading;

  const fetchPublicProfile = useCallback(async (slug) => {
    const normalized = normalizeTenantSlugInput(slug);
    if (!normalized) {
      setSlugStatus("idle");
      setSlugMessage("");
      setPublicProfile(null);
      return;
    }

    setSlugStatus("loading");
    setSlugMessage("");

    try {
      const res = await axios.get(
        `${API_BASE_URL}/public/tenants/${encodeURIComponent(normalized)}/profile`
      );
      const data = res.data?.data;

      if (!data) {
        setSlugStatus("not_found");
        setSlugMessage("Kode pesantren tidak ditemukan");
        setPublicProfile(null);
        return;
      }

      setPublicProfile(data);

      if (data.service_available === false) {
        setSlugStatus("suspended");
        setSlugMessage(
          data.message ||
            "Layanan KlikPesantren untuk pesantren ini sedang tidak aktif."
        );
        return;
      }

      setSlugStatus("found");
      setSlugMessage("");
    } catch (err) {
      if (err.response?.status === 404) {
        setSlugStatus("not_found");
        setSlugMessage("Kode pesantren tidak ditemukan");
      } else {
        setSlugStatus("not_found");
        setSlugMessage("Gagal memuat profil pesantren");
      }
      setPublicProfile(null);
    }
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const user = getUser();

    if (token && user?.tenant_slug) {
      if (slugFromUrl && slugFromUrl !== user.tenant_slug) {
        setTenantSessionConflict({
          currentSlug: user.tenant_slug,
          currentName: user.tenant_nama || user.tenant_name || user.tenant_slug,
          requestedSlug: slugFromUrl,
        });
        return;
      }

      window.location.href = "/dashboard";
      return;
    }

    setTenantSessionConflict(null);

    const suspendMsg = sessionStorage.getItem(TENANT_SUSPEND_SESSION_KEY);
    if (suspendMsg) {
      setLoginError(suspendMsg);
      sessionStorage.removeItem(TENANT_SUSPEND_SESSION_KEY);
      return;
    }
  }, [slugFromUrl]);

  useEffect(() => {
    if (tenantSubdomain) {
      setTenantSlug(normalizeTenantSlugInput(hostnameTenantSlug));
      return;
    }

    if (slugFromUrl) {
      setTenantSlug(slugFromUrl);
      return;
    }

    const savedSlug = localStorage.getItem(LAST_TENANT_SLUG_KEY);
    if (savedSlug) {
      setTenantSlug(savedSlug);
    }
  }, [hostnameTenantSlug, slugFromUrl, tenantSubdomain]);

  const handleLogoutTenantSession = () => {
    clearSession();
    setTenantSessionConflict(null);
    setLoginError("");
    if (slugFromUrl) {
      setTenantSlug(slugFromUrl);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchPublicProfile(tenantSlug);
    }, SLUG_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [tenantSlug, fetchPublicProfile]);

  const handleSlugChange = (value) => {
    if (tenantSubdomain) return;
    setTenantSlug(normalizeTenantSlugInput(value));
    setLoginError("");
  };

  const login = async () => {
    if (loginDisabled) return;

    setLoginError("");
    setLoginLoading(true);

    const slug = normalizeTenantSlugInput(tenantSlug);

    try {
      const response = await api.post("/auth/login", {
        tenant_slug: slug,
        username,
        password,
      });

      localStorage.setItem("token", response.data.token);
      localStorage.setItem(LAST_TENANT_SLUG_KEY, slug);
      setUser(response.data.user);
      window.location.href = "/dashboard";
    } catch (err) {
      const msg =
        err.response?.data?.message ||
        err.response?.data?.error ||
        "Login gagal";
      setLoginError(msg);
    } finally {
      setLoginLoading(false);
    }
  };

  const previewHint = slugMessage ? (
    <div
      className={`login-preview-hint login-preview-hint--${
        slugStatus === "suspended" ? "warn" : "error"
      }`}
    >
      {slugMessage}
    </div>
  ) : slugStatus === "found" ? (
    <div className="login-preview-hint login-preview-hint--info">
      Pesantren ditemukan — layanan aktif
    </div>
  ) : null;

  const brandingBlock = (
    <>
      <TenantBrand
        variant="sidebar"
        size="lg"
        logo={display.logo}
        name={display.name}
        location={display.address}
      />
      <p className="login-tagline">
        {display.tagline || KLIKPESANTREN_LOGIN_BRANDING.tagline}
      </p>
      <p className="login-powered">Powered by KlikPesantren</p>
    </>
  );

  if (tenantSubdomain && slugStatus === "not_found") {
    return <TenantPortalErrorPage type="not_found" />;
  }

  if (tenantSubdomain && slugStatus === "suspended") {
    return (
      <TenantPortalErrorPage
        type={publicProfile?.status === "suspended" ? "suspended" : "inactive"}
      />
    );
  }

  return (
    <>
      <LoginPageStyles />
      <div className="login-page">
        <div className="login-mobile-brand">{brandingBlock}</div>

        <div className="login-branding">
          <div className="login-branding-inner">{brandingBlock}</div>
        </div>

        <div className="login-form-panel">
          <div className="login-form-card">
            <h1 className="login-form-title">Login Admin</h1>
            <p className="login-form-subtitle">
              Masuk ke panel administrasi pesantren Anda.
            </p>

            {tenantSessionConflict ? (
              <div
                className="login-preview-hint login-preview-hint--warn"
                style={{ marginBottom: "var(--space-4)" }}
              >
                Anda masih login sebagai{" "}
                <strong>{tenantSessionConflict.currentName}</strong> (
                {tenantSessionConflict.currentSlug}). Logout tenant untuk masuk
                ke <strong>{tenantSessionConflict.requestedSlug}</strong>.
                <div style={{ marginTop: 12 }}>
                  <Button variant="secondary" size="sm" onClick={handleLogoutTenantSession}>
                    Logout Tenant
                  </Button>
                </div>
              </div>
            ) : null}

            {loginError ? (
              <div
                className="login-preview-hint login-preview-hint--error"
                style={{ marginBottom: "var(--space-4)" }}
              >
                {loginError}
              </div>
            ) : null}

            {previewHint}

            {!tenantSubdomain ? (
              <div className="login-field">
                <label className="login-label" htmlFor="login-tenant-slug">
                  Kode Pesantren
                </label>
                <input
                  id="login-tenant-slug"
                  className="login-input"
                  type="text"
                  placeholder="contoh: al-hikmah"
                  value={tenantSlug}
                  onChange={(e) => handleSlugChange(e.target.value)}
                  autoComplete="organization"
                  autoCapitalize="none"
                  autoCorrect="off"
                />
                <p className="login-helper">
                  Masukkan kode pesantren yang diberikan admin KlikPesantren
                </p>
              </div>
            ) : null}

            <div className="login-field">
              <label className="login-label" htmlFor="login-username">
                Username
              </label>
              <input
                id="login-username"
                className="login-input"
                type="text"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                disabled={loginDisabled}
              />
            </div>

            <div className="login-field">
              <label className="login-label" htmlFor="login-password">
                Password
              </label>
              <input
                id="login-password"
                className="login-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                disabled={loginDisabled}
                onKeyDown={(e) => e.key === "Enter" && !loginDisabled && login()}
              />
            </div>

            <Button
              variant="primary"
              onClick={login}
              loading={loginLoading}
              disabled={loginDisabled}
              style={{ width: "100%" }}
            >
              Login
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export default LoginPage;
