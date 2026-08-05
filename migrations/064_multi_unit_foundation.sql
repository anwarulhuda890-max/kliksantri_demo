-- Multi-unit foundation. Additive and intentionally not executed by this sprint.
BEGIN;

-- Master unit: keep unit_pendidikan as the physical source of truth.
ALTER TABLE unit_pendidikan ADD COLUMN IF NOT EXISTS unit_type VARCHAR(20);
ALTER TABLE unit_pendidikan ADD COLUMN IF NOT EXISTS preset_key VARCHAR(20);
ALTER TABLE unit_pendidikan ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE unit_pendidikan ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE unit_pendidikan
SET unit_type = CASE UPPER(kode)
  WHEN 'MADINAH' THEN 'MADIN'
  WHEN 'PESANTREN' THEN 'PESANTREN'
  WHEN 'MADIN' THEN 'MADIN'
  WHEN 'PAUD' THEN 'PAUD'
  WHEN 'TK' THEN 'TK'
  WHEN 'SD' THEN 'SD'
  WHEN 'MI' THEN 'MI'
  WHEN 'SMP' THEN 'SMP'
  WHEN 'MTS' THEN 'MTS'
  WHEN 'SMA' THEN 'SMA'
  WHEN 'MA' THEN 'MA'
  WHEN 'SMK' THEN 'SMK'
  ELSE 'CUSTOM'
END,
preset_key = CASE UPPER(kode)
  WHEN 'MADINAH' THEN 'MADIN'
  WHEN 'PESANTREN' THEN 'PESANTREN'
  WHEN 'MADIN' THEN 'MADIN'
  WHEN 'PAUD' THEN 'PAUD'
  WHEN 'TK' THEN 'TK'
  WHEN 'SD' THEN 'SEKOLAH'
  WHEN 'MI' THEN 'SEKOLAH'
  WHEN 'SMP' THEN 'SEKOLAH'
  WHEN 'MTS' THEN 'SEKOLAH'
  WHEN 'SMA' THEN 'SEKOLAH'
  WHEN 'MA' THEN 'SEKOLAH'
  WHEN 'SMK' THEN 'SEKOLAH'
  ELSE 'CUSTOM'
END
WHERE unit_type IS NULL OR preset_key IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM unit_pendidikan
    GROUP BY tenant_id, CASE WHEN UPPER(kode) = 'MADINAH' THEN 'MADIN' ELSE UPPER(kode) END
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Kode unit canonical ganda pada tenant; relasi harus direkonsiliasi manual';
  END IF;

  UPDATE unit_pendidikan
  SET kode = CASE WHEN UPPER(kode) = 'MADINAH' THEN 'MADIN' ELSE UPPER(kode) END;
END $$;

ALTER TABLE unit_pendidikan ALTER COLUMN unit_type SET NOT NULL;
ALTER TABLE unit_pendidikan ALTER COLUMN preset_key SET NOT NULL;

