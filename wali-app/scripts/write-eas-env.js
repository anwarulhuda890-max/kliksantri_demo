const fs = require('fs');
const path = require('path');

const CANONICAL_PRODUCTION_API_BASE_URL = 'https://api.klikpesantren.com';
const url = process.env.EXPO_PUBLIC_API_BASE_URL || CANONICAL_PRODUCTION_API_BASE_URL;
if (!url || !/^https:\/\//i.test(url)) {
  console.error('[eas-build-pre-install] EXPO_PUBLIC_API_BASE_URL production wajib menggunakan HTTPS');
  process.exit(1);
}

const envPath = path.join(__dirname, '..', '.env');
fs.writeFileSync(envPath, `EXPO_PUBLIC_API_BASE_URL=${url.replace(/\/$/, '')}\n`, 'utf8');
console.log('[eas-build-pre-install] Konfigurasi API production siap');
