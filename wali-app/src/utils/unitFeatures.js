export function getUnitFeatureFallback(unit = null) {
  return {
    absensi: false,
    nilai: false,
    hafalan: false,
    perizinan: false,
    pelanggaran: false,
    kesehatan: false,
    sahriyah: false,
    wallet: false,
    rfid: false,
    pengumuman: false,
    unit_id: unit?.unit_id || null,
    unit_kode: unit?.unit_kode || null,
    unit_nama: unit?.unit_nama || null,
    unit_type: unit?.unit_type || null,
  };
}

export const MONITORING_FEATURE_KEYS = [
  'absensi', 'nilai', 'hafalan', 'perizinan', 'pelanggaran', 'kesehatan',
];

export const FINANCE_FEATURE_KEYS = ['sahriyah', 'wallet'];

export function isFeatureEnabled(features, key) {
  return features?.[key] === true;
}

export function hasAnyFeature(features, keys) {
  return keys.some((key) => isFeatureEnabled(features, key));
}
