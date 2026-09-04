const express = require('express');
const multer = require('multer');
const platformAuthMiddleware = require('../middleware/platformAuthMiddleware');
const requirePermission = require('../middleware/requirePermission');
const { uploadImageBuffer } = require('../services/cloudinaryUploadService');
const {
  getTenantProfile,
  getUniversalProfile,
  getBuildProfile,
  saveTenantProfile,
  suggestPackageId,
} = require('../services/appBrandProfileService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024 } });
router.use(platformAuthMiddleware);

function fail(res, error) {
  return res.status(error.status || 500).json({ success: false, error: error.message, code: error.code });
}

router.get('/universal', requirePermission('platform.brand.view'), async (_req, res) => {
  try { res.json({ success: true, data: await getUniversalProfile() }); } catch (error) { fail(res, error); }
});

router.get('/tenant/:tenantId', requirePermission('platform.brand.view'), async (req, res) => {
  try {
    const profile = await getTenantProfile(req.params.tenantId);
    res.json({ success: true, data: profile, effective: profile || await getUniversalProfile(), inherited: !profile });
  } catch (error) { fail(res, error); }
});

router.put('/tenant/:tenantId', requirePermission.requireAnyPermission(['platform.brand.manage', 'platform.brand.approve']), async (req, res) => {
  try { res.json({ success: true, data: await saveTenantProfile(req.params.tenantId, req.body || {}, req.platformUser.id) }); }
  catch (error) { fail(res, error); }
});

router.post('/tenant/:tenantId/suggest-package', requirePermission('platform.brand.manage'), async (req, res) => {
  try { res.json({ success: true, package_id: await suggestPackageId(req.body?.brand_key) }); }
  catch (error) { fail(res, error); }
});

router.post('/tenant/:tenantId/assets/:kind', requirePermission('platform.brand.manage'), upload.single('file'), async (req, res) => {
  try {
    if (!['logo', 'icon', 'splash'].includes(req.params.kind)) return res.status(400).json({ success: false, error: 'Jenis asset tidak valid' });
    if (!req.file?.buffer || req.file.mimetype !== 'image/png') return res.status(400).json({ success: false, error: 'Asset build wajib berupa PNG' });
    const uploaded = await uploadImageBuffer(req.file.buffer, { originalName: req.file.originalname });
    res.json({ success: true, data: { kind: req.params.kind, url: uploaded.secure_url, width: uploaded.width, height: uploaded.height } });
  } catch (error) { fail(res, error); }
});

router.get('/:brandKey/build-config', requirePermission('platform.brand.view'), async (req, res) => {
  try {
    const profile = await getBuildProfile(req.params.brandKey);
    if (!profile) return res.status(404).json({ success: false, error: 'Brand Profile tidak ditemukan' });
    res.json({ success: true, data: profile });
  } catch (error) { fail(res, error); }
});

module.exports = router;
