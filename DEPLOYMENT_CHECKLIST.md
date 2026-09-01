# KlikPesantren — Deployment Checklist

Arsitektur target:

| Komponen | Platform | Folder |
|----------|----------|--------|
| API + Socket.io + Uploads | **Railway** | repo root (`server.js`) |
| PostgreSQL | **Railway** (plugin) | managed |
| Admin Panel | **Vercel** (static) | `frontend/` |
| APK Wali | **Build lokal / EAS** | `wali-app/` |

> **Mode dokumen ini: persiapan saja. Jangan deploy tanpa menyelesaikan checklist per phase.**

---

## Hasil audit singkat

| Area | Status |
|------|--------|
| Backend `start` script | ✅ `npm start` → `node server.js` |
| Frontend `build` script | ✅ `npm run build` → Vite → `dist/` |
| DB single source | ✅ `db/index.js` (env-based); `db.js` obsolete dihapus |
| Admin API URL | ✅ `VITE_API_BASE_URL` (build-time) |
| Wali API URL | ✅ `API_BASE_URL` (build-time via dotenv) |
| Uploads persistent | ⚠️ Filesystem lokal — risiko Railway |
| Socket.io | ⚠️ Perlu `CORS_ORIGIN` production |
| Vercel full-stack | ❌ Backend tidak cocok Vercel serverless |
| Railway monolith API | ✅ Cocok dengan catatan storage + env |

---

## PHASE 1 — GitHub Ready

- [ ] Repo push ke GitHub (private recommended)
- [ ] `.env` **tidak** ter-commit (cek `git status`)
- [ ] `.env.example`, `frontend/.env.example`, `wali-app/.env.example` ada
- [ ] Dokumen env: `ENVIRONMENT.md`, `FRONTEND_ENV.md`, `WALI_ENV.md`
- [ ] `uploads/pesantren/.gitkeep` ada (folder structure)
- [ ] Review secrets: rotate jika pernah ter-commit
- [ ] Branch `main` stabil, P0 env fixes merged

**File referensi:** `.gitignore`, `.env.example`

---

## PHASE 2 — Backend Railway

### Service setup

- [ ] New Project → Deploy from GitHub repo
- [ ] Root directory: **repository root** (bukan `frontend/`)
- [ ] Start command: `npm start` (atau `node server.js`)
- [ ] Node version: 18+ / 20 LTS

### Environment variables

Set di Railway Variables (lihat `ENVIRONMENT.md`):

- [ ] `DB_USER`, `DB_HOST`, `DB_NAME`, `DB_PASSWORD`, `DB_PORT`
- [ ] `JWT_SECRET`
- [ ] `WALI_JWT_SECRET`
- [ ] `WALI_JWT_EXPIRES` (opsional, default `30d`)
- [ ] `CORS_ORIGIN` = URL Vercel admin (Phase 4)
- [ ] `PORT` — Railway inject otomatis

### Post-deploy backend

- [ ] `GET https://<api-domain>/` → `API Administrasi Santri Digital AKTIF`
- [ ] Logs tidak ada `Missing required environment variable`
- [ ] Public domain Railway aktif (HTTPS)

**Risiko:**

| Risiko | Mitigasi |
|--------|----------|
| Env DB salah | Test connection log, `GET /` + login |
| WALI_JWT default dev | Wajib override di Railway |
| Upload hilang saat redeploy | Phase 3 storage / volume |

---

## PHASE 3 — Database

### Provision

- [ ] Railway PostgreSQL plugin attached ke API service
- [ ] Map PG vars → `DB_*` (lihat `ENVIRONMENT.md`)

### Migration

- [ ] Jalankan migration SQL dari folder `migrations/` (22 files)
- [ ] Urutan: `001` → `022` (per nomor file)
- [ ] Verifikasi schema: startup `runStartupSchemaAudit` di log server
- [ ] Seed dev (`002_*`) — **jangan** di production kecuali sengaja

### Smoke DB

- [ ] Admin login berhasil
- [ ] Dashboard summary load (`GET /dashboard/summary`)
- [ ] Wali login (`POST /wali-app/login`)

**Catatan:** `migrations/run.js` hanya menjalankan subset (`001`, `002`) — production perlu strategi migration lengkap (manual atau script extended).

---

## PHASE 4 — Frontend Vercel

### Project setup

- [ ] Import GitHub repo
- [ ] Framework: **Vite**
- [ ] Root Directory: `frontend`
- [ ] Build: `npm run build`
- [ ] Output: `dist`
- [ ] Install: `npm install`

### Environment

- [ ] `VITE_API_BASE_URL=https://<railway-api-domain>` (Production)

### Post-deploy

- [ ] Admin login
- [ ] Dashboard + hero load
- [ ] Profil pesantren — upload banner (butuh uploads OK)
- [ ] Tidak ada request ke `localhost` di Network tab

**Risiko Vercel:**

| Item | Status |
|------|--------|
| Static SPA | ✅ |
| API calls cross-origin | ✅ jika CORS backend terbuka (`app.use(cors())`) |
| Socket.io legacy page | ⚠️ P2 — orphan |

---

## PHASE 5 — APK Build

- [ ] Set `wali-app/.env`:
  ```env
  API_BASE_URL=https://<railway-api-domain>
  ```
- [ ] `cd wali-app && npm install`
- [ ] `npx expo export --platform android` → hijau
- [ ] Install APK di device
- [ ] Log: `API_BASE_URL`, `LOGIN URL` benar
- [ ] Login smoke test (400/401 bukan network error)
- [ ] Dashboard banner foto tampil

**Distribusi APK:** di luar scope checklist ini (Play Store / sideload manual).

