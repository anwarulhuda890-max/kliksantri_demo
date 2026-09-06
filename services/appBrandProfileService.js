const pool = require('../db');

const LIFECYCLE = ['DRAFT', 'APPROVED', 'BUILD_READY', 'PUBLISHED'];
const PACKAGE_RE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){2,}$/;

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function sanitizeBrandKey(value) {
  let key = String(value || '').trim().toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .replace(/^[^a-z]+/, '').slice(0, 63);
  if (key.length < 2) key = `brand${key}`.slice(0, 63);
  return key;
}

function validatePackageId(value) {
  return PACKAGE_RE.test(String(value || '').trim().toLowerCase());
}

function mix(hex, target, amount) {
  const source = hex.slice(1).match(/.{2}/g).map((part) => parseInt(part, 16));
  const dest = target.slice(1).match(/.{2}/g).map((part) => parseInt(part, 16));
  return `#${source.map((value, index) => Math.round(value + (dest[index] - value) * amount).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function deriveBrandColors(primaryColor) {
  const primary = String(primaryColor || '#15803D').toUpperCase();
  if (!/^#[0-9A-F]{6}$/.test(primary)) throw httpError(400, 'Primary color tidak valid', 'INVALID_PRIMARY_COLOR');
  const [r, g, b] = primary.slice(1).match(/.{2}/g).map((part) => parseInt(part, 16) / 255);
  const linear = [r, g, b].map((value) => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
  return {
    primary,
    primary_dark: mix(primary, '#000000', 0.2),
    primary_soft: mix(primary, '#FFFFFF', 0.85),
    accent: mix(primary, '#FFFFFF', 0.28),
    foreground: luminance > 0.45 ? '#0F172A' : '#FFFFFF',
    background: '#F8FAFC',
  };
}

function serialize(row) {
  if (!row) return null;
  return { ...row, powered_by_klikpesantren: true, derived_colors: deriveBrandColors(row.primary_color) };
}

function assertTransition(from, to) {
  if (!to || from === to) return;
  if (LIFECYCLE.indexOf(to) !== LIFECYCLE.indexOf(from) + 1) {
    throw httpError(409, `Lifecycle harus berurutan: ${from} → ${LIFECYCLE[LIFECYCLE.indexOf(from) + 1] || 'selesai'}`, 'INVALID_LIFECYCLE_TRANSITION');
  }
}

async function getUniversalProfile(db = pool) {
  const { rows } = await db.query("SELECT * FROM app_brand_profiles WHERE mode = 'universal' LIMIT 1");
  return serialize(rows[0]);
}

async function getTenantProfile(tenantId, db = pool) {
  const { rows } = await db.query('SELECT * FROM app_brand_profiles WHERE tenant_id = $1 LIMIT 1', [tenantId]);
  return serialize(rows[0]);
}

async function getResolvedTenantProfile(tenantId, db = pool) {
  return (await getTenantProfile(tenantId, db)) || getUniversalProfile(db);
}

async function getBuildProfile(brandKey, { publicOnly = false } = {}, db = pool) {
  const params = [sanitizeBrandKey(brandKey)];
  const statusClause = publicOnly ? " AND bp.status IN ('APPROVED', 'BUILD_READY', 'PUBLISHED')" : '';
  const { rows } = await db.query(
    `SELECT bp.*, t.slug AS tenant_slug
     FROM app_brand_profiles bp
     LEFT JOIN tenants t ON t.id = bp.tenant_id
     WHERE bp.brand_key = $1${statusClause} LIMIT 1`,
    params,
  );
  return serialize(rows[0]);
}

async function getWhiteLabelTenantSlug(brandKey, db = pool) {
  const { rows } = await db.query(
    `SELECT t.slug FROM app_brand_profiles bp JOIN tenants t ON t.id = bp.tenant_id
     WHERE bp.brand_key = $1 AND bp.mode = 'white_label'
       AND bp.status IN ('BUILD_READY', 'PUBLISHED') AND t.status = 'active' LIMIT 1`,
    [sanitizeBrandKey(brandKey)],
  );
  return rows[0]?.slug || null;
}

async function suggestPackageId(brandKey, db = pool) {
  const key = sanitizeBrandKey(brandKey);
  const base = `com.klikpesantren.${key}.wali`;
  const { rows } = await db.query('SELECT 1 FROM app_brand_profiles WHERE LOWER(package_id) = LOWER($1)', [base]);
  if (!rows.length) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `com.klikpesantren.${key}${suffix}.wali`;
    const collision = await db.query('SELECT 1 FROM app_brand_profiles WHERE LOWER(package_id) = LOWER($1)', [candidate]);
    if (!collision.rows.length) return candidate;
  }
  throw httpError(409, 'Package ID unik tidak dapat dibuat', 'PACKAGE_ID_EXHAUSTED');
}

async function saveTenantProfile(tenantId, input, actorId, db = pool) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const tenant = await client.query('SELECT id, slug, nama FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
    if (!tenant.rows[0]) throw httpError(404, 'Tenant tidak ditemukan', 'TENANT_NOT_FOUND');
    const currentResult = await client.query('SELECT * FROM app_brand_profiles WHERE tenant_id = $1 FOR UPDATE', [tenantId]);
    const current = currentResult.rows[0] || null;
    const mode = input.mode === 'universal' ? 'universal' : 'white_label';

    if (mode === 'universal') {
      if (current?.status === 'PUBLISHED') throw httpError(409, 'Brand yang sudah published tidak dapat dikembalikan ke universal', 'PUBLISHED_BRAND_IMMUTABLE');
      if (current) await client.query('DELETE FROM app_brand_profiles WHERE id = $1', [current.id]);
      await client.query('COMMIT');
      return getUniversalProfile(db);
    }

    const brandKey = sanitizeBrandKey(input.brand_key || tenant.rows[0].slug);
    const packageId = String(input.package_id || '').trim().toLowerCase() || null;
    const nextStatus = String(input.status || current?.status || 'DRAFT').toUpperCase();
    if (!LIFECYCLE.includes(nextStatus)) throw httpError(400, 'Status lifecycle tidak valid', 'INVALID_STATUS');
    if (!current && nextStatus !== 'DRAFT') throw httpError(409, 'Brand Profile baru harus dimulai dari DRAFT', 'INVALID_LIFECYCLE_TRANSITION');
    if (current) assertTransition(current.status, nextStatus);
    if (packageId && !validatePackageId(packageId)) throw httpError(400, 'Package ID tidak valid', 'INVALID_PACKAGE_ID');
    if (['BUILD_READY', 'PUBLISHED'].includes(nextStatus) && !packageId) throw httpError(400, 'Package ID wajib sebelum BUILD_READY', 'PACKAGE_ID_REQUIRED');
    if (input.custom_domain_id) {
      const domain = await client.query('SELECT 1 FROM tenant_domains WHERE id = $1 AND tenant_id = $2', [input.custom_domain_id, tenantId]);
      if (!domain.rows.length) throw httpError(403, 'Custom domain bukan milik tenant ini', 'CROSS_TENANT_DOMAIN');
    }

    const values = [brandKey, tenantId, input.app_name || tenant.rows[0].nama, input.short_name || input.app_name || tenant.rows[0].nama,
      input.slogan || null, input.logo_url || null, input.icon_url || null, input.splash_logo_url || null,
      deriveBrandColors(input.primary_color || current?.primary_color || '#15803D').primary, packageId,
      input.custom_domain_id || null, input.play_store_url || null, input.play_store_status || 'NOT_PUBLISHED', nextStatus,
      input.current_version_name || '1.0.0', Number(input.current_version_code || 1), input.firebase_config_ref || null, actorId];
    const query = current ?
      `UPDATE app_brand_profiles SET brand_key=$1, tenant_id=$2, app_name=$3, short_name=$4, slogan=$5, logo_url=$6, icon_url=$7, splash_logo_url=$8, primary_color=$9, package_id=$10, custom_domain_id=$11, play_store_url=$12, play_store_status=$13, status=$14, current_version_name=$15, current_version_code=$16, firebase_config_ref=$17, updated_by=$18 WHERE id=$19 RETURNING *` :
      `INSERT INTO app_brand_profiles (brand_key,tenant_id,mode,app_name,short_name,slogan,logo_url,icon_url,splash_logo_url,primary_color,package_id,custom_domain_id,play_store_url,play_store_status,status,current_version_name,current_version_code,firebase_config_ref,created_by,updated_by) VALUES ($1,$2,'white_label',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18) RETURNING *`;
    if (current) values.push(current.id);
    const saved = await client.query(query, values);
    await client.query('COMMIT');
    return serialize(saved.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') throw httpError(409, 'Brand key atau package ID sudah digunakan', 'BRAND_IDENTITY_CONFLICT');
    throw error;
  } finally { client.release(); }
}

module.exports = { LIFECYCLE, sanitizeBrandKey, validatePackageId, deriveBrandColors, getUniversalProfile, getTenantProfile, getResolvedTenantProfile, getBuildProfile, getWhiteLabelTenantSlug, suggestPackageId, saveTenantProfile };
