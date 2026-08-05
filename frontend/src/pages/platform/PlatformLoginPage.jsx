import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import platformApi from "../../services/platformApi";
import PlatformButton from "../../components/platform/PlatformButton";
import {
  getPlatformToken,
  setPlatformSession,
} from "../../utils/platformStorage";

function PlatformLoginStyles() {
  return (
    <style>{`
      .platform-login {
        min-height: 100vh;
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        background: var(--background);
      }

      .platform-login-brand {
        background: #0F172A;
        color: #F8FAFC;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 48px;
        box-sizing: border-box;
      }

      .platform-login-brand__badge {
        display: inline-flex;
        align-items: center;
        margin-bottom: 16px;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #BBF7D0;
        background: rgba(22, 101, 52, 0.22);
        border: 1px solid rgba(34, 197, 94, 0.28);
      }

      .platform-login-brand__eyebrow {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #86EFAC;
      }

      .platform-login-brand h1 {
        margin: 0;
        font-size: 32px;
        font-weight: 800;
        letter-spacing: -0.03em;
      }

      .platform-login-brand p {
        margin: 16px 0 0;
        font-size: 15px;
        line-height: 1.6;
        color: #94A3B8;
        max-width: 420px;
      }

      .platform-login-panel {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 32px 24px;
        background: var(--background);
      }

      .platform-login-mobile-banner {
        display: none;
        width: 100%;
        max-width: 400px;
        margin-bottom: 16px;
        padding: 12px 14px;
        border-radius: var(--radius-md);
        background: #0F172A;
        box-sizing: border-box;
      }

      .platform-login-card {
        width: 100%;
        max-width: 400px;
        background: var(--surface);
        border: 1px solid var(--border);
        border-top: 3px solid #166534;
        border-radius: var(--radius-xl);
        box-shadow: var(--shadow-card);
        padding: var(--space-6);
        box-sizing: border-box;
      }

      .platform-login-card h2 {
        margin: 0;
        font-size: 22px;
        font-weight: 700;
        color: var(--text-primary);
      }

      .platform-login-card .subtitle {
        margin: var(--space-2) 0 var(--space-5);
        font-size: 14px;
        color: var(--text-secondary);
      }

      .platform-field {
        margin-bottom: var(--space-4);
      }

      .platform-field label {
        display: block;
        font-size: 13px;
        font-weight: 600;
        margin-bottom: 6px;
        color: var(--text-primary);
      }

      .platform-field input {
        width: 100%;
        padding: 11px 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--surface);
        color: var(--text-primary);
        font-size: 14px;
        box-sizing: border-box;
        font-family: inherit;
        outline: none;
        transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
      }

      .platform-field input::placeholder {
        color: var(--text-muted);
        opacity: 1;
      }

      .platform-field input:focus {
        border-color: var(--primary);
        box-shadow: 0 0 0 3px var(--focus-ring);
      }

      .platform-error {
        margin-bottom: var(--space-4);
        padding: 10px 12px;
        border-radius: var(--radius-sm);
        background: var(--danger-subtle);
        color: var(--danger);
        font-size: 13px;
        font-weight: 600;
      }

      @media (max-width: 900px) {
        .platform-login {
          grid-template-columns: 1fr;
        }

        .platform-login-brand {
          display: none;
        }

        .platform-login-mobile-banner {
          display: block;
        }
      }
    `}</style>
  );
}

function PlatformLoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(() => {
    const message = sessionStorage.getItem("platform_auth_message") || "";
    if (message) sessionStorage.removeItem("platform_auth_message");
    return message;
  });
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(() => Boolean(getPlatformToken()));

  useEffect(() => {
    const token = getPlatformToken();
    if (!token) {
      return;
    }

    platformApi
      .get("/platform/auth/me")
      .then((res) => {
        if (res.data?.user?.platform) {
          navigate("/platform/dashboard", { replace: true });
        }
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await platformApi.post("/platform/auth/login", {
        username,
        password,
      });

      if (!res.data?.token) {
        setError("Login gagal. Periksa kredensial.");
        return;
      }

      setPlatformSession(res.data.token, res.data.user);
      navigate("/platform/dashboard", { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || "Login gagal. Periksa kredensial.");
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        Memuat...
      </div>
    );
  }

  return (
    <>
      <PlatformLoginStyles />
      <div className="platform-login">
        <div className="platform-login-brand">
          <span className="platform-login-brand__badge">Platform Mode</span>
          <p className="platform-login-brand__eyebrow">KlikPesantren Platform</p>
          <h1>Platform Console</h1>
          <p>
            Console administrasi multi-tenant untuk operator KlikPesantren.
            Kelola pesantren, pantau statistik, dan kontrol status layanan.
            Bukan panel operasional santri harian.
          </p>
        </div>

        <div className="platform-login-panel">
          <div className="platform-login-mobile-banner">
            <span style={{ color: "#E2E8F0", fontSize: 12, fontWeight: 700 }}>KlikPesantren Platform</span>
          </div>
          <div className="platform-login-card">
            <h2>Masuk Platform Console</h2>
            <p className="subtitle">Akun platform — bukan login pesantren</p>

            {error && <div className="platform-error">{error}</div>}

            <form onSubmit={handleSubmit}>
              <div className="platform-field">
                <label htmlFor="platform-username">Username</label>
                <input
                  id="platform-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>

              <div className="platform-field">
                <label htmlFor="platform-password">Password</label>
                <input
                  id="platform-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>

              <PlatformButton type="submit" loading={loading} style={{ width: "100%" }}>
                Masuk
              </PlatformButton>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}

export default PlatformLoginPage;
