# Wali Identity Resolution — Read-Only Review

Tanggal audit: 2026-08-05
Mode database: `BEGIN READ ONLY` lalu `ROLLBACK`
Scope: collision canonical phone dan wali tanpa akun login
Keputusan database: **tidak ada perubahan**

## Batas interpretasi audit

- `wali_app_audit` hanya mempunyai `nomor_hp`, tanpa `tenant_id` dan tanpa `wali_akun_id`. Event audit hanya dapat dicocokkan berdasarkan string nomor, bukan dibuktikan milik akun tertentu.
- IP address, user-agent, PIN, PIN hash, token, lock detail, dan secret lain tidak diambil atau ditampilkan.
- Waktu ditampilkan dalam WIB. Timestamp database yang dibaca tidak dimodifikasi.

## Collision 1 — Tenant Pondok Pesantren Anwarul Huda

- Tenant ID: `1`
- Tenant slug: `anwarulhuda313`
- Nomor legacy/original: `628123456789`
- Nomor canonical: `08123456789`
- Penyebab collision: normalisasi `62... → 08...` membuat kedua akun mempunyai identifier canonical yang sama.

### Akun A — legacy/dev

| Field | Nilai |
|---|---|
| Wali ID | Tidak ada relasi `wali_santri` |
| Nama wali/akun | Wali Contoh Dev |
| Nomor asli | `628123456789` |
| Nomor canonical | `08123456789` |
| Akun login | ID `3`, status `active` |
| Santri terhubung | Tidak ada |
| Login terakhir | Tidak pernah / `NULL` |
| Dibuat | 19 Juni 2026 20:13:31 WIB |
| Audit nomor terakhir | `PIN_CHANGED`, 9 Juni 2026 11:49:09 WIB |

Catatan penting: event audit tersebut terjadi sekitar 10 hari **sebelum** akun ID 3 dibuat. Karena audit tidak menyimpan tenant/account ID, event itu tidak dapat diatribusikan ke akun ID 3 dan tidak menjadi bukti penggunaan akun legacy ini.

### Akun B — canonical/terhubung

| Field | Nilai |
|---|---|
| Nama akun | Saeful Anwar |
| Nomor asli/canonical | `08123456789` |
| Akun login | ID `1`, status `active` |
| Login terakhir | 21 Juni 2026 22:44:53 WIB |
| Dibuat | 5 Juni 2026 00:50:45 WIB |
| Audit nomor terakhir | `login_failed`, 22 Juni 2026 19:41:17 WIB |

Relasi wali dan santri:

| Wali ID | Nama wali | Dibuat | Santri ID | Nama santri | Status santri |
|---:|---|---|---:|---|---|
| 1 | Saeful Anwar | 28 Mei 2026 06:43:57 WIB | 1 | Raihana Inarotur R | aktif |
| 3 | Saeful Anwar | 9 Juni 2026 11:24:40 WIB | 12 | Ahmad As'ad | aktif |

Catatan audit akun B juga bersifat phone-only. Namun `last_login` tersimpan langsung pada akun ID 1 dan menjadi evidence identitas yang lebih kuat.

### Rekomendasi collision

- **Akun yang dipertahankan:** akun B, ID 1, nomor `08123456789`.
- **Akun A:** jangan dipertahankan sebagai identitas canonical. Akun bernama dev, tidak mempunyai relasi wali/santri, dan tidak pernah login.
- **Merge aman:** ya, sebagai consolidation satu arah menuju akun B. Tidak ada relasi santri atau login akun A yang perlu dipindahkan.
- **Batas merge:** jangan menyalin credential, PIN, audit phone-only, atau session dari akun A ke akun B.
- **Tindakan nanti:** setelah approval operator, akun A dapat dinonaktifkan/diarsipkan melalui prosedur data resmi, kemudian migration 069 dapat dinilai ulang. Audit ini tidak melakukan tindakan tersebut.
- **Perlu keputusan operator untuk collision:** tidak ada ambiguitas identitas material, tetapi perubahan data tetap wajib mendapat approval operator.

## Wali tanpa akun login

| Field | Nilai |
|---|---|
| Wali ID | 26 |
| Nama wali | MT8-HIKMAH Wali Santri 1 |
| Tenant | Pesantren Al Hikmah (`tenant_id=37`, slug `al-hikmah`) |
| Nomor HP | `081299990001` |
| Nomor canonical | `081299990001` |
| Jumlah santri | 1 |
| Santri terhubung | MT8-HIKMAH Santri 1 |
| Dibuat | 22 Juni 2026 22:56:52 WIB |
| Nomor dipakai akun lain | Tidak |
| Matching account ID | Tidak ada |

Rekomendasi: **perlu keputusan operator**. Nama tenant/wali/santri menyerupai data smoke-test MT8. Operator harus memastikan apakah tenant dan identitas ini data uji atau data nyata. Jangan membuat akun otomatis dan jangan menetapkan PIN default. Jika data nyata, gunakan flow onboarding wali yang meminta verifikasi nomor dan penggantian PIN awal.

## Kesimpulan

| Kategori | Jumlah |
|---|---:|
| Collision canonical phone | 1 |
| Merge/consolidation aman | 1 |
| Collision yang masih ambigu | 0 |
| Manual review | 1 |
| Wali tanpa akun | 1 |

Kesimpulan operasional:

1. Pertahankan akun canonical ID 1 beserta dua relasi wali-santrinya.
2. Akun legacy/dev ID 3 adalah kandidat aman untuk dinonaktifkan/diarsipkan setelah approval; jangan merge credential atau audit.
3. Wali ID 26 harus diverifikasi operator sebagai data test atau data nyata sebelum onboarding akun.
4. Setelah kedua keputusan dicatat dan dieksekusi melalui change process terpisah, jalankan kembali preflight reconciliation secara read-only.

Tidak ada query `INSERT`, `UPDATE`, `DELETE`, DDL, migration, atau baseline ledger yang dijalankan dalam review ini.
