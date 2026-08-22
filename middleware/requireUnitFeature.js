const { accessError, resolveActiveUnit } = require("../services/unitAccessService");
const { isUnitFeatureEnabled } = require("../services/unitFeatureService");

function requireUnitFeature(featureKey) {
  return async (req, res, next) => {
    try {
      const access = await resolveActiveUnit(req);
      if (access.mode === "ALL") {
        if (["GET", "HEAD", "OPTIONS"].includes(String(req.method || "GET").toUpperCase())) {
          req.activeUnit = null;
          return next();
        }
        throw accessError("Pilih unit terlebih dahulu untuk melakukan transaksi/perubahan data", 400, "UNIT_REQUIRED");
      }
      const enabled = await isUnitFeatureEnabled(req.tenantId, access.unitId, featureKey);
      if (!enabled) {
        return res.status(403).json({
          success: false,
          error: "Fitur tidak aktif untuk unit ini",
          feature: featureKey,
          code: "UNIT_FEATURE_DISABLED",
        });
      }
      req.activeUnit = access.unit;
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
