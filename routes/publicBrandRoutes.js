const express = require('express');
const { getBuildProfile } = require('../services/appBrandProfileService');

const router = express.Router();
router.get('/:brandKey', async (req, res) => {
  try {
    const profile = await getBuildProfile(req.params.brandKey, { publicOnly: true });
    if (!profile) return res.status(404).json({ success: false, error: 'Brand aplikasi tidak tersedia' });
    const {
      brand_key, mode, app_name, short_name, slogan, logo_url, icon_url,
      splash_logo_url, primary_color, package_id, tenant_slug,
      derived_colors, powered_by_klikpesantren,
    } = profile;
    return res.json({ success: true, data: { brand_key, mode, app_name, short_name, slogan, logo_url, icon_url, splash_logo_url, primary_color, package_id, tenant_slug, derived_colors, powered_by_klikpesantren } });
  } catch (error) { return res.status(500).json({ success: false, error: error.message }); }
});
module.exports = router;
