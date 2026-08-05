# Rencana Migration Multi-Unit

## Baseline drift

Database yang terhubung saat audit mempunyai migration akhir tertentu tetapi kehilangan beberapa tabel migration sebelumnya. Runner lama tidak mempunyai ledger. Karena itu migration existing tidak boleh otomatis ditandai applied.

Runner baru menggunakan `schema_migrations(filename, checksum, applied_at)`. Status/dry-run tidak membuat tabel dan tidak menulis database. Perintah `up` membuat ledger saat eksekusi nyata, menolak checksum drift, dan menjalankan setiap migration pending dalam transaksi.

## Review migration 064

`064_multi_unit_foundation.sql` belum dijalankan. Ia:

1. Mengevolusikan `unit_pendidikan`.
2. Menolak otomatis jika `MADINAH` dan `MADIN` sama-sama ada pada tenant.
3. Membuat preset dan feature unit.
4. Membuat `santri_units` dan `santri_kelas_enrollments`.
5. Mengevolusikan `user_unit_scope` dengan tenant dan status.
6. Menambahkan constraint composite tenant-safe.

## Backfill berikutnya

Backfill membership harus dilakukan terpisah setelah review:

- derive kandidat dari `santri.kelas_id -> kelas.unit_id`;
- laporkan santri tanpa kelas dan konflik tenant;
- jangan menebak histori;
- simpan sumber atribusi legacy dalam metadata;
- rekonsiliasi hitungan sebelum dual-write diaktifkan.

Snapshot unit setiap modul dibuat migration additive terpisah. Kolom tetap nullable sampai coverage dan rekonsiliasi 100%.
