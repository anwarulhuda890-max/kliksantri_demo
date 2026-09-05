import { ADMIN_PRODUCT_BRAND } from "../constants/adminProductBrand";

export const TENANT_CACHE_KEY = "kliksantri_tenant_profile";
export const LAST_TENANT_SLUG_KEY = "last_tenant_slug";

export const TENANT_FALLBACKS = {
  name: "Pesantren",
  address: "Lengkapi profil pesantren",
  tagline: "Portal Wali Santri",
};

export const KLIKPESANTREN_LOGIN_BRANDING = {
  name: ADMIN_PRODUCT_BRAND.name,
  address: ADMIN_PRODUCT_BRAND.tagline,
  tagline: ADMIN_PRODUCT_BRAND.poweredBy,
  logo: ADMIN_PRODUCT_BRAND.logo,
};

export function normalizeTenantProfile(profile) {
  if (!profile) return null;

  return {
    ...profile,
    logo_url: profile.logo_url ?? null,
    banner_url: profile.banner_url ?? null,
    banner_active: profile.banner_active !== false,
    splash_logo_url: profile.splash_logo_url ?? null,
    app_icon_url: profile.app_icon_url ?? null,
    tagline: profile.tagline ?? null,
    tentang: profile.tentang ?? null,
  };
}

export function getCachedTenantProfile() {
  try {
    const raw = localStorage.getItem(TENANT_CACHE_KEY);
    return raw ? normalizeTenantProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function setCachedTenantProfile(profile) {
  if (!profile) {
    localStorage.removeItem(TENANT_CACHE_KEY);
    return;
  }
  localStorage.setItem(
    TENANT_CACHE_KEY,
    JSON.stringify(normalizeTenantProfile(profile)),
  );
}

function trimUrl(value) {
  const v = value?.trim();
  return v || null;
}

export function resolveSplashLogoUrl(profile) {
  const normalized = normalizeTenantProfile(profile);
  return trimUrl(normalized?.splash_logo_url) || trimUrl(normalized?.logo_url);
}

export function resolveAppIconUrl(profile) {
  const normalized = normalizeTenantProfile(profile);
  return trimUrl(normalized?.app_icon_url) || trimUrl(normalized?.logo_url);
}

export function resolveTenantTagline(profile, fallback = TENANT_FALLBACKS.tagline) {
  const normalized = normalizeTenantProfile(profile);
  return normalized?.tagline?.trim() || fallback;
}

export function resolveTenantDisplay(profile) {
  const normalized = normalizeTenantProfile(profile);
  const name = normalized?.nama_pesantren?.trim() || TENANT_FALLBACKS.name;
  const address = normalized?.alamat?.trim() || TENANT_FALLBACKS.address;
  const logo = trimUrl(normalized?.logo_url);
  const splash_logo = resolveSplashLogoUrl(normalized);
  const app_icon = resolveAppIconUrl(normalized);
  const tagline = resolveTenantTagline(normalized);
  const banner_url = trimUrl(normalized?.banner_url);
  const banner_active = normalized?.banner_active !== false;

  return {
    name,
    address,
    logo,
    splash_logo,
    app_icon,
    tagline,
    banner_url,
    banner_active,
    hasCustomName: Boolean(normalized?.nama_pesantren?.trim()),
  };
}

/** Map GET /public/tenants/:slug/profile → login / preview display */
export function resolvePublicTenantDisplay(publicProfile) {
  if (!publicProfile) {
    return { ...KLIKPESANTREN_LOGIN_BRANDING, hasCustomName: false };
  }

  const address =
    publicProfile.alamat?.trim() ||
    publicProfile.telepon?.trim() ||
    "";

  return {
    name: publicProfile.nama?.trim() || TENANT_FALLBACKS.name,
    address: address || TENANT_FALLBACKS.address,
    logo: trimUrl(publicProfile.logo_url),
    tagline:
      publicProfile.tagline?.trim() ||
      "Sistem Administrasi Pesantren Modern",
    primary_color: publicProfile.primary_color || null,
    powered_by_klikpesantren: true,
    hasCustomName: Boolean(publicProfile.nama?.trim()),
    service_available: publicProfile.service_available !== false,
    status: publicProfile.status,
    message: publicProfile.message,
  };
}

export function normalizeTenantSlugInput(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export function getTenantInitial(name = "") {
  const trimmed = name.trim();
  if (!trimmed) return "P";
  return trimmed.charAt(0).toUpperCase();
}

export function isBannerVisible(profile) {
  const normalized = normalizeTenantProfile(profile);
  if (!normalized) return false;
  if (normalized.banner_active === false) return false;
  return Boolean(normalized.banner_url?.trim());
}
