const express = require("express");
const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");
const { accessError, resolveActiveUnit } = require("../services/unitAccessService");
const { getDashboardSpecificUnit } = require("../services/dashboardSpecificUnitService");

const router = express.Router();

router.get("/summary", async (req, res) => {
  try {
    if (req.query.unit_id == null || req.query.unit_id === "") {
      throw accessError("Pilih unit terlebih dahulu", 400, "UNIT_REQUIRED");
    }
    const access = await resolveActiveUnit(req);
    if (access.mode !== "UNIT") {
      throw accessError("Pilih unit terlebih dahulu", 400, "UNIT_REQUIRED");
    }
    const permissions = await requirePermission.getPermissionList(req.user.role, { tenantScoped: true });
    const data = await getDashboardSpecificUnit(pool, {
      tenantId: req.tenantId,
      unitId: access.unitId,
      kelasId: req.query.kelas_id,
      year: req.query.year,
      permissions,
    });
    res.json({
      success: true,
      meta: {
        scope: "unit",
        all_units: false,
        read_only: true,
        contract: "dashboard_specific_unit_v1",
        unit_id: access.unitId,
        unit_name: access.unit?.nama || null,
      },
      data,
    });
  } catch (error) {
    if (!error.status) console.error(error);
    res.status(error.status || 500).json({
      success: false,
      error: error.status ? error.message : "Dashboard unit belum dapat dimuat",
      code: error.code || "DASHBOARD_SPECIFIC_UNIT_FAILED",
    });
  }
});

module.exports = router;
