const CANONICAL_PRODUCTION_API_BASE_URL = 'https://api.klikpesantren.com';
const fs = require('node:fs');
const path = require('node:path');
const { resolveBuildBrand } = require('./config/buildBrand');

// Expo evaluates app config before export:embed. Keep local/EAS release
// bundles safe when the caller did not preload a public API environment file.
process.env.EXPO_PUBLIC_API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL || CANONICAL_PRODUCTION_API_BASE_URL;

module.exports = ({ config }) => {
  const buildMarker = path.resolve(__dirname, 'build-brand.resolved.json');
  const marker = fs.existsSync(buildMarker) ? JSON.parse(fs.readFileSync(buildMarker, 'utf8')) : null;
  const brand = resolveBuildBrand(marker ? { ...process.env, BUILD_BRAND: marker.brand_key, BUILD_BRAND_PROFILE: './build-brand.resolved.json' } : process.env);
  const logoPath = brand.logo && !/^https?:\/\//i.test(brand.logo) ? path.resolve(__dirname, brand.logo) : null;
  const logoDataUri = logoPath && fs.existsSync(logoPath)
    ? `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`
    : null;
  const splashPlugin = ['expo-splash-screen', {
    backgroundColor: '#FFFFFF', image: process.env.BRAND_SPLASH_ASSET || brand.splash_logo, imageWidth: 220, resizeMode: 'contain',
    dark: { backgroundColor: '#0F172A', image: process.env.BRAND_SPLASH_ASSET || brand.splash_logo },
  }];
  const plugins = (config.plugins || []).map((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    if (name === 'expo-splash-screen') return splashPlugin;
    if (name === 'expo-notifications' && Array.isArray(plugin)) return [name, { ...plugin[1], color: brand.primary_color }];
    return plugin;
  });
  return {
    ...config,
    name: brand.app_name,
    version: brand.current_version_name,
    icon: brand.icon,
    scheme: `klikpesantren-${brand.brand_key}`,
    plugins,
    ios: { ...config.ios, bundleIdentifier: brand.package_id },
    android: {
      ...config.android,
      package: brand.package_id,
      versionCode: Number(brand.current_version_code),
      googleServicesFile: brand.google_services_file || process.env.GOOGLE_SERVICES_JSON || config.android?.googleServicesFile,
      adaptiveIcon: {
        ...config.android?.adaptiveIcon,
        foregroundImage: brand.adaptive_foreground || brand.icon,
        backgroundImage: brand.adaptive_background,
        monochromeImage: brand.adaptive_monochrome,
      },
    },
    androidStatusBar: { ...config.androidStatusBar, backgroundColor: brand.primary_color },
    extra: {
      ...config.extra,
      buildBrand: {
        brand_key: brand.brand_key, mode: brand.mode, app_name: brand.app_name, short_name: brand.short_name,
        slogan: brand.slogan, primary_color: brand.primary_color,
        ...(brand.tenant_id ? { tenant_id: brand.tenant_id } : {}),
        ...(brand.tenant_slug ? { tenant_slug: brand.tenant_slug } : {}),
        logo: brand.logo, logo_data_uri: logoDataUri, powered_by_klikpesantren: true,
      },
    },
  };
};
