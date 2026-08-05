const pool = require("../db");
const { isFeatureEnabled } = require("./tenantFeatureService");
const { IMPLEMENTED_FEATURES, getPresetPreview, tenantGateForFeature } = require("../config/unitFeaturePresets");

async function getUnitFeatures(tenantId, unitId, client = pool) {
  const { rows } = await client.query(
    `SELECT uf.feature_key AS key, uf.enabled, uf.source,
            COALESCE(p.available, false) AS available
     FROM unit_features uf
     LEFT JOIN unit_feature_presets p
       ON p.preset_key = (SELECT preset_key FROM unit_pendidikan WHERE id = uf.unit_id AND tenant_id = uf.tenant_id)
      AND p.feature_key = uf.feature_key
     WHERE uf.tenant_id = $1 AND uf.unit_id = $2
     ORDER BY uf.feature_key`,
    [tenantId, unitId],
  );
  return rows;
}

async function isUnitFeatureEnabled(
  tenantId,
  unitId,
  featureKey,
  client = pool,
  tenantFeatureCheck = isFeatureEnabled,
) {
  if (!IMPLEMENTED_FEATURES.has(featureKey)) return false;
  const tenantEnabled = await tenantFeatureCheck(tenantId, tenantGateForFeature(featureKey));
  if (!tenantEnabled) return false;
  const { rows } = await client.query(
    `SELECT enabled FROM unit_features
     WHERE tenant_id = $1 AND unit_id = $2 AND feature_key = $3`,
    [tenantId, unitId, featureKey],
  );
  return rows[0]?.enabled === true;
}

async function getEffectiveUnitFeatures(
  tenantId,
  unitId,
  client = pool,
  tenantFeatureCheck = isFeatureEnabled,
) {
  const features = await getUnitFeatures(tenantId, unitId, client);
  const effective = [];
  for (const feature of features) {
    effective.push({
      ...feature,
      implemented: IMPLEMENTED_FEATURES.has(feature.key),
      effective_enabled: await isUnitFeatureEnabled(
        tenantId,
        unitId,
        feature.key,
        client,
        tenantFeatureCheck,
      ),
    });
  }
  return effective;
}

async function applyPresetToUnit(client, { tenantId, unitId, unitType }) {
  const preview = getPresetPreview(unitType);
  if (!preview) throw Object.assign(new Error("Jenis unit tidak valid"), { status: 400 });
  for (const feature of preview.features) {
    await client.query(
      `INSERT INTO unit_features (tenant_id, unit_id, feature_key, enabled, source)
       VALUES ($1, $2, $3, $4, 'default')
       ON CONFLICT (tenant_id, unit_id, feature_key) DO NOTHING`,
      [tenantId, unitId, feature.key, feature.enabled],
    );
  }
}

async function updateUnitFeatures(
  tenantId,
  unitId,
  updates,
  client = pool,
  tenantFeatureCheck = isFeatureEnabled,
) {
  if (!Array.isArray(updates)) throw Object.assign(new Error("Daftar fitur tidak valid"), { status: 400 });
  for (const item of updates) {
    const key = String(item?.key || "").trim();
    if (!key) throw Object.assign(new Error("Feature key wajib diisi"), { status: 400 });
    if (!IMPLEMENTED_FEATURES.has(key) && item.enabled !== false) {
      throw Object.assign(new Error(`Fitur ${key} belum tersedia`), { status: 400 });
    }
    await client.query(
      `INSERT INTO unit_features (tenant_id, unit_id, feature_key, enabled, source, updated_at)
       VALUES ($1, $2, $3, $4, 'custom', NOW())
       ON CONFLICT (tenant_id, unit_id, feature_key) DO UPDATE SET
         enabled = EXCLUDED.enabled, source = 'custom', updated_at = NOW()`,
      [tenantId, unitId, key, item.enabled === true],
    );
  }
  return getEffectiveUnitFeatures(tenantId, unitId, client, tenantFeatureCheck);
}

module.exports = { applyPresetToUnit, getEffectiveUnitFeatures, getUnitFeatures, isUnitFeatureEnabled, updateUnitFeatures };
