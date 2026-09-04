import Constants from 'expo-constants';

const raw = Constants.expoConfig?.extra?.buildBrand || {};

export const BUILD_BRAND = Object.freeze({
  brandKey: raw.brand_key || 'universal',
  mode: raw.mode === 'white_label' ? 'white_label' : 'universal',
  appName: raw.app_name || 'WaliSantri',
  shortName: raw.short_name || raw.app_name || 'WaliSantri',
  slogan: raw.slogan || 'Portal Wali Santri',
  primaryColor: /^#[0-9A-Fa-f]{6}$/.test(raw.primary_color || '') ? raw.primary_color : '#15803D',
  tenantId: raw.tenant_id || null,
  tenantSlug: raw.tenant_slug || null,
  logoUrl: raw.logo_data_uri || null,
  poweredByKlikPesantren: true,
});

export const IS_WHITE_LABEL = BUILD_BRAND.mode === 'white_label';
