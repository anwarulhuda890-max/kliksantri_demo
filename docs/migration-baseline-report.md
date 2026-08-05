# Migration Baseline Review — Multi-Unit KlikPesantren

> Snapshot Sprint 0A. Keputusan final per migration dan execution order telah dilanjutkan di `migration-reconciliation-report.md`; manifest v2 menggantikan policy blocker lama.

Tanggal audit: 2026-08-05
Mode database: **READ ONLY**
Keputusan: **BLOCKED — baseline ledger dan migration 064 belum boleh dijalankan.**

## Ringkasan

| Status | Jumlah | Makna |
|---|---:|---|
| `VERIFIED_APPLIED` | 32 | Seluruh efek schema yang dapat diparsing ditemukan dan cocok. |
| `PARTIALLY_APPLIED` | 5 | Sebagian efek ditemukan; tidak boleh dibaseline. |
| `NOT_APPLIED` | 12 | Efek schema tidak ditemukan; tetap pending. |
| `DRIFTED` | 3 | Objek ada tetapi tipe/nullability/default/constraint berbeda. |
| `CANNOT_VERIFY` | 12 | Migration berbasis data/permission tanpa bukti schema persisten; perlu bukti manual. |

Audit tidak menyimpulkan suatu migration applied hanya karena migration bernomor lebih tinggi sudah tercermin. Database terbukti non-linear: 061–062 ada, sedangkan 050–060 sebagian besar tidak ada.

## Status setiap migration

| Status | Migration |
|---|---|
| `VERIFIED_APPLIED` | 015, 017–021, 025, 027–049, 061–062 |
| `PARTIALLY_APPLIED` | 001, 010, 011, 013, 023 |
| `NOT_APPLIED` | 008, 050–051, 053–060, 064 |
| `DRIFTED` | 009, 012, 016 |
| `CANNOT_VERIFY` | 002–007, 014, 022, 024, 026, 052, 063 |

Checksum, evidence objek per migration, catatan, dan tindakan rekomendasi terdapat di `docs/migration-baseline-manifest.json`.

## Temuan schema penting

- Migration 001: tabel/kolom/index ditemukan, tetapi constraint unik inline `wali_akun.nomor_hp` dari source tidak ditemukan sebagai constraint database.
- Migration 008: constraint unik `(santri_id, tanggal, sesi)` tidak ditemukan.
- Migration 009/012: `guru.nama`, `absensi_guru.guru_id`, `bulan`, dan `tahun` nullable, sementara source migration mengharuskan `NOT NULL`; `guru_status_check` juga tidak ditemukan.
- Migration 010/011: kolom-kolomnya ada, tetapi `guru_status_check` tidak ada.
- Migration 013: kolom `guru_id` ada. Unique ekuivalen ditemukan dengan nama `absensi_guru_unique`, bukan nama dari source; foreign key `fk_absensi_guru_guru_id` tidak ditemukan.
- Migration 016: source mengharapkan default `users.status = 'active'`, sedangkan catalog database berisi default `'Aktif'`; ini drift nilai, bukan sekadar beda formatting SQL.
- Migration 023: objek kas/unit ada, tetapi unique global `unit_pendidikan(kode)` dari source lama sudah tidak ada; schema sekarang memakai uniqueness tenant-scoped dari evolusi sesudahnya. Tetap diklasifikasikan partial terhadap source historis, bukan diasumsikan applied.
- Migration 050–060 tidak boleh dianggap applied. Migration 052 hanya DML sehingga `CANNOT_VERIFY`, bukan bukti applied.
- Migration 061–062 terverifikasi walaupun rangkaian sebelumnya tidak lengkap.
- Migration 064 belum diterapkan: 74 efek schema yang diaudit belum ditemukan.

Parser audit membandingkan tabel, kolom, tipe, nullability/default expression, index, named constraint, constraint inline PK/unique/FK, trigger, function, dan enum yang dinyatakan oleh source SQL. DML/backfill historis tidak dapat dibuktikan hanya melalui catalog PostgreSQL sehingga selalu diberi peringatan atau `CANNOT_VERIFY` bila tidak ada efek schema persisten.

## Baseline policy

- Hanya `VERIFIED_APPLIED` yang eligible setelah review manusia.
- `PARTIALLY_APPLIED`, `DRIFTED`, dan `CANNOT_VERIFY` adalah blocker keras.
- `NOT_APPLIED` tetap pending dan tidak dimasukkan ke ledger.
- Tool apply hanya menulis filename/checksum ke `schema_migrations` dalam satu transaksi; tidak menjalankan SQL lama.
- Apply mewajibkan `DATABASE_URL` eksplisit dan flag `--confirm-production-baseline`, menampilkan hanya hostname/database, lalu menolak manifest yang masih memiliki blocker.

