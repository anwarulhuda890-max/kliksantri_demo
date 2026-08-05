# Sprint 0B — Migration Reconciliation KlikPesantren

Tanggal: 2026-08-05
Database audit: `READ ONLY`
Historical migrations 001–063: tidak diubah
Keputusan saat ini: **BLOCKED oleh rekonsiliasi data wali, bukan lagi oleh desain schema.**

## Canonical schema decisions

1. `users.status` memakai `Aktif` / `Nonaktif`, `NOT NULL`, default `Aktif`. Ini mengikuti login middleware, Users UI, onboarding, dan user routes aktif. Nilai Inggris dari migration 016 bukan canonical admin-web.
2. `guru.status` memakai `Aktif` / `Nonaktif`; `guru.nama` wajib. `absensi_guru` wajib mempunyai guru/bulan/tahun, unique `(guru_id,bulan,tahun)` untuk `ON CONFLICT`, serta composite tenant FK untuk mencegah relasi lintas tenant.
3. Absensi santri mempertahankan unique `(santri_id,tanggal,sesi)` karena itulah conflict target source aktif. Original 008 tidak boleh dijalankan karena menghapus duplikat; reconciliation hanya menambah constraint setelah guard menghasilkan nol duplicate.
4. Nomor wali canonical adalah format lokal `08...`. Tidak boleh merge/delete otomatis. Satu collision `62... -> 08...` saat ini wajib diputuskan operator berdasarkan kepemilikan akun.
5. `unit_pendidikan` unik per `(tenant_id, UPPER(kode))`, bukan global. Canonical code adalah `MADIN`; `MADINAH` hanya legacy input sebelum migration 064.
6. `user_kelas_scope` tetap diperlukan oleh middleware dan user routes. Final FK mengikat tenant+user dan tenant+kelas.
7. `mata_pelajaran` adalah catalog tenant yang dipetakan ke kelas melalui `kelas_mata_pelajaran`. Unit ownership diturunkan dari kelas; tidak ada seed mata pelajaran demo.
8. `alumni` tetap tenant-scoped, opsional terhubung ke santri, mempunyai snapshot `kelas_terakhir`, dan status `lulus/keluar`. Existing santri lulus/keluar dicopy additive; santri tidak dihapus.
9. `santri.kamar` dipertahankan sebagai compatibility field karena source aktif luas masih membacanya. Target jangka panjang tetap membership/asrama unit.
10. `wali_home_links`, `platform_website_settings`, dan `tenant_domains` wajib karena route/service aktif sudah memanggilnya. Tenant domain dibuat hanya sebagai draft; reconciliation tidak memanggil Cloudflare/Vercel.
11. `wali_akun.token_version` wajib sebelum flag revocation diaktifkan, default 0 dan tidak boleh negatif.
12. Permission kesehatan, alumni, konten, wallet, absensi, dan whitelist pimpinan mengikuti route aktif. Reconciliation hanya menambah/update canonical grant; tidak menghapus grant diam-diam.
13. Visible platform brand canonical adalah `KlikPesantren`. Hanya nilai legacy persis `KlikSantri` yang diubah; setting lain dipertahankan.

## Reconciliation matrix

