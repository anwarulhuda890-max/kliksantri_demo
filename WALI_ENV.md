# KlikPesantren — Wali App Environment Variables

Dokumen variabel lingkungan untuk **APK Wali Santri** (`wali-app/`, Expo + React Native).

> `API_BASE_URL` di-inject saat **bundle build** via `react-native-dotenv` + Babel. Harus diset **sebelum** `npx expo export`.

---

## Variabel yang diperlukan

| Variable | Wajib production build | Dipakai di | Deskripsi |
|----------|------------------------|------------|-----------|
| `API_BASE_URL` | **Ya** | `wali-app/src/api/client.js` | Base URL API backend |
| `API_BASE_URL` | **Ya** | `wali-app/src/utils/mediaUrl.js` | Resolve URL media/cover/banner |

### Tidak ada env lain

Audit menemukan **hanya `API_BASE_URL`** yang di-import dari `@env`.

Konfigurasi Babel (`wali-app/babel.config.js`):

- `moduleName: '@env'`
- `path: '.env'`
- `allowUndefined: true`

---

## Perilaku saat ini

```text
Production build (expo export):
  API_BASE_URL wajib di wali-app/.env
  Jika kosong → baseURL "" → login/network error

Development (__DEV__):
  Fallback http://localhost:3000 jika .env kosong
```

---

## Setup lokal

1. Copy template:
   ```bash
   cp wali-app/.env.example wali-app/.env
   ```
2. Isi (dev LAN atau localhost):
   ```env
   API_BASE_URL=http://localhost:3000
   ```
   Atau IP LAN server dev:
   ```env
   API_BASE_URL=http://192.168.x.x:3000
   ```
3. Jalankan:
   ```bash
   cd wali-app && npx expo start
   ```

---

## Setup production APK

1. Set `.env` **sebelum build**:
   ```env
   API_BASE_URL=https://<railway-api-domain>
   ```
2. Build:
   ```bash
   cd wali-app
   npx expo export --platform android
   ```
3. Verifikasi log saat startup app:
   ```text
   API_BASE_URL = https://...
   LOGIN URL = https://.../wali-app/login
   ```
4. Smoke test di device: login harus dapat **400/401**, bukan Network Error.

---

## Android — HTTP vs HTTPS

`wali-app/app.json` memiliki:

```json
"usesCleartextTraffic": true
```

- **HTTPS production:** recommended, cleartext tidak diperlukan
- **HTTP LAN dev:** cleartext diperlukan untuk Android 9+

---

## Sinkronisasi dengan Admin

| Client | Env var | Harus sama target |
|--------|---------|-------------------|
| Admin (Vercel) | `VITE_API_BASE_URL` | Railway API URL |
| Wali (APK) | `API_BASE_URL` | Railway API URL |

---

## File referensi

| File | Fungsi |
|------|--------|
| `wali-app/.env.example` | Template |
| `wali-app/.env` | Lokal (gitignored) |
| `wali-app/babel.config.js` | Dotenv plugin |
| `wali-app/src/api/client.js` | Axios client |
| `wali-app/src/utils/mediaUrl.js` | Media URL resolver |

---

## Checklist wali sebelum release APK

- [ ] `API_BASE_URL` HTTPS production (bukan IP LAN)
- [ ] Rebuild setelah ubah `.env` (env tidak bisa diubah tanpa rebuild)
- [ ] `POST /wali-app/login` smoke test di device
- [ ] Banner/cover image load (media URL pakai `API_BASE_URL` yang sama)
