# Release Plan Multi-Unit

## Urutan aman

1. Review baseline schema setiap environment dan migration 064.
2. Backup serta latihan restore di staging.
3. Verifikasi migration existing dan isi ledger melalui prosedur manual yang disetujui; jangan auto-baseline.
4. Jalankan migration foundation di staging.
5. Deploy backend resolver/API lalu frontend Unit Pendidikan.
6. Uji tenant isolation, unit isolation, role, permission, feature intersection, dan inactive unit.
7. Backfill membership dalam migration/job terpisah dengan laporan anomali.
8. Implement snapshot unit modul per sprint.
9. Aktifkan Dashboard Unit setelah datanya dapat dipercaya.

## Backlog eksplisit

- Unit snapshot untuk semua modul operasional.
- Backfill `santri_units` tenant lama.
- Dashboard konsolidasi dan dashboard unit.
- APK Wali lintas unit.
- Pengumuman multi-audience.
- Pembayaran dan sahriyah per unit.
- Relasi operasional opsional untuk RFID/merchant/device.
- PPDB universal.
- APK white-label.
- EDC Android.
- Absensi Android/fingerprint.

Status sprint foundation bukan “siap deploy”. Migration belum dijalankan dan modul lama belum seluruhnya unit-scoped.