---

## PHASE 6 — Smoke Test (End-to-End)

### API (Railway)

| Test | Expected |
|------|----------|
| `GET /` | 200, text aktif |
| `POST /auth/login` (admin) | 401/400 salah kredensial |
| `POST /wali-app/login` | 401/400 salah kredensial |
| `GET /profil-pesantren` (auth) | 200 + data |

### Admin (Vercel)

| Test | Expected |
|------|----------|
| Login superadmin | Dashboard load |
| KPI metrics | Data dari API |
| Upload logo/banner | URL `/uploads/pesantren/...` |

### Wali (APK)

| Test | Expected |
|------|----------|
| Login | Sukses / error kredensial (bukan network) |
| Dashboard carousel | Foto + gradient |
| Pengumuman media | Cover load |

### Regression

- [ ] RBAC menu sesuai role (tidak diubah deploy prep)
- [ ] Tidak ada hardcoded LAN IP di runtime client production build

---

## Uploads — Risiko & Rekomendasi

### Struktur saat ini

| Path | Fungsi |
|------|--------|
| `uploads/pesantren/` | Logo, banner, cover (multer disk storage) |
| `routes/uploadRoutes.js` | `POST /upload/image` → `/uploads/pesantren/{file}` |
| `server.js` | `express.static('/uploads')` |

### Risiko Railway / Vercel

| Platform | Risiko |
|----------|--------|
| **Railway** | Filesystem **ephemeral** — upload hilang saat redeploy/restart kecuali volume |
| **Vercel** | **Tidak** host uploads — semua file via Railway API |

### Rekomendasi (P1 — post-P0)

1. **Railway Volume** mount ke `/uploads` (quick fix)
2. **Object storage** (S3 / Cloudflare R2 / Supabase Storage) — long-term
3. Jangan andalkan git untuk file upload (`uploads/pesantren/*` sudah gitignored)

---

## File bermasalah (audit)

### P0 — Sudah diperbaiki (Phase sebelumnya)

| File | Status |
|------|--------|
| `db.js` (hardcoded) | Dihapus |
| `frontend/src/services/api.js` | Pakai `VITE_API_BASE_URL` |
| `wali-app/src/api/client.js` | Pakai `@env`, dev fallback only |
| `server.js` Socket.io | Pakai `CORS_ORIGIN` / `FRONTEND_URL` |

### P1 — Improvement deploy

| Item | Catatan |
|------|---------|
| Root `package.json` `main: index.js` | File tidak ada — tidak blocker Railway |
| `recharts`, `@fontsource/*` di root deps | Mungkin unused di backend — audit deps |
| Migration runner incomplete | `migrations/run.js` hanya 2 file |
| Uploads persistent storage | Volume atau S3 |
| `app.use(cors())` terbuka | Pertimbangkan whitelist production |

### P2 — Dev / legacy (tidak blocker)

| File | Isi |
|------|-----|
| `scripts/audit-wali-login.js` | IP LAN hardcoded |
| `scripts/test-pengumuman-http.js` | localhost fallback |
| `frontend/src/services/socket.js` | IP hardcoded legacy |
| `frontend/src/pages/legacy/TransaksiPage.jsx` | localhost export |

### Dev fallback localhost (acceptable)

| File | Konteks |
|------|---------|
| `frontend/src/services/api.js` | Hanya `import.meta.env.DEV` |
| `wali-app/src/api/client.js` | Hanya `__DEV__` |
| `server.js` | Socket.io fallback jika env kosong |

---

## package.json audit

### Root (`/`)

| Script | Valid | Catatan |
|--------|-------|---------|
| `start` | ✅ | `node server.js` |
| `build` | ❌ tidak ada | Backend tidak perlu build step |
| `test` | placeholder | — |

### Frontend (`frontend/`)

| Script | Valid | Output |
|--------|-------|--------|
| `dev` | ✅ | Vite dev server :5173 |
| `build` | ✅ | `frontend/dist/` |
| `preview` | ✅ | Preview production build |

### Wali (`wali-app/`)

| Script | Valid | Catatan |
|--------|-------|---------|
| `start` | ✅ | `expo start` |
| `android` / `ios` | ✅ | Expo |
| `build` / `export` | ❌ tidak di package.json | Manual: `npx expo export --platform android` |

---

## Risiko deployment (ringkasan)

| # | Risiko | Severity | Phase |
|---|--------|----------|-------|
| 1 | Upload hilang redeploy Railway | **Tinggi** | 3 |
| 2 | `VITE_API_BASE_URL` tidak diset saat Vercel build | **Tinggi** | 4 |
| 3 | `API_BASE_URL` tidak diset saat APK export | **Tinggi** | 5 |
| 4 | `WALI_JWT_SECRET` default dev | **Tinggi** | 2 |
| 5 | Migration DB belum lengkap di production | **Tinggi** | 3 |
| 6 | Socket.io CORS salah origin | **Sedang** | 2 |
| 7 | Legacy socket hardcoded IP | **Rendah** | — |

---

## Dokumen terkait

- [ENVIRONMENT.md](./ENVIRONMENT.md) — Backend env
- [FRONTEND_ENV.md](./FRONTEND_ENV.md) — Admin Vite env
- [WALI_ENV.md](./WALI_ENV.md) — APK env
- [.env.example](./.env.example) — Template backend
- [frontend/.env.example](./frontend/.env.example) — Template admin
- [wali-app/.env.example](./wali-app/.env.example) — Template wali

---

**STOP — Jangan deploy, buat akun, atau buat database dari dokumen ini saja. Checklist ini panduan manual.**
