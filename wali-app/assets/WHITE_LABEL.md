# White-Label Build — WaliSantri

Satu source Wali App menghasilkan build universal atau dedicated white-label. Jangan mengganti source/asset secara manual per customer.

## Commands

Universal config smoke:

`npm run build:android -- --brand=universal --config-only`

White-label config smoke:

`npm run build:android -- --brand=anwarulhuda --profile-file=./brands/anwarulhuda.test.json --config-only`

Release APK/AAB memakai command yang sama tanpa `--config-only`, dengan `--firebase=<path>` dan profile EAS. Script memvalidasi bahwa package di Firebase JSON sama persis dengan package Brand Profile sebelum build dimulai.

## App Icon (launcher)

| File | Purpose |
|------|---------|
| `assets/icon.png` | iOS / fallback icon (1024×1024 recommended) |
| `assets/android-icon-foreground.png` | Android adaptive icon foreground |
| `assets/android-icon-background.png` | Android adaptive icon background |
| `assets/android-icon-monochrome.png` | Android 13+ monochrome icon |

Asset final berasal dari Brand Profile yang dikelola Platform. File fixture Anwarul Huda hanya untuk config smoke dan bukan logo final publikasi.

Konfigurasi: `app.json` → `expo.icon` dan `expo.android.adaptiveIcon`.

## Splash (native boot)

| File | Purpose |
|------|---------|
| `assets/splash-icon.png` | Gambar splash native Expo |

Konfigurasi: `app.json` → `plugins.expo-splash-screen`.

- `backgroundColor`: `#16A34A` (hijau pesantren)
- Runtime splash in-app: `src/screens/auth/SplashScreen.jsx` (membaca cache branding)

## Favicon (web)

| File | Purpose |
|------|---------|
| `assets/favicon.png` | Web preview |

## Display name (store)

`app.config.js` menyelesaikan nama, package, asset, warna, version, dan tenant binding dari Brand Profile build.

Universal mempertahankan package existing `com.klikpesantren.wali` agar upgrade APK lama tidak putus. Dedicated package memakai format `com.klikpesantren.<brand_key>.wali` dan immutable setelah `PUBLISHED`.

## Runtime branding (tanpa rebuild)

White-label build config hanya dikelola Platform. Tenant branding operasional tetap dapat dipakai sebagai konten tenant, tetapi tidak dapat mengubah package/signing/build identity.

`Powered by KlikPesantren` selalu dipaksa oleh resolver. Build command membuat komposisi splash PNG dengan attribution; field untuk mematikannya tidak tersedia.

## Firebase provisioning

Setiap package dedicated wajib didaftarkan sebagai Android app tersendiri di Firebase. Simpan hanya `firebase_config_ref` di Brand Profile; simpan file JSON sebagai secret/artifact build eksternal. Jangan commit service-account/private key. Brand baru belum boleh dinaikkan ke `BUILD_READY` sebelum config package-matched tersedia.

Urutan logo:
1. `splash_logo_url` (splash & login)
2. `logo_url` (fallback)
3. Inisial pesantren (fallback UI)

Field `app_icon_url` disiapkan untuk pipeline build white-label berikutnya (lihat `app.json` untuk icon native saat ini).