ALTER TABLE unit_pendidikan DROP CONSTRAINT IF EXISTS unit_pendidikan_unit_type_check;
ALTER TABLE unit_pendidikan ADD CONSTRAINT unit_pendidikan_unit_type_check
  CHECK (unit_type IN ('PESANTREN','MADIN','PAUD','TK','SD','MI','SMP','MTS','SMA','MA','SMK','CUSTOM'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_unit_pendidikan_tenant_id_id
  ON unit_pendidikan (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_unit_pendidikan_tenant_upper_kode
  ON unit_pendidikan (tenant_id, UPPER(kode));

-- Presets are templates. Unit overrides are copied to unit_features.
CREATE TABLE IF NOT EXISTS unit_feature_presets (
  preset_key VARCHAR(20) NOT NULL,
  feature_key VARCHAR(50) NOT NULL,
  enabled_default BOOLEAN NOT NULL DEFAULT true,
  available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (preset_key, feature_key)
);

CREATE TABLE IF NOT EXISTS unit_features (
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id INTEGER NOT NULL,
  feature_key VARCHAR(50) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  source VARCHAR(20) NOT NULL DEFAULT 'default',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, unit_id, feature_key),
  CONSTRAINT unit_features_source_check CHECK (source IN ('default','custom')),
  CONSTRAINT unit_features_unit_tenant_fkey
    FOREIGN KEY (tenant_id, unit_id)
    REFERENCES unit_pendidikan(tenant_id, id) ON DELETE CASCADE
);

INSERT INTO unit_feature_presets (preset_key, feature_key, enabled_default, available) VALUES
  ('PESANTREN','santri',true,true), ('PESANTREN','guru',true,true),
  ('PESANTREN','kelas',true,true), ('PESANTREN','absensi',true,true),
  ('PESANTREN','hafalan',true,true), ('PESANTREN','pelanggaran',true,true),
  ('PESANTREN','perizinan',true,true), ('PESANTREN','kesehatan',true,true),
  ('PESANTREN','sahriyah',true,true), ('PESANTREN','pembayaran',true,true),
  ('PESANTREN','rfid',true,true), ('PESANTREN','asrama',false,false),
  ('PESANTREN','pengumuman',true,true),
  ('PAUD','santri',true,true), ('PAUD','guru',true,true), ('PAUD','kelas',true,true),
  ('PAUD','absensi',true,true), ('PAUD','perkembangan_anak',false,false),
  ('PAUD','pembayaran',true,true), ('PAUD','pengumuman',true,true),
  ('TK','santri',true,true), ('TK','guru',true,true), ('TK','kelas',true,true),
  ('TK','absensi',true,true), ('TK','perkembangan_anak',false,false),
  ('TK','pembayaran',true,true), ('TK','pengumuman',true,true),
  ('SEKOLAH','santri',true,true), ('SEKOLAH','guru',true,true),
  ('SEKOLAH','kelas',true,true), ('SEKOLAH','mata_pelajaran',true,true),
  ('SEKOLAH','absensi',true,true), ('SEKOLAH','nilai',true,true),
  ('SEKOLAH','ujian',false,false), ('SEKOLAH','pembayaran',true,true),
  ('SEKOLAH','pengumuman',true,true),
  ('MADIN','santri',true,true), ('MADIN','guru',true,true),
  ('MADIN','kelas',true,true), ('MADIN','absensi',true,true),
  ('MADIN','nilai',true,true), ('MADIN','hafalan',true,true),
  ('MADIN','pembayaran',true,true), ('MADIN','pengumuman',true,true)
ON CONFLICT (preset_key, feature_key) DO UPDATE SET
  enabled_default = EXCLUDED.enabled_default,
  available = EXCLUDED.available,
  updated_at = NOW();

INSERT INTO unit_features (tenant_id, unit_id, feature_key, enabled, source)
SELECT u.tenant_id, u.id, p.feature_key, p.enabled_default AND p.available, 'default'
FROM unit_pendidikan u
JOIN unit_feature_presets p ON p.preset_key = u.preset_key
ON CONFLICT (tenant_id, unit_id, feature_key) DO NOTHING;

-- Tenant-safe identity keys used by composite foreign keys.
CREATE UNIQUE INDEX IF NOT EXISTS uq_santri_tenant_id_id ON santri (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_tenant_id_id ON users (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kelas_tenant_id_id ON kelas (tenant_id, id);

CREATE TABLE IF NOT EXISTS santri_units (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  santri_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  unit_student_number VARCHAR(80),
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  joined_at DATE,
  left_at DATE,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT santri_units_status_check CHECK (status IN ('active','inactive','graduated','left')),
  CONSTRAINT santri_units_dates_check CHECK (left_at IS NULL OR joined_at IS NULL OR left_at >= joined_at),
  CONSTRAINT santri_units_santri_tenant_fkey FOREIGN KEY (tenant_id, santri_id)
    REFERENCES santri(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT santri_units_unit_tenant_fkey FOREIGN KEY (tenant_id, unit_id)
    REFERENCES unit_pendidikan(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_santri_units_tenant_id_id ON santri_units (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_santri_units_active
  ON santri_units (tenant_id, santri_id, unit_id)
  WHERE status = 'active' AND left_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_santri_units_primary
  ON santri_units (tenant_id, santri_id)
  WHERE status = 'active' AND left_at IS NULL AND is_primary = true;
CREATE INDEX IF NOT EXISTS idx_santri_units_unit_active
  ON santri_units (tenant_id, unit_id, santri_id)
  WHERE status = 'active' AND left_at IS NULL;

CREATE TABLE IF NOT EXISTS santri_kelas_enrollments (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  santri_unit_id BIGINT NOT NULL,
  kelas_id INTEGER NOT NULL,
  tahun_ajaran VARCHAR(20),
  semester SMALLINT,
  start_date DATE,
  end_date DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT santri_kelas_semester_check CHECK (semester IS NULL OR semester IN (1,2)),
  CONSTRAINT santri_kelas_status_check CHECK (status IN ('active','completed','moved','cancelled')),
  CONSTRAINT santri_kelas_dates_check CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date),
  CONSTRAINT santri_kelas_membership_tenant_fkey FOREIGN KEY (tenant_id, santri_unit_id)
    REFERENCES santri_units(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT santri_kelas_kelas_tenant_fkey FOREIGN KEY (tenant_id, kelas_id)
    REFERENCES kelas(tenant_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_santri_kelas_active
  ON santri_kelas_enrollments (tenant_id, santri_unit_id)
  WHERE status = 'active' AND end_date IS NULL;

-- Evolve existing user_unit_scope; an empty assignment never means all units.
ALTER TABLE user_unit_scope ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
ALTER TABLE user_unit_scope ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE user_unit_scope ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE user_unit_scope ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE user_unit_scope scope
SET tenant_id = usr.tenant_id
FROM users usr
WHERE usr.id = scope.user_id AND scope.tenant_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM user_unit_scope scope
    JOIN users usr ON usr.id = scope.user_id
    JOIN unit_pendidikan unit ON unit.id = scope.unit_id
    WHERE usr.tenant_id IS DISTINCT FROM unit.tenant_id
       OR scope.tenant_id IS DISTINCT FROM usr.tenant_id
  ) THEN
    RAISE EXCEPTION 'user_unit_scope memiliki relasi lintas tenant';
  END IF;
END $$;

ALTER TABLE user_unit_scope ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE user_unit_scope DROP CONSTRAINT IF EXISTS user_unit_scope_status_check;
ALTER TABLE user_unit_scope ADD CONSTRAINT user_unit_scope_status_check
  CHECK (status IN ('active','inactive'));
ALTER TABLE user_unit_scope DROP CONSTRAINT IF EXISTS user_unit_scope_user_tenant_fkey;
ALTER TABLE user_unit_scope ADD CONSTRAINT user_unit_scope_user_tenant_fkey
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;
ALTER TABLE user_unit_scope DROP CONSTRAINT IF EXISTS user_unit_scope_unit_tenant_fkey;
ALTER TABLE user_unit_scope ADD CONSTRAINT user_unit_scope_unit_tenant_fkey
  FOREIGN KEY (tenant_id, unit_id) REFERENCES unit_pendidikan(tenant_id, id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_user_unit_scope_tenant_user_active
  ON user_unit_scope (tenant_id, user_id, unit_id) WHERE status = 'active';

-- Dedicated permissions for unit administration.
INSERT INTO permissions (key, label, grup) VALUES
  ('unit.view', 'Lihat Unit Pendidikan', 'unit'),
  ('unit.manage', 'Kelola Unit Pendidikan', 'unit')
ON CONFLICT (key) DO UPDATE SET label = EXCLUDED.label, grup = EXCLUDED.grup;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'superadmin' AND p.key IN ('unit.view','unit.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('pimpinan_yayasan','pendidikan','keuangan','keamanan','sekretaris','bendahara_unit')
  AND p.key = 'unit.view'
ON CONFLICT DO NOTHING;

COMMIT;
