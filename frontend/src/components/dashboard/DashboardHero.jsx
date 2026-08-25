import { useEffect, useMemo, useState } from "react";
import { getUser } from "../../utils/storage";
import { useTenantProfile } from "../../context/TenantProfileContext";
import { resolveMediaUrl } from "../../utils/mediaUrl";
import { isBannerVisible } from "../../utils/tenantProfile";
import "./DashboardHero.css";

const DEFAULT_BANNER = "/uploads/default-banner.jpg";

const HERO_QUOTE = {
  open: "\u275D",
  close: "\u275E",
  text: "Kelola pesantren dengan amanah,\nlayani santri dengan penuh berkah.",
};

function formatRoleLabel(role = "") {
  if (!role) return "Admin";
  if (role === "superadmin") return "Super Admin";
  return role
    .split(/[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function resolveHeroBannerUrl(bannerUrl) {
  if (bannerUrl?.trim()) {
    return resolveMediaUrl(bannerUrl.trim());
  }
  return resolveMediaUrl(DEFAULT_BANNER);
}

export function DashboardHero({ unitContext }) {
  const user = getUser();
  const { display, profile } = useTenantProfile();
  const roleLabel = formatRoleLabel(user?.role);
  const isUnitScope = unitContext?.scope === "unit";
  const isBlockedScope = unitContext?.scope === "blocked";
  const heroTitle = isUnitScope
    ? `Dashboard Unit ${unitContext.unitName || ""}`.trim()
    : isBlockedScope
      ? "Dashboard belum siap"
    : "Dashboard Yayasan / Semua Unit";

  const primaryBannerSrc = useMemo(() => {
    if (!isBannerVisible(profile)) {
      return resolveMediaUrl(DEFAULT_BANNER);
    }
    return resolveHeroBannerUrl(display?.banner_url);
  }, [display?.banner_url, profile]);

  const fallbackBannerSrc = useMemo(() => resolveMediaUrl(DEFAULT_BANNER), []);

  const [bannerSrc, setBannerSrc] = useState(primaryBannerSrc);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBannerSrc(primaryBannerSrc);
  }, [primaryBannerSrc]);

  function handleBannerError() {
    if (bannerSrc !== fallbackBannerSrc) {
      setBannerSrc(fallbackBannerSrc);
    }
  }

  return (
    <section className="dashboard-hero" aria-label="Dashboard hero">
      <img
        className="dashboard-hero__bg"
        src={bannerSrc}
        alt=""
        aria-hidden="true"
        onError={handleBannerError}
      />
      <div className="dashboard-hero__white-overlay" aria-hidden="true" />
      <div className="dashboard-hero__inner">
        <div className="dashboard-hero__content">
          <p className="dashboard-hero__greeting">
            Assalamu&apos;alaikum, {roleLabel} 👋
          </p>
          <h1 className="dashboard-hero__title">{heroTitle}</h1>
          <p className="dashboard-hero__subtext">
            {isUnitScope
              ? "Ringkasan data unit yang sudah memiliki atribusi unit aman."
              : isBlockedScope
                ? "Menunggu ruang kerja unit yang valid sebelum menampilkan ringkasan."
              : "Ringkasan Data Base dan Keuangan seluruh unit aktif."}
          </p>
        </div>

        <aside className="dashboard-hero__quote" aria-label="Kutipan motivasi">
          <span className="dashboard-hero__quote-mark dashboard-hero__quote-mark--open">
            {HERO_QUOTE.open}
          </span>
          <p>
            {HERO_QUOTE.text.split("\n").map((line, index) => (
              <span key={`quote-line_${index}`}>
                {line}
                {index < HERO_QUOTE.text.split("\n").length - 1 ? <br /> : null}
              </span>
            ))}
          </p>
          <span className="dashboard-hero__quote-mark dashboard-hero__quote-mark--close">
            {HERO_QUOTE.close}
          </span>
        </aside>
      </div>
    </section>
  );
}

export default DashboardHero;
