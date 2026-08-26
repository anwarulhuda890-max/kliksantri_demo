-- 084: Canonical per-unit ownership/history for tenant-level Alumni snapshots.
-- Existing alumni rows are preserved. Only rows with unit evidence are backfilled.

CREATE UNIQUE INDEX IF NOT EXISTS uq_alumni_tenant_id_id
  ON alumni (tenant_id, id);

CREATE TABLE IF NOT EXISTS alumni_units (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  alumni_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  identity_key VARCHAR(200) NOT NULL,
  tahun_masuk INTEGER,
  tahun_lulus INTEGER,
  angkatan VARCHAR(80),
  status_kelulusan VARCHAR(20) NOT NULL DEFAULT 'lulus',
  kelas_terakhir VARCHAR(150),
  catatan TEXT,
  source VARCHAR(30) NOT NULL DEFAULT 'manual',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT alumni_units_identity_key_not_blank CHECK (BTRIM(identity_key) <> ''),
  CONSTRAINT alumni_units_status_check CHECK (status_kelulusan IN ('lulus', 'keluar')),
  CONSTRAINT alumni_units_tahun_masuk_check CHECK (tahun_masuk IS NULL OR tahun_masuk BETWEEN 1900 AND 2200),
  CONSTRAINT alumni_units_tahun_lulus_check CHECK (tahun_lulus IS NULL OR tahun_lulus BETWEEN 1900 AND 2200),
  CONSTRAINT alumni_units_year_order_check CHECK (
    tahun_masuk IS NULL OR tahun_lulus IS NULL OR tahun_lulus >= tahun_masuk
  ),
  CONSTRAINT alumni_units_alumni_tenant_fkey
    FOREIGN KEY (tenant_id, alumni_id)
    REFERENCES alumni(tenant_id, id)
    ON DELETE CASCADE,
  CONSTRAINT alumni_units_unit_tenant_fkey
    FOREIGN KEY (tenant_id, unit_id)
    REFERENCES unit_pendidikan(tenant_id, id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_alumni_units_tenant_id_id
  ON alumni_units (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_alumni_units_history
  ON alumni_units (tenant_id, alumni_id, unit_id, COALESCE(tahun_lulus, 0));
CREATE UNIQUE INDEX IF NOT EXISTS uq_alumni_units_business_identity
  ON alumni_units (tenant_id, unit_id, identity_key, COALESCE(tahun_lulus, 0));
CREATE INDEX IF NOT EXISTS idx_alumni_units_unit_year
  ON alumni_units (tenant_id, unit_id, tahun_lulus DESC, alumni_id);

-- Strongest evidence: non-active/closed Santri membership. If historical
-- duplicates exist for one unit, keep the latest membership as the source.
WITH evidenced AS (
  SELECT DISTINCT ON (a.tenant_id, a.id, su.unit_id)
    a.tenant_id,
    a.id AS alumni_id,
    su.unit_id,
    'SANTRI:' || a.santri_id::text AS identity_key,
    a.tahun_masuk,
    a.tahun_lulus,
    a.angkatan,
    a.status_kelulusan,
    a.kelas_terakhir,
    a.catatan
  FROM alumni a
  JOIN santri_units su
    ON su.tenant_id = a.tenant_id
   AND su.santri_id = a.santri_id
  WHERE a.santri_id IS NOT NULL
    AND (su.status <> 'active' OR su.left_at IS NOT NULL)
  ORDER BY a.tenant_id, a.id, su.unit_id,
           su.left_at DESC NULLS LAST, su.updated_at DESC, su.id DESC
)
INSERT INTO alumni_units (
  tenant_id, alumni_id, unit_id, identity_key, tahun_masuk, tahun_lulus,
  angkatan, status_kelulusan, kelas_terakhir, catatan, source
)
SELECT tenant_id, alumni_id, unit_id, identity_key, tahun_masuk, tahun_lulus,
       angkatan, status_kelulusan, kelas_terakhir, catatan, 'santri_membership'
FROM evidenced
ON CONFLICT DO NOTHING;

-- Compatibility for a linked Alumni with exactly one unit membership but no
-- closed membership evidence. No unit is guessed when membership is ambiguous.
WITH sole_membership AS (
  SELECT a.tenant_id, a.id AS alumni_id, MIN(su.unit_id) AS unit_id,
         'SANTRI:' || a.santri_id::text AS identity_key,
         a.tahun_masuk, a.tahun_lulus, a.angkatan, a.status_kelulusan,
         a.kelas_terakhir, a.catatan
  FROM alumni a
  JOIN santri_units su
    ON su.tenant_id = a.tenant_id
   AND su.santri_id = a.santri_id
  WHERE a.santri_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM alumni_units owned
      WHERE owned.tenant_id = a.tenant_id AND owned.alumni_id = a.id
    )
  GROUP BY a.tenant_id, a.id, a.santri_id, a.tahun_masuk, a.tahun_lulus,
           a.angkatan, a.status_kelulusan, a.kelas_terakhir, a.catatan
  HAVING COUNT(DISTINCT su.unit_id) = 1
)
INSERT INTO alumni_units (
  tenant_id, alumni_id, unit_id, identity_key, tahun_masuk, tahun_lulus,
  angkatan, status_kelulusan, kelas_terakhir, catatan, source
)
SELECT tenant_id, alumni_id, unit_id, identity_key, tahun_masuk, tahun_lulus,
       angkatan, status_kelulusan, kelas_terakhir, catatan, 'sole_membership'
FROM sole_membership
ON CONFLICT DO NOTHING;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM alumni_units au
    LEFT JOIN alumni a ON a.tenant_id = au.tenant_id AND a.id = au.alumni_id
    LEFT JOIN unit_pendidikan u ON u.tenant_id = au.tenant_id AND u.id = au.unit_id
    WHERE a.id IS NULL OR u.id IS NULL OR NULLIF(BTRIM(au.identity_key), '') IS NULL
  ) THEN
    RAISE EXCEPTION '084 blocked: alumni_units invalid/orphan/cross-tenant rows';
  END IF;
END $$;
