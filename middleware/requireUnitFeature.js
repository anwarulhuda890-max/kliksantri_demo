const { assertUnitAccess } = require("../services/unitAccessService");
const { isUnitFeatureEnabled } = require("../services/unitFeatureService");

function requireUnitFeature(featureKey) {
  return async (req, res, next) => {
    try {
      const unitId = req.params?.unitId ?? req.body?.unit_id ?? req.query?.unit_id ?? req.headers?.["x-unit-id"];
      const unit = await assertUnitAccess(req.user, unitId, req.tenantId);
      const enabled = await isUnitFeatureEnabled(req.tenantId, unit.id, featureKey);
      if (!enabled) {
        return res.status(403).json({
          success: false,
          error: "Fitur tidak aktif untuk unit ini",
          feature: featureKey,
          code: "UNIT_FEATURE_DISABLED",
        });
      }
      req.activeUnit = unit;
      next();
    } catch (error) {
      res.status(error.status || 500).json({
        success: false,
        error: error.status ? error.message : "Gagal memvalidasi fitur unit",
        code: error.code,
      });
    }
  };
}

module.exports = requireUnitFeature;
