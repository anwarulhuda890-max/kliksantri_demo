const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const {
  normalizePackage,
  VALID_PACKAGES,
} = require("../config/tenantPackageConfig");
const {
  seedTenantFeaturesAllEnabled,
  seedTenantFeaturesFromPackage,
} = require("./tenantFeatureService");
const { presetKeyForUnitType } = require("../config/unitFeaturePresets");
const { applyPresetToUnit } = require("./unitFeatureService");

const RESERVED_SLUGS = new Set([
  "default",
  "app",
  "platform",
  "admin",
  "api",
  "www",
  "docs",
  "status",
  "root",
  "system",
]);

const SLUG_PATTERN = /^[a-z0-9-]+$/;

const DEFAULT_UNITS = [
  { kode: "PESANTREN", nama: "Pondok Pesantren", sort_order: 1 },
  { kode: "MADIN", nama: "Madrasah Diniyah", sort_order: 2 },
  { kode: "PAUD", nama: "PAUD", sort_order: 3 },
  { kode: "TK", nama: "TK", sort_order: 4 },
  { kode: "SD", nama: "SD", sort_order: 5 },
  { kode: "MI", nama: "MI", sort_order: 6 },
  { kode: "SMP", nama: "SMP", sort_order: 7 },
  { kode: "SMA", nama: "SMA", sort_order: 8 },
];

const DEFAULT_UNIT_USERS = [
  { username: "pimpinan", role: "pimpinan_yayasan", unitKode: null },
  { username: "paud", role: "bendahara_unit", unitKode: "PAUD" },
  { username: "tk", role: "bendahara_unit", unitKode: "TK" },
  { username: "sd", role: "bendahara_unit", unitKode: "SD" },
  { username: "mi", role: "bendahara_unit", unitKode: "MI" },
  { username: "smp", role: "bendahara_unit", unitKode: "SMP" },
  { username: "sma", role: "bendahara_unit", unitKode: "SMA" },
  { username: "madin", role: "bendahara_unit", unitKode: "MADIN" },
];

function generateSecurePassword() {
  return crypto.randomBytes(16).toString("base64url");
}

/** One-time credential for bendahara/pimpinan unit — never logged; returned once in API response. */
function generateUnitUserPassword() {
  return crypto.randomBytes(12).toString("base64url");
}

function validateSlug(slug) {
  const normalized = String(slug || "").trim().toLowerCase();

  if (!normalized || normalized.length < 3) {
    return { ok: false, error: "Slug minimal 3 karakter", status: 400 };
  }

  if (!SLUG_PATTERN.test(normalized)) {
    return {
      ok: false,
      error: "Slug hanya boleh huruf kecil, angka, dan dash",
      status: 400,
    };
  }

  if (RESERVED_SLUGS.has(normalized)) {
    return { ok: false, error: "Slug tidak tersedia (reserved)", status: 400 };
  }

  return { ok: true, slug: normalized };
}

function sanitizeUser(row) {
  if (!row) return null;
  const { password, ...rest } = row;
  return rest;
}

function normalizeCreatePayload(body = {}) {
  const nama =
    body.nama_pesantren?.trim() ||
    body.nama?.trim() ||
    body.name?.trim() ||
    "";

  const adminPasswordRaw = body.admin_password;
  const useGeneratedPassword =
    adminPasswordRaw == null ||
    String(adminPasswordRaw).trim() === "" ||
    String(adminPasswordRaw).trim().toLowerCase() === "random";

  const adminPassword = useGeneratedPassword
    ? generateSecurePassword()
    : String(adminPasswordRaw);

  const pkg = body.package ? normalizePackage(body.package) : null;

  return {
    nama_pesantren: nama,
    slug: body.slug,
    alamat: body.alamat,
    telepon: body.telepon,
    logo_url: body.logo_url,
    admin_nama: body.admin_nama,
    admin_username: body.admin_username,
    admin_password: adminPassword,
    admin_password_generated: useGeneratedPassword,
    package: pkg,
    custom_features: body.custom_features || body.features || [],
    create_default_unit_users: body.create_default_unit_users === true,
    admin_role: body.admin_role,
  };
}

async function assertUsernameAvailable(client, username, tenantId = null) {
  const normalized = String(username || "").trim().toLowerCase();
  if (!normalized) return;

  const { rows } = await client.query(
    `SELECT id, tenant_id, role FROM users WHERE LOWER(username) = $1 LIMIT 1`,
    [normalized]
  );

  if (rows.length === 0) return;

  const existing = rows[0];
  if (tenantId != null && Number(existing.tenant_id) === Number(tenantId)) {
    return;
  }

  const err = new Error("Username admin sudah digunakan");
  err.status = 409;
  throw err;
}

async function writeTenantCreatedAudit(client, tenant, platformUser, packageName) {
  await client.query(
    `INSERT INTO audit_logs (device_id, event_type, detail, tenant_id)
     VALUES ($1, $2, $3, $4)`,
    [
      `platform:${platformUser?.id ?? "system"}`,
      "platform.tenant.created",
      JSON.stringify({
        tenant_id: tenant.id,
        slug: tenant.slug,
        nama: tenant.nama,
        package: packageName,
        created_by: platformUser?.id ?? null,
        created_by_username: platformUser?.username ?? null,
      }),
      tenant.id,
    ]
  );
}

