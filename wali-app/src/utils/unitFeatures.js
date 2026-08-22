export function getUnitFeatureFallback(unit = null) {
  return {
    absensi: false,
    nilai: false,
    hafalan: false,
    perizinan: false,
    pelanggaran: false,
    kesehatan: false,
    sahriyah: false,
    rfid: false,
    pengumuman: false,
    unit_id: unit?.unit_id || null,
    unit_kode: unit?.unit_kode || null,
    unit_nama: unit?.unit_nama || null,
    unit_type: unit?.unit_type || null,
  };
}
