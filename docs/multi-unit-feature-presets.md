# Preset Fitur Unit

Preset hanya template saat unit dibuat. Override tersimpan di `unit_features` dan tidak mengubah `unit_feature_presets`.

- PESANTREN: santri, guru, kelas, absensi, hafalan, pelanggaran, perizinan, kesehatan, sahriyah, pembayaran, RFID, pengumuman. Asrama dicatat tetapi disabled sampai UI tersedia.
- PAUD/TK: santri, guru, kelas, absensi, pembayaran, pengumuman. Perkembangan anak disabled sampai tersedia.
- SD/MI/SMP/MTs/SMA/MA/SMK: santri, guru, kelas, mata pelajaran, absensi, nilai, pembayaran, pengumuman. Ujian disabled sampai tersedia.
- MADIN: santri, guru, kelas, absensi, nilai, hafalan, pembayaran, pengumuman.

Key granular seperti `nilai`, `hafalan`, dan `absensi` tetap tunduk pada gate paket tenant `pendidikan`. `kesehatan` tunduk pada `keamanan`. Mengaktifkan feature unit tidak dapat melewati batas paket tenant.

Canonical unit type/code: `PESANTREN`, `MADIN`, `PAUD`, `TK`, `SD`, `MI`, `SMP`, `MTS`, `SMA`, `MA`, `SMK`, `CUSTOM`. `MADINAH` dimigrasikan ke `MADIN` setelah konflik diperiksa.