Karena manifest saat ini memiliki 20 blocker keras, command apply memang harus menolak. Jangan edit status manifest untuk melewati blocker; buat bukti/remediation migration tersendiri, audit ulang, lalu review checksum.

## Review migration 064

### Idempotency

Sebagian besar DDL memakai `IF NOT EXISTS` dan seed memakai `ON CONFLICT`. Migration tetap bukan idempotent sempurna: beberapa constraint di-drop lalu dibuat ulang, dan `CREATE TABLE IF NOT EXISTS` tidak memperbaiki tabel yang sudah terbentuk parsial. Karena itu migration wajib dijalankan sekali oleh ledger setelah preflight, bukan diulang manual.

### Locking, rewrite, index, dan foreign key

- `ALTER TABLE`, `SET NOT NULL`, drop/add constraint, dan index biasa membutuhkan lock. Risiko terbesar adalah menunggu lock tanpa batas dan blok write selama validasi/scan.
- Backfill `unit_type`, `preset_key`, dan `tenant_id` melakukan update row. Kolom dengan default/not-null dapat memerlukan scan atau rewrite tergantung versi PostgreSQL dan ekspresi default.
- Unique index pada `santri`, `users`, `kelas`, dan `unit_pendidikan` dibuat non-concurrent karena migration berada dalam transaksi. Ini aman secara atomic, tetapi dapat menahan write saat index dibangun.
- Composite foreign key memvalidasi data existing saat ditambahkan. Preflight mengurangi risiko kegagalan, tetapi validasi tetap membutuhkan scan dan lock terkait.
- Database yang diaudit kecil (2 tenant, 16 unit, 7 santri, 8 kelas, 3 guru, 22 user, 8 scope), sehingga waktu eksekusi kemungkinan singkat. Estimasi produksi tetap harus memakai jumlah row staging terbaru dan pengukuran `EXPLAIN`/durasi nyata; jangan menjanjikan zero downtime.

Tidak ada perubahan pada migration 064 dalam review ini. Source migration konsisten dengan model additive dan preflight saat ini lulus; menambahkan timeout atau memecah index secara concurrent akan mengubah strategi transaksi dan harus menjadi keputusan deployment tersendiri, bukan perubahan diam-diam pada baseline review.

### Existing code dan konflik

- Preflight menemukan 0 duplicate canonical unit code per tenant.
- Tidak ada tenant yang mempunyai `MADIN` dan `MADINAH` sekaligus.
- Source 064 mengubah `MADINAH` menjadi `MADIN` setelah guard duplicate.
- Code lain yang dikenal dipetakan ke preset sekolah/pesantren; code tak dikenal tetap diberi `unit_type=CUSTOM` dan kode aslinya dinormalisasi uppercase.

### User scope dan cross-tenant

Schema saat ini belum memiliki `user_unit_scope.status`, sehingga semua scope existing diperlakukan aktif oleh preflight. Tidak ditemukan duplicate scope, orphan, atau relasi lintas tenant. Tidak ditemukan kelas/guru/unit/santri-kelas lintas tenant dan tidak ditemukan role pusat yang tenant ownership-nya invalid.

### Rollback strategy

Rollback utama adalah restore database staging/production dari backup teruji. Jangan mencoba rollback destruktif otomatis setelah aplikasi mulai menulis ke tabel baru karena dapat membuang membership baru. Sebelum aktivasi aplikasi, rollback teknis dapat dilakukan dengan menghentikan writer, memastikan tidak ada data baru, lalu menjalankan SQL rollback yang telah direview atau restore. Setelah aktivasi, gunakan forward-fix/additive remediation.

Kriteria rollback: migration error/timeout, lock melewati change-window, constraint gagal, jumlah membership/backfill tidak sesuai rekonsiliasi, cross-tenant anomaly > 0, atau regression test tenant isolation gagal.

## Hasil preflight 064

`scripts/preflight-migration-064.js` membuka `BEGIN READ ONLY`, memeriksa 13 kategori, dan melakukan `ROLLBACK`.

- Status: `PASS`
- Blocker data: 0
- Duplicate canonical/MADIN conflict: 0
- Cross-tenant kelas, guru, scope, santri-kelas: 0
- Duplicate active scope: 0
- Invalid tenant/orphan relation: 0
- Invalid central/all-unit role ownership: 0

