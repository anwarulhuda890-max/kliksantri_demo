# Kontrol Akses Multi-Unit

## Aturan

Backend adalah enforcement point. Mengubah URL, query, body, atau `X-Unit-Id` tidak boleh memperluas akses.

Resolver tunggal berada di `services/unitAccessService.js` dan menyediakan:

- `canAccessAllUnits(user)`
- `getAllowedUnitIds(user)`
- `assertUnitAccess(user, unitId)`
- `resolveActiveUnit(request)`

Resolver memverifikasi user pada tenant aktif, unit milik tenant yang sama, unit aktif, serta assignment aktif. Hanya `superadmin` tenant yang mendapat implicit all-unit. Semua role lain, termasuk `pimpinan_yayasan`, wajib mempunyai assignment aktif di `user_unit_scope`; permission tetap menentukan read/write di dalam scope tersebut.

## Fail-closed

Operator tanpa assignment menghasilkan daftar unit kosong dan ditolak. Compatibility middleware lama harus mendelegasikan ke resolver ini. Nilai `null` hanya berarti all-unit untuk role yang eksplisit, bukan assignment kosong.

## Feature gate

Fitur efektif harus lolos seluruh lapisan:

1. Paket/feature tenant aktif.
2. Feature unit aktif.
3. Fitur sudah diimplementasikan.
4. Role mempunyai permission endpoint.
5. User mempunyai akses unit.

Selector frontend hanya preferensi. Ia bukan bukti otorisasi.
