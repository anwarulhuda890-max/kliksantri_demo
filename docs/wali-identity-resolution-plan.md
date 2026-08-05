# Wali Identity Resolution Plan

## Status dan batasan

Dokumen ini adalah rencana controlled data fix. Belum ada perubahan database yang dijalankan. Script perencanaan selalu membuka transaksi `READ ONLY` dan menutupnya dengan `ROLLBACK`. Script eksekusi terpisah tidak boleh dijalankan sebelum operator menyetujui hasil dry-run.

## Keputusan canonical

- Pertahankan `wali_akun.id = 1` sebagai akun canonical dan tetap `active`.
- Arsipkan secara logis `wali_akun.id = 3` dengan mengubah status dari `active` menjadi `inactive`.
- Tidak menghapus akun ID 3 dan tidak mengubah nomor HP-nya.
- Tidak memindahkan relasi santri karena akun ID 3 harus tetap tidak mempunyai relasi.
- Tidak menggabungkan PIN, hash, credential, session, token, atau histori audit.
- Operator telah memastikan `wali_santri.id = 26` dan seluruh tenant ID 37 sebagai data smoke-test MT8. Tenant dan record anak yang mempunyai status akan diarsipkan logis; script tidak membuat akun wali.

## Asumsi yang wajib tetap benar

Eksekusi otomatis dibatalkan bila salah satu kondisi berikut berubah:

1. Akun ID 1 atau ID 3 tidak ditemukan.
2. Keduanya tidak lagi berada pada tenant ID 1 yang sama.
3. Nomor canonical akun ID 3 tidak lagi bertabrakan dengan nomor akun ID 1.
4. Status salah satu akun tidak lagi `active`.
5. Akun ID 3 mempunyai `last_login`.
6. Akun ID 3 memperoleh relasi santri.
7. Ada aktivitas baru untuk nomor asli akun ID 3 sejak akun itu dibuat.
8. Akun ID 1 tidak lagi mempunyai relasi santri nyata.
9. Wali ID 26 sudah memperoleh akun, sehingga controlled fix harus dibatalkan.
10. Isi tenant ID 37 tidak lagi persis terdiri dari data simulasi yang telah diaudit.

Pemeriksaan dilakukan ulang di dalam transaksi serializable. Tabel identitas terkait dikunci selama pemeriksaan dan update agar asumsi tidak berubah di tengah proses.

## Dry-run

Jalankan:

```text
npm run wali-identity:plan
```

Output harus mempunyai marker `wali-identity-resolution-plan`, mode `READ_ONLY_DRY_RUN`, `writes_executed: false`, dan status `READY_FOR_CONTROLLED_DATA_FIX`. Jika statusnya `BLOCKED_ASSUMPTION_CHANGED`, jangan menjalankan script eksekusi.

## Eksekusi terkontrol setelah persetujuan operator

Script write sengaja dipisahkan dan menolak berjalan tanpa flag eksplisit:

```text
npm run wali-identity:apply -- --confirm-wali-identity-resolution
```

Sebelum update, script menampilkan host database, nama database, tenant, akun yang dipertahankan, dan akun yang diarsipkan. Nilai credential dan secret tidak ditampilkan. Seluruh operasi memakai satu transaksi; kegagalan apa pun memicu `ROLLBACK`.

Perubahan identitas adalah status akun ID 3 menjadi `inactive`, tenant smoke-test ID 37 menjadi `inactive`, santri/guru/user MT8 menjadi `Nonaktif`, dan unit MT8 menjadi `is_active=false`. Tabel tanpa status (`wali_santri`, `kelas`, profil, dan feature) tetap utuh serta mewarisi logical archive dari tenant. Script menulis audit tanpa credential atau secret.

## Verifikasi setelah controlled data fix

1. Pastikan akun ID 1 tetap aktif dan relasi santrinya tidak berubah.
2. Pastikan akun ID 3 berstatus inactive, tidak mempunyai relasi santri, dan tidak ada record yang dihapus.
3. Pastikan event audit controlled fix tercatat tepat satu kali.
4. Jalankan ulang laporan identity review dan seluruh preflight secara read-only.
5. Jalankan `npm run wali-identity:audit` dan pastikan hasilnya `PASS`.

## Catatan reconciliation

Menonaktifkan akun legacy menyelesaikan risiko akses, tetapi recordnya tetap dipertahankan. Preflight normalization saat ini menghitung collision tanpa membedakan status akun, sehingga dapat tetap melaporkan collision setelah controlled fix. Perubahan kebijakan normalization harus direview terpisah; rencana ini tidak mengubah migration atau memperluas tindakan melebihi logical archive yang disetujui.