PASS preflight hanya berarti data saat audit kompatibel dengan 064. Ini tidak menghapus blocker baseline migration 002–014 dan 050–063.

## Rencana staging — jangan dijalankan pada tahap review ini

Gunakan terminal Unix/Linux pada environment staging, ganti path backup yang aman, dan jangan menaruh credential dalam log/screenshot.

1. Backup production dan verifikasi file:

   ```bash
   pg_dump --format=custom --no-owner --no-acl --file=klikpesantren-pre-064.dump "$DATABASE_URL"
   pg_restore --list klikpesantren-pre-064.dump >/dev/null
   ```

2. Buat database staging kosong dan restore test:

   ```bash
   createdb klikpesantren_064_restore_test
   pg_restore --exit-on-error --clean --if-exists --no-owner --no-acl --dbname="postgresql://USER@HOST/klikpesantren_064_restore_test" klikpesantren-pre-064.dump
   ```

3. Arahkan `DATABASE_URL` eksplisit ke database restore, audit baseline, dan selesaikan semua blocker sebelum apply:

   ```bash
   DATABASE_URL="postgresql://USER@HOST/klikpesantren_064_restore_test" npm run migration:baseline:check
   DATABASE_URL="postgresql://USER@HOST/klikpesantren_064_restore_test" npm run migration:baseline:plan
   DATABASE_URL="postgresql://USER@HOST/klikpesantren_064_restore_test" npm run migration:baseline:apply -- --confirm-production-baseline
   ```

   Command apply terakhir hanya boleh dijalankan setelah manifest hasil audit baru tidak memiliki `PARTIALLY_APPLIED`, `DRIFTED`, atau `CANNOT_VERIFY`. Kondisi sekarang belum memenuhi syarat.

4. Periksa ledger/status dan preflight:

   ```bash
   DATABASE_URL="postgresql://USER@HOST/klikpesantren_064_restore_test" npm run migration:status
   DATABASE_URL="postgresql://USER@HOST/klikpesantren_064_restore_test" npm run migration:dry-run
   DATABASE_URL="postgresql://USER@HOST/klikpesantren_064_restore_test" npm run migration:064:preflight
   ```

5. Jangan menjalankan `npm run migrate` hanya untuk mengejar 064 selama migration 008 dan 050–060 masih pending. Remediasi/buktikan migration lama satu per satu, audit ulang, lalu gunakan runner terurut setelah daftar pending telah disetujui. Menjalankan 064 langsung dengan `psql -f` juga dilarang karena melewati ledger.

6. Setelah baseline/remediation sah di staging, jalankan rangkaian pending yang disetujui melalui migration runner, ukur durasi dan lock, lalu:

   ```bash
   npm run migration:status
   npm run migration:064:preflight
   npm run test:multi-unit
   npm run migration:status
   ```

7. Rekonsiliasi jumlah tenant/unit/santri/kelas/guru/scope sebelum-sesudah, pastikan anomaly tetap 0, uji tenant isolation, admin unit tanpa scope, multi-membership santri, dan fitur preset.

8. Production hanya pada change window setelah restore test terbukti, baseline bebas blocker, staging migration sukses, regression lulus, backup dapat direstore, owner rollback hadir, serta monitoring query/lock siap.

## Prioritas risiko

- **P0:** baseline history tidak linear dan 20 migration berstatus partial/drift/cannot-verify. Runner tidak boleh digunakan untuk mengejar 064 sebelum ini diselesaikan.
- **P0:** migration 008 dan 050–060 yang pending dapat dieksekusi tak sengaja sebelum 064 jika ledger dipaksakan atau urutan pending tidak direview.
- **P1:** lock/index/FK validation pada 064 harus diukur di staging dengan ukuran data production terbaru.
- **P1:** constraint guru/absensi yang drift dapat membiarkan null/orphan dan perlu remediation additive tersendiri.
- **P2:** DML-only migrations memerlukan evidence bisnis/manual untuk keputusan historis; jangan menyamakan state data saat ini dengan bukti pernah dieksekusi.

## Keputusan akhir

**BLOCKED.** Preflight data migration 064 lulus, tetapi baseline ledger belum dapat dipercaya sampai migration partial/drift/cannot-verify diremediasi atau diverifikasi manual, dan gap migration 008 serta 050–060 diputuskan secara eksplisit. Tidak ada baseline ledger, migration, atau write database yang dijalankan dalam audit ini.
