# Arsitektur Data Multi-Unit

## Sumber kebenaran

- `tenants`: yayasan.
- `unit_pendidikan`: master fisik unit; tidak dibuat tabel `units` paralel.
- `santri`: identitas orang pada tenant.
- `santri_units`: membership santri pada satu atau beberapa unit.
- `santri_kelas_enrollments`: histori kelas milik membership.
- `user_unit_scope`: assignment akun ke unit.
- `unit_features`: konfigurasi fitur aktual unit.
- `unit_feature_presets`: template awal yang tidak berubah ketika unit dioverride.

`santri.kelas_id` tetap sebagai default legacy selama transisi dan bukan sumber otoritas multi-unit. `is_primary` pada membership hanya preferensi UI.

## Integritas tenant

Relasi kritis menggunakan pasangan `(tenant_id, id)` agar PostgreSQL menolak membership atau assignment lintas tenant. Satu membership aktif per santri-unit dijaga partial unique index. Membership lama ditutup dengan status dan `left_at`, bukan dihapus.

## Histori operasional

Nilai, absensi, hafalan, perizinan, pelanggaran, kesehatan, pembayaran, dan sahriyah nantinya harus menyimpan `unit_id` ketika kejadian dibuat. Unit histori tidak boleh dihitung dari kelas santri saat ini.

Migration foundation hanya membuat struktur membership. Snapshot unit pada seluruh modul adalah backlog berikutnya.