async function createTenantWithDefaults(rawPayload, platformUser) {
  const payload = normalizeCreatePayload(rawPayload);
  const {
    nama_pesantren,
    slug,
    alamat,
    telepon,
    logo_url,
    admin_nama,
    admin_username,
    admin_password,
    admin_password_generated,
    package: packageName,
    custom_features,
    create_default_unit_users,
    admin_role,
  } = payload;

  if (!nama_pesantren) {
    const err = new Error("Nama pesantren wajib diisi");
    err.status = 400;
    throw err;
  }

  const slugCheck = validateSlug(slug);
  if (!slugCheck.ok) {
    const err = new Error(slugCheck.error);
    err.status = slugCheck.status;
    throw err;
  }

  if (!admin_username?.trim()) {
    const err = new Error("admin_username wajib diisi");
    err.status = 400;
    throw err;
  }

  if (String(admin_username).trim().toLowerCase() === "platform") {
    const err = new Error("Username admin tidak valid");
    err.status = 400;
    throw err;
  }

  if (admin_role === "platform_superadmin") {
    const err = new Error("Tidak boleh membuat user platform_superadmin");
    err.status = 403;
    throw err;
  }

  if (!admin_password || String(admin_password).length < 6) {
    const err = new Error("admin_password minimal 6 karakter");
    err.status = 400;
    throw err;
  }

  if (packageName && !VALID_PACKAGES.has(packageName)) {
    const err = new Error("Package harus basic, standard, premium, atau custom");
    err.status = 400;
    throw err;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingSlug = await client.query(
      `SELECT id FROM tenants WHERE slug = $1`,
      [slugCheck.slug]
    );
    if (existingSlug.rows.length > 0) {
      const err = new Error("Slug sudah digunakan");
      err.status = 409;
      throw err;
    }

    await assertUsernameAvailable(client, admin_username.trim());

    const tenantResult = await client.query(
      `INSERT INTO tenants (
         slug, nama, status, alamat, telepon, logo_url,
         onboarded_at, created_by
       )
       VALUES ($1, $2, 'active', $3, $4, $5, NOW(), $6)
       RETURNING *`,
      [
        slugCheck.slug,
        nama_pesantren,
        alamat?.trim() || null,
        telepon?.trim() || null,
        logo_url ?? null,
        platformUser?.id ?? null,
      ]
    );
    const tenant = tenantResult.rows[0];

    let featuresEnabled = null;
    if (packageName) {
      featuresEnabled = await seedTenantFeaturesFromPackage(
        tenant.id,
        packageName,
        custom_features,
        client
      );
    } else {
      await seedTenantFeaturesAllEnabled(tenant.id, client);
    }

    await client.query(
      `INSERT INTO profil_pesantren (
         nama_pesantren, alamat, telepon, logo_url, tenant_id, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        nama_pesantren,
        alamat?.trim() || null,
        telepon?.trim() || null,
        logo_url ?? null,
        tenant.id,
      ]
    );

    const units = [];
    const unitByKode = {};

    for (const unit of DEFAULT_UNITS) {
      const presetKey = presetKeyForUnitType(unit.kode);
      const ins = await client.query(
        `INSERT INTO unit_pendidikan
         (kode, nama, unit_type, preset_key, sort_order, is_active, tenant_id, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, $6, NOW())
         RETURNING id, kode, nama, sort_order, tenant_id`,
        [unit.kode, unit.nama, unit.kode, presetKey, unit.sort_order, tenant.id]
      );
      units.push(ins.rows[0]);
      unitByKode[unit.kode] = ins.rows[0].id;
      await applyPresetToUnit(client, {
        tenantId: tenant.id,
        unitId: ins.rows[0].id,
        unitType: unit.kode,
      });
    }

    const adminHash = await bcrypt.hash(admin_password, 10);
    const adminResult = await client.query(
      `INSERT INTO users (nama, username, password, role, status, tenant_id)
       VALUES ($1, $2, $3, 'superadmin', 'Aktif', $4)
       RETURNING id, nama, username, role, status, tenant_id, created_at`,
      [
        admin_nama?.trim() || "Admin Pesantren",
        admin_username.trim(),
        adminHash,
        tenant.id,
      ]
    );
    const admin_user = adminResult.rows[0];

    const default_users_created = [];

    if (create_default_unit_users) {
      for (const spec of DEFAULT_UNIT_USERS) {
        const initialPassword = generateUnitUserPassword();
        const unitPasswordHash = await bcrypt.hash(initialPassword, 10);

        const userResult = await client.query(
          `INSERT INTO users (nama, username, password, role, status, tenant_id)
           VALUES ($1, $2, $3, $4, 'Aktif', $5)
           RETURNING id, nama, username, role, status, tenant_id, created_at`,
          [
            spec.username.charAt(0).toUpperCase() + spec.username.slice(1),
            spec.username,
            unitPasswordHash,
            spec.role,
            tenant.id,
          ]
        );

        const created = {
          ...sanitizeUser(userResult.rows[0]),
          initial_password: initialPassword,
        };

        if (spec.unitKode && unitByKode[spec.unitKode]) {
          await client.query(
            `INSERT INTO user_unit_scope (tenant_id, user_id, unit_id, status, updated_at)
             VALUES ($1, $2, $3, 'active', NOW())
             ON CONFLICT DO NOTHING`,
            [tenant.id, created.id, unitByKode[spec.unitKode]]
          );
          created.unit_kode = spec.unitKode;
        }

        default_users_created.push(created);
      }
    }

    await writeTenantCreatedAudit(client, tenant, platformUser, packageName);

    await client.query("COMMIT");

    return {
      tenant,
      admin_user: sanitizeUser(admin_user),
      admin_initial_password: admin_password,
      admin_password_generated: admin_password_generated,
      package: packageName,
      features_enabled: featuresEnabled,
      units,
      default_users_created,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.code === "23505") {
      const dup = new Error("Slug atau username sudah digunakan");
      dup.status = 409;
      throw dup;
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  RESERVED_SLUGS,
  DEFAULT_UNITS,
  DEFAULT_UNIT_USERS,
  validateSlug,
  normalizeCreatePayload,
  createTenantWithDefaults,
  generateSecurePassword,
};
