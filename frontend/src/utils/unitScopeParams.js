export function buildUnitScopeParams({ activeUnitId, allUnitsAllowed }) {
  if (activeUnitId) return { unit_id: activeUnitId };
  if (allUnitsAllowed) return { scope: "all" };
  return {};
}

export function requireActiveUnitForWrite({ activeUnitId }) {
  if (!activeUnitId) {
    throw new Error("Pilih unit aktif sebelum menyimpan data unit.");
  }
  return { unit_id: activeUnitId };
}
