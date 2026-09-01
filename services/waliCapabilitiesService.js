const WALI_CAPABILITY_KEYS = Object.freeze([
  "absensi",
  "nilai",
  "hafalan",
  "perizinan",
  "pelanggaran",
  "kesehatan",
  "sahriyah",
  "wallet",
  "rfid",
  "pengumuman",
]);

function buildWaliCapabilities(features = [], unit = null) {
  const effective = new Map(
    features.map((feature) => [
      feature.key,
      feature.effective_enabled === true,
    ]),
  );

  const result = {};
  for (const key of WALI_CAPABILITY_KEYS) {
    result[key] = effective.get(key) === true;
  }

  return {
    ...result,
    unit_id: unit?.unit_id || null,
    unit_kode: unit?.unit_kode || null,
    unit_nama: unit?.unit_nama || null,
    unit_type: unit?.unit_type || null,
  };
}

module.exports = { WALI_CAPABILITY_KEYS, buildWaliCapabilities };
