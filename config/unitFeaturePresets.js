const IMPLEMENTED_FEATURES = new Set([
  "santri", "guru", "kelas", "absensi", "mata_pelajaran", "nilai",
  "hafalan", "pelanggaran", "perizinan", "kesehatan", "sahriyah",
  "pembayaran", "wallet", "rfid", "pengumuman",
]);

const PRESETS = {
  PESANTREN: ["santri", "guru", "kelas", "absensi", "hafalan", "pelanggaran", "perizinan", "kesehatan", "sahriyah", "pembayaran", "wallet", "rfid", "asrama", "pengumuman"],
  PAUD: ["santri", "guru", "kelas", "absensi", "perkembangan_anak", "pembayaran", "wallet", "pengumuman"],
  TK: ["santri", "guru", "kelas", "absensi", "perkembangan_anak", "pembayaran", "wallet", "pengumuman"],
  SEKOLAH: ["santri", "guru", "kelas", "mata_pelajaran", "absensi", "nilai", "ujian", "pembayaran", "wallet", "pengumuman"],
  MADIN: ["santri", "guru", "kelas", "absensi", "nilai", "hafalan", "pembayaran", "wallet", "pengumuman"],
  CUSTOM: [],
};

const UNIT_TYPES = new Set(["PESANTREN", "MADIN", "PAUD", "TK", "SD", "MI", "SMP", "MTS", "SMA", "MA", "SMK", "CUSTOM"]);
const SCHOOL_TYPES = new Set(["SD", "MI", "SMP", "MTS", "SMA", "MA", "SMK"]);

const TENANT_FEATURE_GATE = {
  absensi: "pendidikan",
  mata_pelajaran: "pendidikan",
  nilai: "pendidikan",
  hafalan: "pendidikan",
  ujian: "pendidikan",
  kesehatan: "keamanan",
  asrama: "keamanan",
};

function normalizeUnitType(value) {
  const type = String(value || "").trim().toUpperCase();
  return UNIT_TYPES.has(type) ? type : null;
}

function presetKeyForUnitType(value) {
  const type = normalizeUnitType(value);
  if (!type) return null;
  if (SCHOOL_TYPES.has(type)) return "SEKOLAH";
  return type;
}

function getPresetPreview(value) {
  const unitType = normalizeUnitType(value);
  if (!unitType) return null;
  const presetKey = presetKeyForUnitType(unitType);
  return {
    unit_type: unitType,
    preset_key: presetKey,
    features: (PRESETS[presetKey] || []).map((key) => ({
      key,
      enabled: IMPLEMENTED_FEATURES.has(key),
      available: IMPLEMENTED_FEATURES.has(key),
    })),
  };
}

function tenantGateForFeature(featureKey) {
  return TENANT_FEATURE_GATE[featureKey] || featureKey;
}

module.exports = {
  IMPLEMENTED_FEATURES,
  PRESETS,
  UNIT_TYPES,
  getPresetPreview,
  normalizeUnitType,
  presetKeyForUnitType,
  tenantGateForFeature,
};
