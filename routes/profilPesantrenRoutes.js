const express = require("express");

const router = express.Router();

const pool = require("../db");
const requirePermission = require("../middleware/requirePermission");

function parseTahunBerdiri(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  const maxYear = new Date().getFullYear();
  if (!Number.isInteger(n) || n < 1800 || n > maxYear) {
    return { error: "tahun_berdiri harus 4 digit antara 1800 dan tahun berjalan" };
  }
  return n;
}

function pickSafeDisplayProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    nama_pesantren: row.nama_pesantren,
    alamat: row.alamat,
    logo_url: row.logo_url,
    banner_url: row.banner_url,
    banner_active: row.banner_active,
    splash_logo_url: row.splash_logo_url,
    app_icon_url: row.app_icon_url,
    tagline: row.tagline,
    updated_at: row.updated_at,
  };
}

async function canReadFullProfile(role) {
  if (!role) return false;
  const permissions = await requirePermission.getPermissionList(role, { tenantScoped: true });
  return permissions.includes("profil.view") || permissions.includes("profil.manage");
}

// ======================
// GET /profil-pesantren
// Tenant-scoped via req.tenantId (tenantMiddleware on mount)
// ======================

router.get("/", async (req, res) => {
  try {
    const tenantId = req.tenantId;

    const result = await pool.query(
      `
          SELECT
            id,
            tenant_id,
            nama_pesantren,
            alamat,
            telepon,
            email,
            website,
            logo_url,
            banner_url,
            COALESCE(banner_active, TRUE) AS banner_active,
            splash_logo_url,
            app_icon_url,
            tagline,
            tentang,
            visi,
            misi,
            tahun_berdiri,
            updated_at
          FROM profil_pesantren
          WHERE tenant_id = $1
          LIMIT 1
          `,
      [tenantId]
    );

    const fullProfileAllowed = await canReadFullProfile(req.user?.role);

    res.json({
      success: true,
      data: fullProfileAllowed ? (result.rows[0] ?? null) : pickSafeDisplayProfile(result.rows[0]),
      display_only: !fullProfileAllowed,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

// ======================
// PUT /profil-pesantren
// Upsert per tenant — tidak lagi singleton id = 1
// ======================

router.put("/", requirePermission.requireAnyPermission(["profil.view", "profil.manage"]), async (req, res) => {
  try {
    const tenantId = req.tenantId;

    const {
      nama_pesantren,
      alamat,
      telepon,
      email,
      website,
      logo_url,
      banner_url,
      banner_active,
      splash_logo_url,
      app_icon_url,
      tagline,
      tentang,
      visi,
      misi,
      tahun_berdiri,
    } = req.body;

    if (!nama_pesantren) {
      return res.status(400).json({
        success: false,
        error: "nama_pesantren wajib diisi",
      });
    }

    console.log("[BACKEND PROFIL UPDATE tenant]", tenantId);
    console.log("[BACKEND PROFIL UPDATE banner_url]", banner_url);

    const parsedTahun = parseTahunBerdiri(tahun_berdiri);
    if (parsedTahun && typeof parsedTahun === "object" && parsedTahun.error) {
      return res.status(400).json({ success: false, error: parsedTahun.error });
    }

    const existing = await pool.query(
      `SELECT id FROM profil_pesantren WHERE tenant_id = $1 LIMIT 1`,
      [tenantId]
    );

    let result;

    if (existing.rows.length > 0) {
      result = await pool.query(
        `
          UPDATE profil_pesantren SET
            nama_pesantren = $1,
            alamat         = $2,
            telepon        = $3,
            email          = $4,
            website        = $5,
            logo_url       = $6,
            banner_url     = $7,
            banner_active  = $8,
            splash_logo_url = $9,
            app_icon_url   = $10,
            tagline        = $11,
            tentang        = $12,
            visi           = $13,
            misi           = $14,
            tahun_berdiri  = $15,
            updated_at     = NOW()
          WHERE tenant_id = $16
          RETURNING *
          `,
        [
          nama_pesantren,
          alamat ?? null,
          telepon ?? null,
          email ?? null,
          website ?? null,
          logo_url ?? null,
          banner_url ?? null,
          banner_active !== false,
          splash_logo_url ?? null,
          app_icon_url ?? null,
          tagline ?? null,
          tentang ?? null,
          visi ?? null,
          misi ?? null,
          parsedTahun,
          tenantId,
        ]
      );
    } else {
      result = await pool.query(
        `
          INSERT INTO profil_pesantren (
            tenant_id,
            nama_pesantren,
            alamat,
            telepon,
            email,
            website,
            logo_url,
            banner_url,
            banner_active,
            splash_logo_url,
            app_icon_url,
            tagline,
            tentang,
            visi,
            misi,
            tahun_berdiri,
            updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
          RETURNING *
          `,
        [
          tenantId,
          nama_pesantren,
          alamat ?? null,
          telepon ?? null,
          email ?? null,
          website ?? null,
          logo_url ?? null,
          banner_url ?? null,
          banner_active !== false,
          splash_logo_url ?? null,
          app_icon_url ?? null,
          tagline ?? null,
          tentang ?? null,
          visi ?? null,
          misi ?? null,
          parsedTahun,
        ]
      );
    }

    const row = result.rows[0];
    console.log("[BACKEND PROFIL UPDATED ROW banner_url]", row?.banner_url ?? null);
    console.log("[BACKEND PROFIL UPDATED ROW updated_at]", row?.updated_at ?? null);

    res.json({
      success: true,
      data: row,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
});

module.exports = router;