| Migration | Status audit | Fungsi | Dependency source aktif | Kondisi sekarang | Tindakan final | Risiko |
|---|---|---|---|---|---|---|
| 001 | PARTIAL | Wali app/pengumuman/profil | Ya | Schema ada; unique global HP sudah diganti tenant-scoped | SUPERSEDED | P0 bila unique global dikembalikan |
| 002 | CANNOT | Akun wali demo | Tidak | Seed historis tak relevan | SUPERSEDED | P0 credential demo |
| 003 | CANNOT | Hotfix data demo | Tidak | Mengubah tiga santri pertama | SUPERSEDED | P0 korupsi data nyata |
| 004 | CANNOT | Pengumuman demo | Tidak | Data historis tak dapat dibuktikan | SUPERSEDED | P1 konten palsu |
| 005 | CANNOT | Profil demo singleton | Tidak | Berpotensi overwrite branding tenant | SUPERSEDED | P0 overwrite data |
| 006 | CANNOT | Normalisasi HP 62→08 | Ya | 1 legacy HP dan 1 target collision | APPLY_RECONCILIATION → 069 | P0 keputusan akun manual |
| 007 | CANNOT | Auto-create wali + PIN default | Diganti service | Ada 1 wali ber-HP tanpa akun | SUPERSEDED | P0 reset/default credential |
| 008 | NOT_APPLIED | Dedupe + unique absensi | Ya | Unique semantic sudah ada; duplicate 0 | SUPERSEDED; 065 menjamin invariant | P0 original memakai DELETE |
| 009 | DRIFTED | Guru/absensi guru awal | Ya | Tabel ada, nullability/FK berbeda | APPLY_RECONCILIATION → 065 | P1 constraint |
| 010 | PARTIAL | Kolom guru/status lowercase | Ya | Source memakai title-case | APPLY_RECONCILIATION → 065 | P1 nilai status salah |
| 011 | PARTIAL | Status guru title-case | Ya | Nilai cocok; constraint hilang | APPLY_RECONCILIATION → 065 | P1 write invalid |
| 012 | DRIFTED | Final guru overlapping | Ya | Schema sebagian cocok | APPLY_RECONCILIATION → 065 | P1 overlapping DDL |
| 013 | PARTIAL | Refactor absensi guru | Ya | Data bersih; FK target belum lengkap | APPLY_RECONCILIATION → 065 | P0 original menghapus orphan |
| 014 | CANNOT | Backfill akun + default PIN | Diganti service | Tidak aman untuk replay | SUPERSEDED | P0 credential massal |
| 016 | DRIFTED | Default users `active` | Ya | Semua 22 user memakai `Aktif` | APPLY_RECONCILIATION → 065 | P0 login bila salah canonical |
| 022 | CANNOT | Grant kesehatan superadmin | Ya | Kedua grant terbukti ada | BASELINE_AS_APPLIED | P2 |
| 023 | PARTIAL | Unit/kas/scope awal | Ya | Final schema tenant-scoped; global unique usang | SUPERSEDED | P0 global collision lintas tenant |
| 024 | CANNOT | MADIN→MADINAH | Tidak, arah lama | Architecture terbaru memilih MADIN | SUPERSEDED | P0 konflik dengan 064 |
| 026 | CANNOT | Pimpinan read-only | Ya | Whitelist lengkap; unsafe grant 0 | BASELINE_AS_APPLIED | P1 permission leakage |
| 050 | NOT_APPLIED | Scope kelas operator | Ya: middleware/routes | Tabel hilang | APPLY_RECONCILIATION → 066 | P0 endpoint 500 / scope bypass |
| 051 | NOT_APPLIED | Link beranda wali | Ya | Tabel hilang | APPLY_RECONCILIATION → 066 | P1 endpoint 500 |
| 052 | CANNOT | Rebrand platform | Ya | Value masih KlikSantri | APPLY_RECONCILIATION → 068 | P2 branding |
| 053 | NOT_APPLIED | Website CMS platform | Ya | Tabel hilang | APPLY_RECONCILIATION → 066 | P1 website/API gagal |
| 054 | NOT_APPLIED | Tenant domains | Ya | Tabel hilang | APPLY_RECONCILIATION → 066 | P0 domain module gagal |
| 055 | NOT_APPLIED | Custom domains | Ya | Final enum/field hilang bersama tabel | APPLY_RECONCILIATION → 066 | P0 domain type mismatch |
| 056 | NOT_APPLIED | Wali token version | Ya, feature-gated | Kolom hilang; flag wajib tetap off | APPLY_RECONCILIATION → 066 | P0 bila flag aktif terlalu awal |
| 057 | NOT_APPLIED | Mata pelajaran/kelas | Ya | Kedua tabel hilang | APPLY_RECONCILIATION → 067 | P0 pendidikan endpoint gagal |
| 058 | NOT_APPLIED | `santri.kamar` | Ya, dipakai luas | Kolom hilang | APPLY_RECONCILIATION → 067 | P0 banyak query gagal |
| 059 | NOT_APPLIED | Alumni + backfill | Ya | Tabel hilang | APPLY_RECONCILIATION → 067 | P0 dashboard/alumni gagal |
| 060 | NOT_APPLIED | Kelas terakhir alumni | Ya | Kolom ikut hilang | APPLY_RECONCILIATION → 067 | P1 histori tidak lengkap |
| 063 | CANNOT | Permission alumni/konten/wallet | Ya | Seluruh canonical grant terbukti ada | BASELINE_AS_APPLIED | P1 RBAC |

Migration 015, 017–021, 025, 027–049, dan 061–062 tetap `BASELINE_AS_APPLIED` berdasarkan catalog evidence. Migration 064 serta 065–069 adalah `APPLY_ORIGINAL` dengan urutan eksplisit di manifest.

## Historical migrations yang tidak pernah boleh direplay

- **SUPERSEDED:** 001–005, 007–008, 014, 023–024.
- **Digantikan reconciliation:** 006, 009–013, 016, 050–060.
- Runner membaca manifest v2: state `superseded` dan `replaced` tidak dimasukkan ke daftar eksekusi serta tidak dipalsukan sebagai ledger applied.

## Reconciliation migrations baru

| Order | File | Isi utama |
|---:|---|---|
| 100 | `065_reconcile_core_constraints.sql` | Canonical status users/guru, absensi unique, tenant-safe absensi guru. |
| 110 | `066_reconcile_missing_operational_schema.sql` | Scope kelas, wali links, CMS website, final tenant domain, token version. |
| 120 | `067_reconcile_academic_schema.sql` | Mata pelajaran, mapping kelas, kamar compatibility, alumni/backfill additive. |
| 130 | `068_reconcile_active_permissions.sql` | Permission/grant canonical dan visible brand. |
| 140 | `069_reconcile_wali_phone_canonical.sql` | Normalisasi HP tanpa merge/delete; collision adalah hard stop. |
| 150 | `064_multi_unit_foundation.sql` | Multi-unit foundation setelah reconciliation selesai. |

