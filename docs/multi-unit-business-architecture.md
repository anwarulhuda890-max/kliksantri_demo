# Arsitektur Bisnis Multi-Unit KlikPesantren

## Keputusan final

Tenant adalah yayasan/lembaga induk. Satu tenant mempunyai banyak unit pendidikan yang menjadi ruang kerja operasional mandiri. Contoh unit: Pondok Pesantren, Madrasah Diniyah, PAUD, TK, SD/MI, SMP/MTs, SMA/MA/SMK, dan unit custom.

Satu identitas santri dapat menjadi anggota beberapa unit. Identitas umum—nama, NIK, foto, wali, alamat, dan RFID—tetap satu pada tenant. Nomor siswa unit, kelas, tanggal masuk, status, kamar/asrama, dan atribut pendidikan disimpan pada membership atau submodul unit.

Superadmin tenant dapat melihat semua unit dan konsolidasi yayasan. Operator hanya melihat unit yang ditugaskan. Permission membatasi pekerjaan di dalam unit. Role pusat yang mendapat all-unit access harus eksplisit; assignment kosong bukan all-unit access.

## Fitur dan ruang kerja

Jenis unit menentukan preset awal, bukan larangan permanen. Unit dapat mengubah fitur selama fitur tersebut tersedia pada produk dan termasuk paket tenant. Akses efektif adalah:

`tenant_id + unit scope + role + permission + tenant package feature + unit feature`.

Pondok dapat mempunyai admin spesialis. Unit sederhana dapat dikelola satu operator dengan permission luas pada unit itu saja.

## Batas organisasi

RFID, merchant, kantin, laundry, koperasi, dan device adalah data operasional. Relasi ke unit bersifat opsional. Asrama dan kamar berada di bawah unit Pondok, bukan unit pendidikan. Billing, subscription, domain, serta branding utama tetap milik tenant.

APK Wali di masa depan memakai satu akun dan satu profil anak untuk perjalanan lintas unit. Setiap record tetap menampilkan unit sumber.
