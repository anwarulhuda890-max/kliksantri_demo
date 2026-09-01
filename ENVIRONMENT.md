# KlikPesantren — Backend Environment Variables

Dokumen referensi variabel lingkungan untuk **API Express** (`server.js`).

> **Jangan commit file `.env` ke Git.** Isi secret hanya di Railway Variables / `.env` lokal.

---

## Wajib (server tidak start tanpa ini)

| Variable | Deskripsi | Contoh dev | Contoh production |
|----------|-----------|------------|-------------------|
| `DB_USER` | Username PostgreSQL | `postgres` | dari Railway PG plugin |
| `DB_HOST` | Host PostgreSQL | `localhost` | `*.railway.app` internal host |
| `DB_NAME` | Nama database | `Administrasi Santri Digital` | `railway` |
| `DB_PASSWORD` | Password PostgreSQL | *(local only)* | dari Railway |
| `JWT_SECRET` | Secret JWT admin (`authMiddleware`, login admin) | random 64+ hex | random kuat, unik |

## Wajib untuk fitur Wali App API

| Variable | Deskripsi | Default jika kosong | Rekomendasi production |
|----------|-----------|---------------------|--------------------------|
| `WALI_JWT_SECRET` | Secret JWT wali | Tidak ada; server gagal start | **Wajib set** — secret kuat dan unik |
| `WALI_JWT_EXPIRES` | Expiry token wali | `30d` | `30d` atau sesuai kebijakan |
| `WALI_JWT_ALLOW_LEGACY_NO_AUD` | Kompatibilitas token lama tanpa audience | `true` | Set `false` setelah seluruh token lama melewati masa berlaku maksimum |
| `WALI_TOKEN_VERSION_ENABLED` | Revocation JWT melalui `wali_akun.token_version` | `false` | Set `true` hanya setelah migration 056 diterapkan dan diverifikasi |

## Server & networking

| Variable | Deskripsi | Default | Catatan |
|----------|-----------|---------|---------|
| `PORT` | Port HTTP | `3000` | Railway inject otomatis |
| `CORS_ORIGIN` | Origin Socket.io (admin) | — | URL admin canonical: `https://app.klikpesantren.com` |
| `FRONTEND_URL` | Fallback jika `CORS_ORIGIN` kosong | — | Sama dengan origin admin |
| *(dev fallback)* | Socket.io origin | `http://localhost:5173` | Hanya jika kedua env di atas kosong |

## Opsional (dev scripts saja)

| Variable | Dipakai oleh | Catatan |
|----------|--------------|---------|
| `API_BASE_URL` | `scripts/test-pengumuman-http.js` | Bukan runtime server |

---

## Sumber koneksi database

- **Satu entry point:** `db/index.js` via `require("./db")` atau `require("../db")`
- **Obsolete:** `db.js` (root) — sudah dihapus pada Phase P0
- Startup gagal dengan pesan `Missing required environment variable: ...` jika env DB/JWT tidak lengkap

---

## Railway — mapping variabel

1. Buat PostgreSQL service → Railway expose `PGHOST`, `PGUSER`, dll.
2. Map ke nama yang dipakai app:

| Railway (typical) | Set as |
|-------------------|--------|
| `PGUSER` | `DB_USER` |
| `PGHOST` | `DB_HOST` |
| `PGPASSWORD` | `DB_PASSWORD` |
| `PGDATABASE` | `DB_NAME` |
| `PGPORT` | `DB_PORT` |

3. Generate & set `JWT_SECRET`, `WALI_JWT_SECRET`
4. Set `CORS_ORIGIN` dan `FRONTEND_URL` = `https://app.klikpesantren.com` (HTTPS, tanpa trailing slash)

---

## File referensi di repo

| File | Fungsi |
|------|--------|
| `.env.example` | Template tanpa secret |
| `db/index.js` | Pool PostgreSQL |
| `server.js` | Load `dotenv`, `PORT`, Socket.io CORS |
| `middleware/authMiddleware.js` | `JWT_SECRET` |
| `routes/authRoutes.js` | `JWT_SECRET` |
| `services/waliAppService.js` | `WALI_JWT_SECRET`, `WALI_JWT_EXPIRES`, `WALI_JWT_ALLOW_LEGACY_NO_AUD` |

---

## Checklist env sebelum deploy backend

- [ ] Semua `DB_*` terisi dari PostgreSQL production
- [ ] `JWT_SECRET` unik & panjang
- [ ] `WALI_JWT_SECRET` unik (bukan default dev)
- [ ] Setelah masa transisi token lama selesai, `WALI_JWT_ALLOW_LEGACY_NO_AUD=false`
- [ ] `CORS_ORIGIN` / `FRONTEND_URL` = URL admin production
- [ ] `.env` tidak ter-commit (`.gitignore` sudah mencakup)
