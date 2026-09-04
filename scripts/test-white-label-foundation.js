const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.DB_USER ||= 'test'; process.env.DB_HOST ||= 'localhost'; process.env.DB_NAME ||= 'test'; process.env.DB_PASSWORD ||= 'test';
const root = path.resolve(__dirname, '..');
const appRoot = path.join(root, 'wali-app');
const { UNIVERSAL, resolveBuildBrand, assertFirebasePackage } = require(path.join(appRoot, 'config', 'buildBrand'));
const { sanitizeBrandKey, validatePackageId, deriveBrandColors } = require(path.join(root, 'services', 'appBrandProfileService'));

assert.equal(UNIVERSAL.app_name, 'WaliSantri');
assert.equal(UNIVERSAL.package_id, 'com.klikpesantren.wali');
assert.equal(UNIVERSAL.powered_by_klikpesantren, true);
const white = resolveBuildBrand({ BUILD_BRAND: 'anwarulhuda', BUILD_BRAND_PROFILE: './brands/anwarulhuda.test.json', BRAND_BUILD_STRICT: '1' }, appRoot);
assert.equal(white.app_name, 'Wali Anwarul Huda');
assert.equal(white.package_id, 'com.klikpesantren.anwarulhuda.wali');
assert.notEqual(white.package_id, UNIVERSAL.package_id);
assert.notEqual(white.icon, UNIVERSAL.icon);
assert.notEqual(white.primary_color, UNIVERSAL.primary_color);
assert.ok(white.tenant_id);
assert.equal(white.powered_by_klikpesantren, true);
assert.equal(sanitizeBrandKey('Anwarul Huda!'), 'anwarulhuda');
assert.equal(validatePackageId(white.package_id), true);
assert.equal(deriveBrandColors('#FFFFFF').foreground, '#0F172A');
assert.equal(deriveBrandColors('#000000').foreground, '#FFFFFF');

const migration = fs.readFileSync(path.join(root, 'migrations', '087_app_brand_profiles.sql'), 'utf8');
assert.match(migration, /UNIQUE INDEX[\s\S]*package_id/i);
assert.match(migration, /OLD\.status = 'PUBLISHED'/);
assert.doesNotMatch(migration, /powered_by_klikpesantren\s+(BOOLEAN|bool)/i);
const route = fs.readFileSync(path.join(root, 'routes', 'platformBrandRoutes.js'), 'utf8');
assert.match(route, /router\.use\(platformAuthMiddleware\)/);
assert.match(route, /platform\.brand\.manage/);
const waliRoutes = fs.readFileSync(path.join(root, 'routes', 'waliAppRoutes.js'), 'utf8');
assert.match(waliRoutes, /getWhiteLabelTenantSlug\(brand_key\)/);
assert.match(waliRoutes, /resolveTenantForLogin/);
for (const file of ['src/screens/auth/LoginScreen.jsx', 'src/screens/auth/SplashScreen.jsx', 'src/screens/profil/TentangAplikasiScreen.jsx']) {
  assert.match(fs.readFileSync(path.join(appRoot, file), 'utf8'), /Powered by KlikPesantren/);
}
assert.throws(() => assertFirebasePackage(path.join(appRoot, 'google-services.json'), white.package_id), /Firebase config tidak terdaftar/);
assert.equal(assertFirebasePackage(path.join(appRoot, 'google-services.json'), UNIVERSAL.package_id), true);
console.log('PASS white-label foundation: universal/white-label resolution, attribution, package uniqueness contract, platform-only route, tenant binding, Firebase package guard.');
