const express = require("express");
const pool = require("../db");
const authMiddleware = require("../middleware/authMiddleware");
const tenantMiddleware = require("../middleware/tenantMiddleware");
const requirePermission = require("../middleware/requirePermission");
const { getPresetPreview, normalizeUnitType, presetKeyForUnitType } = require("../config/unitFeaturePresets");
const { assertUnitAccess, getAllowedUnitIds } = require("../services/unitAccessService");
const { applyPresetToUnit, getEffectiveUnitFeatures, updateUnitFeatures } = require("../services/unitFeatureService");

const router = express.Router();
router.use(authMiddleware, tenantMiddleware);

function sendError(res, error) {
  res.status(error.status || 500).json({
    success: false,
    error: error.status ? error.message : "Gagal memproses unit pendidikan",
    code: error.code,
  });
}

function normalizePayload(body = {}) {
  const unitType = normalizeUnitType(body.unit_type || body.jenis || body.kode);
  return {
    nama: String(body.nama || "").trim(),
    kode: String(body.kode || unitType || "").trim().toUpperCase(),
    unit_type: unitType,
    preset_key: presetKeyForUnitType(unitType),
    sort_order: Number.isInteger(Number(body.sort_order)) ? Number(body.sort_order) : 0,
    settings: body.settings && typeof body.settings === "object" ? body.settings : {},
  };
}

router.get("/presets/:unitType", requirePermission("unit.view"), (req, res) => {
  const preview = getPresetPreview(req.params.unitType);
  if (!preview) return res.status(400).json({ success: false, error: "Jenis unit tidak valid" });
  res.json({ success: true, data: preview });
});

router.get("/", async (req, res) => {
  try {
    const allowed = await getAllowedUnitIds(req.user, req.tenantId);
    const params = [req.tenantId];
    let scope = "";
    if (allowed !== null) {
      if (allowed.length === 0) {
        return res.status(403).json({
          success: false,
          error: "Unit scope belum diassign",
          code: "UNIT_SCOPE_UNASSIGNED",
        });
      }
      params.push(allowed);
      scope = " AND id = ANY($2::int[])";
    }
    const { rows } = await pool.query(
      `SELECT id, kode, nama, unit_type, preset_key, is_active, sort_order, settings, created_at, updated_at
       FROM unit_pendidikan WHERE tenant_id = $1${scope}
       ORDER BY sort_order, nama, id`,
      params,
    );
    res.json({ success: true, data: rows, access: { all_units: allowed === null } });
  } catch (error) { sendError(res, error); }
});

router.get("/:unitId/features", async (req, res) => {
  try {
    const unit = await assertUnitAccess(req.user, req.params.unitId, req.tenantId);
    const features = await getEffectiveUnitFeatures(req.tenantId, unit.id);
    res.json({ success: true, data: features, unit });
  } catch (error) { sendError(res, error); }
});

router.get("/:unitId", requirePermission("unit.view"), async (req, res) => {
  try {
    const unit = await assertUnitAccess(req.user, req.params.unitId, req.tenantId);
    res.json({ success: true, data: unit });
  } catch (error) { sendError(res, error); }
});

router.post("/", requirePermission("unit.manage"), async (req, res) => {
  const client = await pool.connect();
  try {
    const data = normalizePayload(req.body);
    if (!data.nama || !data.unit_type) return res.status(400).json({ success: false, error: "Nama dan jenis unit wajib diisi" });
    await client.query("BEGIN");
    const { rows } = await client.query(
      `INSERT INTO unit_pendidikan
       (tenant_id, kode, nama, unit_type, preset_key, is_active, sort_order, settings, updated_at)
       VALUES ($1,$2,$3,$4,$5,true,$6,$7::jsonb,NOW()) RETURNING *`,
      [req.tenantId, data.kode, data.nama, data.unit_type, data.preset_key,
        data.sort_order, JSON.stringify(data.settings)],
    );
    await applyPresetToUnit(client, { tenantId: req.tenantId, unitId: rows[0].id, unitType: data.unit_type });
    await client.query("COMMIT");
    res.status(201).json({ success: true, data: rows[0] });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") Object.assign(error, { status: 409, message: "Kode unit sudah digunakan tenant ini" });
    sendError(res, error);
  } finally { client.release(); }
});

async function updateUnit(req, res) {
  try {
    await assertUnitAccess(req.user, req.params.unitId, req.tenantId);
    const data = normalizePayload(req.body);
    if (!data.nama || !data.unit_type) return res.status(400).json({ success: false, error: "Nama dan jenis unit wajib diisi" });
    const { rows } = await pool.query(
      `UPDATE unit_pendidikan SET kode=$1,nama=$2,unit_type=$3,preset_key=$4,
         sort_order=$5,settings=$6::jsonb,updated_at=NOW()
       WHERE id=$7 AND tenant_id=$8 RETURNING *`,
      [data.kode, data.nama, data.unit_type, data.preset_key, data.sort_order,
        JSON.stringify(data.settings), req.params.unitId, req.tenantId],
    );
    res.json({ success: true, data: rows[0] });
  } catch (error) { sendError(res, error); }
}
router.put("/:unitId", requirePermission("unit.manage"), updateUnit);
router.patch("/:unitId", requirePermission("unit.manage"), updateUnit);

async function setUnitStatus(req, res, active) {
  try {
    const { rows } = await pool.query(
      `UPDATE unit_pendidikan SET is_active=$1,updated_at=NOW()
       WHERE id=$2 AND tenant_id=$3 RETURNING *`,
      [active, req.params.unitId, req.tenantId],
    );
    if (!rows.length) return res.status(404).json({ success: false, error: "Unit tidak ditemukan" });
    res.json({ success: true, data: rows[0] });
  } catch (error) { sendError(res, error); }
}
router.post("/:unitId/activate", requirePermission("unit.manage"), (req, res) => setUnitStatus(req, res, true));
router.post("/:unitId/deactivate", requirePermission("unit.manage"), (req, res) => setUnitStatus(req, res, false));

router.put("/:unitId/features", requirePermission("unit.manage"), async (req, res) => {
  try {
    const unit = await assertUnitAccess(req.user, req.params.unitId, req.tenantId);
    const features = await updateUnitFeatures(req.tenantId, unit.id, req.body?.features);
    res.json({ success: true, data: features });
  } catch (error) { sendError(res, error); }
});

module.exports = router;
