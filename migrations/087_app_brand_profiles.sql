BEGIN;

CREATE TABLE IF NOT EXISTS app_brand_profiles (
  id BIGSERIAL PRIMARY KEY,
  brand_key VARCHAR(63) NOT NULL,
  tenant_id BIGINT REFERENCES tenants(id) ON DELETE RESTRICT,
  mode VARCHAR(20) NOT NULL DEFAULT 'universal',
  app_name VARCHAR(120) NOT NULL,
  short_name VARCHAR(40) NOT NULL,
  slogan VARCHAR(180),
  logo_url TEXT,
  icon_url TEXT,
  splash_logo_url TEXT,
  primary_color CHAR(7) NOT NULL DEFAULT '#15803D',
  package_id VARCHAR(255),
  custom_domain_id BIGINT REFERENCES tenant_domains(id) ON DELETE SET NULL,
  play_store_url TEXT,
  play_store_status VARCHAR(30) NOT NULL DEFAULT 'NOT_PUBLISHED',
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  current_version_name VARCHAR(30) NOT NULL DEFAULT '1.0.0',
  current_version_code INTEGER NOT NULL DEFAULT 1,
  firebase_config_ref TEXT,
  created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  updated_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_brand_profiles_brand_key_format CHECK (brand_key ~ '^[a-z][a-z0-9]{1,62}$'),
  CONSTRAINT app_brand_profiles_mode_check CHECK (mode IN ('universal', 'white_label')),
  CONSTRAINT app_brand_profiles_mode_tenant_check CHECK (
    (mode = 'universal' AND tenant_id IS NULL) OR
    (mode = 'white_label' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT app_brand_profiles_color_check CHECK (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT app_brand_profiles_status_check CHECK (status IN ('DRAFT', 'APPROVED', 'BUILD_READY', 'PUBLISHED')),
  CONSTRAINT app_brand_profiles_play_status_check CHECK (play_store_status IN ('NOT_PUBLISHED', 'IN_REVIEW', 'PUBLISHED', 'SUSPENDED')),
  CONSTRAINT app_brand_profiles_version_code_check CHECK (current_version_code > 0),
  CONSTRAINT app_brand_profiles_release_fields_check CHECK (
    status NOT IN ('BUILD_READY', 'PUBLISHED') OR package_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS app_brand_profiles_brand_key_uidx
  ON app_brand_profiles (brand_key);
CREATE UNIQUE INDEX IF NOT EXISTS app_brand_profiles_package_id_uidx
  ON app_brand_profiles (LOWER(package_id)) WHERE package_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS app_brand_profiles_universal_uidx
  ON app_brand_profiles (mode) WHERE mode = 'universal';
CREATE UNIQUE INDEX IF NOT EXISTS app_brand_profiles_tenant_uidx
  ON app_brand_profiles (tenant_id) WHERE tenant_id IS NOT NULL;

CREATE OR REPLACE FUNCTION protect_published_app_brand_profile()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' AND (
    NEW.brand_key IS DISTINCT FROM OLD.brand_key OR
    NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR
    NEW.mode IS DISTINCT FROM OLD.mode OR
    NEW.package_id IS DISTINCT FROM OLD.package_id
  ) THEN
    RAISE EXCEPTION 'Published brand identity is immutable'
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS app_brand_profiles_protect_published ON app_brand_profiles;
CREATE TRIGGER app_brand_profiles_protect_published
BEFORE UPDATE ON app_brand_profiles
FOR EACH ROW EXECUTE FUNCTION protect_published_app_brand_profile();

INSERT INTO permissions (key, label, grup)
VALUES
  ('platform.brand.view', 'Lihat Branding Aplikasi', 'platform'),
  ('platform.brand.manage', 'Kelola Branding Aplikasi', 'platform'),
  ('platform.brand.approve', 'Setujui Branding Aplikasi', 'platform')
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, grup = EXCLUDED.grup;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key IN ('platform.brand.view', 'platform.brand.manage', 'platform.brand.approve')
WHERE r.name = 'platform_superadmin'
ON CONFLICT DO NOTHING;

INSERT INTO app_brand_profiles (
  brand_key, tenant_id, mode, app_name, short_name, slogan,
  primary_color, package_id, status, current_version_name,
  current_version_code, firebase_config_ref
) VALUES (
  'universal', NULL, 'universal', 'WaliSantri', 'WaliSantri',
  'Portal wali santri, didukung KlikPesantren', '#15803D',
  'com.klikpesantren.wali', 'BUILD_READY', '1.0.0', 7,
  'firebase/android/com.klikpesantren.wali/google-services.json'
)
ON CONFLICT (brand_key) DO NOTHING;

COMMIT;