Seluruh file memakai transaksi dan guard. Tidak ada migration yang dijalankan pada Sprint 0B.

## Preflight read-only saat ini

Status: **BLOCKED**.

- Missing schema yang dipakai source aktif: 9 objek/kolom kelompok.
- Core data guru, users, absensi, absensi guru, unit, dan cross-tenant: anomaly 0.
- Permission canonical yang hilang: 0.
- Legacy platform brand: 1, dapat direkonsiliasi aman oleh 068.
- Legacy wali phone `62...`: 1.
- Collision hasil normalisasi wali `62... -> 08...`: **1 P0 blocker**.
- Wali ber-HP tanpa akun login: **1 manual review**. Migration tidak boleh membuat PIN default massal.

Data akun/nomor tidak dicetak. Operator harus menentukan akun mana yang sah, hubungan wali-santri, histori audit/session, dan prosedur deaktivasi/merge sebelum staging rehearsal dianggap siap.

## Final staging execution plan

Semua command perubahan berikut hanya untuk clone/staging setelah P0 wali selesai. Jangan jalankan terhadap production pada tahap ini.

### A. Backup dan restore clone

```bash
pg_dump --format=custom --no-owner --no-acl --file=klikpesantren-sprint0b.dump "$PRODUCTION_DATABASE_URL"
createdb klikpesantren_sprint0b_clone
pg_restore --exit-on-error --clean --if-exists --no-owner --no-acl --dbname="$CLONE_DATABASE_URL" klikpesantren-sprint0b.dump
```

Verifikasi restore melalui count tenant, users, santri, wali, guru, kelas, absensi, dan transaksi.

### B. Audit dan baseline state yang terbukti

```bash
DATABASE_URL="$CLONE_DATABASE_URL" npm run migration:baseline:check
DATABASE_URL="$CLONE_DATABASE_URL" npm run migration:baseline:plan
DATABASE_URL="$CLONE_DATABASE_URL" npm run migration:baseline:apply -- --confirm-production-baseline
DATABASE_URL="$CLONE_DATABASE_URL" npm run migration:status
```

Apply baseline hanya menulis 35 migration `BASELINE_AS_APPLIED`. Superseded/replaced tidak ditulis sebagai applied.

### C. Reconciliation pada clone

```bash
DATABASE_URL="$CLONE_DATABASE_URL" npm run migration:reconciliation:preflight
DATABASE_URL="$CLONE_DATABASE_URL" npm run migrate -- --to 069_reconcile_wali_phone_canonical.sql
DATABASE_URL="$CLONE_DATABASE_URL" npm run migration:reconciliation:preflight
```

Runner memakai execution order manifest 100–140. Jangan lanjut jika preflight pertama bukan `READY_FOR_RECONCILIATION` atau preflight kedua bukan `PASS`.

### D. Migration 064 pada clone

```bash
DATABASE_URL="$CLONE_DATABASE_URL" npm run migration:064:preflight
DATABASE_URL="$CLONE_DATABASE_URL" npm run migrate -- --to 064_multi_unit_foundation.sql
DATABASE_URL="$CLONE_DATABASE_URL" npm run migration:status
```

### E. Regression

```bash
npm run test:multi-unit
node scripts/test-wali-jwt-hardening.js
node scripts/test-tenant-domain-foundation.js
node scripts/test-custom-tenant-domain.js
```

Tambahkan smoke API untuk Users, Guru, Absensi, Scope Kelas, Mata Pelajaran, Alumni, Wali Links, Website CMS, dan Tenant Domains pada clone.

### F. Reconciliation count/data

Bandingkan count sebelum/sesudah. Wajib tetap sama untuk users, guru, santri, absensi, absensi_guru, wali_akun, wali_santri, transaksi, kelas, dan unit. Penambahan yang diharapkan hanya schema baru, draft tenant domain, dan snapshot alumni yang sumbernya jelas. Semua cross-tenant/orphan/duplicate check harus 0.

### G. Production plan

Production change window baru boleh disusun setelah dua rehearsal clone berhasil, backup restore diuji, P0 phone collision diselesaikan dengan bukti operator, token-version flag tetap off sampai 066 terverifikasi, durasi lock dicatat, dan rollback owner tersedia.

## Remaining risk

- **P0:** satu collision akun wali saat normalisasi nomor; tidak boleh diselesaikan otomatis.
- **P0:** source aktif saat ini mengakses sembilan kelompok schema yang belum ada.
- **P1:** satu wali ber-HP belum mempunyai akun; onboarding aman perlu keputusan manual, bukan default PIN migration.
- **P1:** lock/index/FK validation 064–067 harus diukur pada clone production-size.
- **P2:** visible legacy brand akan diperbaiki secara exact-match oleh reconciliation.

## Final status

**BLOCKED.** Rancangan schema dan jalur staging sudah lengkap, tetapi staging rehearsal belum boleh dimulai sampai collision akun wali diselesaikan secara manual dan preflight berubah dari `BLOCKED` menjadi `READY_FOR_RECONCILIATION`.
