import { useEffect, useState } from "react";
import AppShell from "../layouts/AppShell";
import Card from "../components/ui/Card";
import { fetchPublicPlatformSettings } from "../services/platformPublicApi";
import { resolveMediaUrl } from "../utils/mediaUrl";
import { ADMIN_PRODUCT_BRAND, isUniversalAdminHost } from "../constants/adminProductBrand";

function AboutKlikPesantrenPage() {
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    fetchPublicPlatformSettings()
      .then((data) => {
        if (!cancelled) setSettings(data);
      })
      .catch(() => {
        if (!cancelled) setError("Gagal memuat informasi KlikPesantren.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const logoUrl = settings?.logo_url ? resolveMediaUrl(settings.logo_url) : null;

  return (
    <AppShell title="Tentang KlikPesantren" breadcrumb="Tentang KlikPesantren">
      <Card padding="md" shadow="card" radius="xl">
        {isUniversalAdminHost() ? (
          <div style={productHeaderStyle}>
            <img src={ADMIN_PRODUCT_BRAND.logo} alt="" style={productLogoStyle} />
            <div>
              <h1 style={titleStyle}>{ADMIN_PRODUCT_BRAND.name}</h1>
              <p style={taglineStyle}>{ADMIN_PRODUCT_BRAND.tagline}</p>
              <p style={poweredByStyle}>{ADMIN_PRODUCT_BRAND.poweredBy}</p>
            </div>
          </div>
        ) : null}

        {loading ? (
          <p style={mutedStyle}>Memuat...</p>
        ) : error ? (
          <p style={errorStyle}>{error}</p>
        ) : (
          <>
            <div style={headerStyle}>
              {logoUrl ? (
                <img src={logoUrl} alt="" style={logoStyle} />
              ) : (
                <div style={logoFallbackStyle}>
                  {(settings?.platform_name || "K").charAt(0)}
                </div>
              )}
              <div>
                <h1 style={titleStyle}>{settings?.platform_name || "KlikPesantren"}</h1>
                {settings?.tagline ? (
                  <p style={taglineStyle}>{settings.tagline}</p>
                ) : null}
              </div>
            </div>

            {settings?.description ? (
              <p style={bodyStyle}>{settings.description}</p>
            ) : null}

            {settings?.about_text ? (
              <div style={aboutBlockStyle}>
                <h2 style={sectionTitleStyle}>Tentang</h2>
                <p style={bodyStyle}>{settings.about_text}</p>
              </div>
            ) : null}

            <div style={contactBlockStyle}>
              <h2 style={sectionTitleStyle}>Hubungi Admin / Developer</h2>
              {settings?.support_whatsapp ? (
                <p style={bodyStyle}>
                  WhatsApp:{" "}
                  <a href={`https://wa.me/${settings.support_whatsapp.replace(/\D/g, "")}`}>
                    {settings.support_whatsapp}
                  </a>
                </p>
              ) : null}
              {settings?.support_email ? (
                <p style={bodyStyle}>
                  Email:{" "}
                  <a href={`mailto:${settings.support_email}`}>{settings.support_email}</a>
                </p>
              ) : null}
              {settings?.website_url ? (
                <p style={bodyStyle}>
                  Website:{" "}
                  <a href={settings.website_url} target="_blank" rel="noreferrer">
                    {settings.website_url}
                  </a>
                </p>
              ) : null}
            </div>

            {settings?.tutorial_video_url ? (
              <div style={videoBlockStyle}>
                <h2 style={sectionTitleStyle}>Video Tutorial</h2>
                <a href={settings.tutorial_video_url} target="_blank" rel="noreferrer">
                  {settings.tutorial_video_url}
                </a>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </AppShell>
  );
}

const productHeaderStyle = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  marginBottom: 24,
  paddingBottom: 20,
  borderBottom: "1px solid var(--border)",
};

const productLogoStyle = {
  width: 72,
  height: 72,
  borderRadius: 18,
  objectFit: "cover",
};

const poweredByStyle = {
  margin: "6px 0 0",
  color: "var(--text-secondary)",
  fontSize: "12px",
  fontWeight: 600,
};

const headerStyle = {
  display: "flex",
  alignItems: "center",
  gap: 16,
  marginBottom: 20,
};

const logoStyle = {
  width: 64,
  height: 64,
  borderRadius: 16,
  objectFit: "cover",
  border: "1px solid var(--border)",
};

const logoFallbackStyle = {
  width: 64,
  height: 64,
  borderRadius: 16,
  display: "grid",
  placeItems: "center",
  background: "var(--primary-subtle)",
  color: "var(--primary)",
  fontSize: 28,
  fontWeight: 800,
};

const titleStyle = {
  margin: 0,
  fontSize: "24px",
  fontWeight: 800,
};

const taglineStyle = {
  margin: "6px 0 0",
  color: "var(--text-secondary)",
  fontSize: "14px",
};

const sectionTitleStyle = {
  margin: "0 0 8px",
  fontSize: "16px",
  fontWeight: 700,
};

const bodyStyle = {
  margin: "0 0 12px",
  color: "var(--text-secondary)",
  lineHeight: 1.6,
  fontSize: "14px",
};

const aboutBlockStyle = {
  marginTop: 20,
  paddingTop: 20,
  borderTop: "1px solid var(--border)",
};

const contactBlockStyle = {
  marginTop: 20,
  paddingTop: 20,
  borderTop: "1px solid var(--border)",
};

const videoBlockStyle = {
  marginTop: 20,
  paddingTop: 20,
  borderTop: "1px solid var(--border)",
};

const mutedStyle = {
  color: "var(--text-secondary)",
};

const errorStyle = {
  color: "var(--danger)",
  fontWeight: 600,
};

export default AboutKlikPesantrenPage;
