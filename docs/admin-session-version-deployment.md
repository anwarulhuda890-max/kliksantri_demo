# Admin Session Version Deployment

## Tujuan

JWT tenant admin dan platform admin membawa `token_version`. Setiap request yang
terautentikasi membandingkan claim tersebut dengan `users.token_version` di
database. Perubahan keamanan membuat token lama mendapat HTTP 401 dengan kode
`SESSION_EXPIRED`; permission tetap diperiksa oleh middleware RBAC setelah sesi
lolos validasi.

## Perubahan yang memutus sesi

- role user;
- status user;
- password user;
- perpindahan tenant user;
- penambahan, perubahan, atau penghapusan permission pada role user.

Trigger database digunakan agar invalidasi tetap berlaku untuk seluruh jalur
penulisan, bukan hanya form manajemen user tertentu.

## Urutan aktivasi production

1. Backup database dan restore ke clone staging.
2. Jalankan `070_admin_token_version.sql` pada clone.
3. Validasi login lama, perubahan role, penolakan token lama, login ulang, dan
   akses `/units` pada clone.
4. Deploy frontend yang mengenali `SESSION_EXPIRED`, membersihkan sesi, dan
   mengarahkan pengguna ke login. Perubahan ini kompatibel dengan backend lama.
5. Pada maintenance window, jalankan migration 070 di production.
6. Deploy backend yang memvalidasi `token_version`.
7. Pastikan startup backend tidak melaporkan kolom `token_version` hilang.
8. Ubah satu akun uji terkontrol, pastikan token lama mendapat 401, lalu login
   ulang dan pastikan akses sesuai role terbaru.

Migration tidak dijalankan otomatis oleh startup aplikasi. Jangan membalik
urutan langkah 5 dan 6 karena backend baru membutuhkan kolom
`users.token_version`.

## Rollback aplikasi

Jika backend baru perlu di-rollback, kembalikan aplikasi ke versi sebelumnya.
Kolom dan trigger migration 070 aman dibiarkan: aplikasi lama mengabaikan kolom
tersebut, sedangkan trigger tetap menjaga versi sesi. Jangan menghapus kolom atau
trigger saat insiden tanpa review database terpisah.
