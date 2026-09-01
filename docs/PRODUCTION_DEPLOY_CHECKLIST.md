# KlikPesantren Production Deploy Checklist

## 1. Backup

- Ambil backup database Neon sebelum deploy.
- Simpan timestamp backup dan environment target.
- Pastikan akses restore sudah diuji minimal di database staging.
- Jangan lanjut deploy jika backup terakhir gagal atau tidak bisa diverifikasi.

## 2. Migration Order

- Jalankan migration sesuai urutan angka dari yang belum applied.
- Untuk current production baseline, pastikan migration penting ini applied:
  - 027
  - 029
  - 030
  - 032
  - 035
  - 036
  - 041
  - 042
  - 043
  - 044
  - 045
- Setelah migration, cek tabel inti:
  - tenants
  - tenant_features
  - feature_catalog
  - users
- Jangan menjalankan cleanup tenant bersamaan dengan migration.

## 3. Railway Deploy

- Set environment wajib:
  - DATABASE_URL
  - JWT_SECRET
  - WALI_JWT_SECRET
  - FRONTEND_URL
  - CORS_ORIGIN
- Pastikan `JWT_SECRET` dan `WALI_JWT_SECRET` bukan fallback/dev secret.
- Jika upload masih memakai local filesystem, gunakan Railway Volume untuk path `uploads`.
- Setelah deploy, cek health endpoint atau root API.

## 4. Vercel Deploy

- Set environment frontend:
  - VITE_API_URL
- Pastikan URL mengarah ke Railway production API, bukan localhost.
- Deploy frontend setelah backend dan migration selesai.
- Buka halaman platform login dan tenant login untuk cek koneksi API.

## 5. Smoke Test

- Jalankan backend syntax check.
- Jalankan frontend build.
- Jalankan smoke utama:
  - MT-8 tenant simulation
  - MT-10 package preset
  - MT-11 tenant health and cleanup
  - MT-12 billing foundation
- Setelah rotasi password platform, set `SMOKE_PLATFORM_PASS` saat menjalankan smoke.
- Pastikan tenant `default` dan `al-hikmah` tetap ada kecuali memang sengaja memakai dummy lain.

## 6. Rollback

- Jika deploy backend gagal sebelum migration, rollback service Railway ke release sebelumnya.
- Jika migration sudah applied dan deploy gagal, pilih rollback aplikasi atau restore database sesuai tingkat kerusakan.
- Untuk data production, jangan hard delete tenant sebagai langkah rollback.
- Catat error, release id, migration terakhir, dan waktu kejadian.
- Setelah rollback, ulang smoke minimal:
  - platform login
  - tenant login
  - feature management
  - billing detail
