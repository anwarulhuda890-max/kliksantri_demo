# KlikPesantren — Frontend Admin Environment Variables

Dokumen variabel lingkungan untuk **Admin Panel** (`frontend/`, Vite + React).

> Variabel `VITE_*` di-inject saat **build time**, bukan runtime. Set di Vercel **Environment Variables** sebelum deploy.

---

## Variabel yang diperlukan

| Variable | Wajib production | Dipakai di | Deskripsi |
|----------|------------------|------------|-----------|
| `VITE_API_BASE_URL` | **Ya** | `frontend/src/services/api.js` | Base URL API backend (HTTPS) |
| `VITE_PRIVACY_CONTROLLER_NAME` | Sebelum publikasi | `OfficialWebsitePages.jsx` | Nama badan hukum/pengelola pada privacy policy |
| `VITE_PRIVACY_ADDRESS` | Sebelum publikasi | `OfficialWebsitePages.jsx` | Alamat pengelola; fallback aman ditampilkan bila kosong |
| `VITE_PRIVACY_EMAIL` | Sebelum publikasi | `OfficialWebsitePages.jsx` | Email privasi/support |
| `VITE_ACCOUNT_DELETION_URL` | Sebelum publikasi | `OfficialWebsitePages.jsx` | URL HTTPS permintaan penghapusan akun |

### Efek downstream

| File | Ketergantungan |
|------|----------------|
| `frontend/src/services/api.js` | Axios `baseURL` |
| `frontend/src/utils/mediaUrl.js` | Resolve URL gambar `/uploads/...` |
| `frontend/src/pages/RFIDTopupPage.jsx` | Export window.open |
| `frontend/src/pages/RFIDTransactionPage.jsx` | Export window.open |

---

## Perilaku saat ini

```text
Production build:
  VITE_API_BASE_URL wajib → jika kosong, console.error + baseURL ""

Development (npm run dev):
  VITE_API_BASE_URL opsional → fallback http://localhost:3000
```

---

## Setup lokal

1. Copy template:
   ```bash
   cp frontend/.env.example frontend/.env
   ```
2. Isi:
   ```env
   VITE_API_BASE_URL=http://localhost:3000
   ```
3. Jalankan:
   ```bash
   cd frontend && npm run dev
   ```

---

## Setup Vercel

| Setting | Value |
|---------|-------|
| Framework Preset | Vite |
| Root Directory | `frontend` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Install Command | `npm install` |

**Environment Variables (Production):**

```env
VITE_API_BASE_URL=https://api.klikpesantren.com
```

> Tanpa trailing slash.

---

## Variabel privacy website

Variabel privacy di-inject saat build. Halaman tetap dapat dirender bila kosong, tetapi status Play Store tetap blocked sampai identitas, alamat, email, dan deletion URL production diisi serta diverifikasi.

---

## File bermasalah (bukan env, legacy)

| File | Masalah | Priority |
|------|---------|----------|
| `frontend/src/services/socket.js` | Hardcoded IP `10.68.244.56:3000` | P2 — legacy orphan |
| `frontend/src/pages/legacy/TransaksiPage.jsx` | Hardcoded `localhost:3000` export | P2 — legacy |

Tidak memblokir deploy admin utama jika halaman legacy tidak dipakai.

---

## Checklist frontend sebelum deploy

- [ ] `frontend/.env.example` ada di repo
- [ ] `VITE_API_BASE_URL` diset di Vercel Production
- [ ] `npm run build` sukses di CI/Vercel
- [ ] Login admin → API Railway (bukan localhost)
- [ ] Gambar banner/logo dari `/uploads` tampil (butuh backend + storage)
