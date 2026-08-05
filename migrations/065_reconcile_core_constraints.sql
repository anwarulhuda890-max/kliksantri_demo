-- Sprint 0B: canonical constraints required by active source.
-- Forward-only replacement for destructive/overlapping migrations 008-013 and 016.
-- This migration never deletes rows. Run preflight-migration-reconciliation.js first.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE status IS NULL OR LOWER(TRIM(status)) NOT IN ('aktif','active','nonaktif','inactive')) THEN
    RAISE EXCEPTION '065 blocked: users.status contains unknown/null values';
  END IF;
  IF EXISTS (SELECT 1 FROM guru WHERE nama IS NULL OR TRIM(nama) = '') THEN
    RAISE EXCEPTION '065 blocked: guru.nama contains null/blank values';
  END IF;
  IF EXISTS (SELECT 1 FROM guru WHERE status IS NULL OR LOWER(TRIM(status)) NOT IN ('aktif','active','nonaktif','inactive')) THEN
    RAISE EXCEPTION '065 blocked: guru.status contains unknown/null values';
  END IF;
  IF EXISTS (SELECT 1 FROM absensi GROUP BY santri_id, tanggal, sesi HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION '065 blocked: duplicate absensi rows require manual reconciliation';
  END IF;
  IF EXISTS (SELECT 1 FROM absensi a LEFT JOIN santri s ON s.id = a.santri_id
             WHERE s.id IS NULL OR a.tenant_id IS DISTINCT FROM s.tenant_id) THEN
    RAISE EXCEPTION '065 blocked: absensi has orphan/cross-tenant santri';
  END IF;
  IF EXISTS (SELECT 1 FROM absensi_guru ag LEFT JOIN guru g ON g.id = ag.guru_id
             WHERE ag.guru_id IS NULL OR ag.bulan IS NULL OR ag.tahun IS NULL
                OR g.id IS NULL OR ag.tenant_id IS DISTINCT FROM g.tenant_id) THEN
    RAISE EXCEPTION '065 blocked: absensi_guru has null/orphan/cross-tenant rows';
  END IF;
  IF EXISTS (SELECT 1 FROM absensi_guru GROUP BY guru_id, bulan, tahun HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION '065 blocked: duplicate absensi_guru rows require manual reconciliation';
  END IF;
END $$;

-- Active admin-web contracts use title-case Indonesian values.
UPDATE users
SET status = CASE
  WHEN LOWER(TRIM(status)) IN ('aktif','active') THEN 'Aktif'
  WHEN LOWER(TRIM(status)) IN ('nonaktif','inactive') THEN 'Nonaktif'
  ELSE status
END
WHERE status IS DISTINCT FROM CASE
  WHEN LOWER(TRIM(status)) IN ('aktif','active') THEN 'Aktif'
  WHEN LOWER(TRIM(status)) IN ('nonaktif','inactive') THEN 'Nonaktif'
  ELSE status
END;

ALTER TABLE users ALTER COLUMN status SET DEFAULT 'Aktif';
ALTER TABLE users ALTER COLUMN status SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='users'::regclass AND conname='users_status_canonical_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_status_canonical_check
      CHECK (status IN ('Aktif','Nonaktif')) NOT VALID;
  END IF;
END $$;
ALTER TABLE users VALIDATE CONSTRAINT users_status_canonical_check;

UPDATE guru
SET status = CASE
  WHEN LOWER(TRIM(status)) IN ('aktif','active') THEN 'Aktif'
  WHEN LOWER(TRIM(status)) IN ('nonaktif','inactive') THEN 'Nonaktif'
  ELSE status
END
WHERE status IS DISTINCT FROM CASE
  WHEN LOWER(TRIM(status)) IN ('aktif','active') THEN 'Aktif'
  WHEN LOWER(TRIM(status)) IN ('nonaktif','inactive') THEN 'Nonaktif'
  ELSE status
END;

ALTER TABLE guru ALTER COLUMN nama SET NOT NULL;
ALTER TABLE guru ALTER COLUMN status SET DEFAULT 'Aktif';
ALTER TABLE guru ALTER COLUMN status SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='guru'::regclass AND conname='guru_status_canonical_check') THEN
    ALTER TABLE guru ADD CONSTRAINT guru_status_canonical_check
      CHECK (status IN ('Aktif','Nonaktif')) NOT VALID;
  END IF;
END $$;
ALTER TABLE guru VALIDATE CONSTRAINT guru_status_canonical_check;

-- Exact unique keys are retained because active ON CONFLICT clauses infer them.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='absensi'::regclass AND contype='u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (santri_id, tanggal, sesi)'
  ) THEN
    ALTER TABLE absensi ADD CONSTRAINT absensi_santri_tanggal_sesi_key
      UNIQUE (santri_id, tanggal, sesi);
  END IF;
END $$;

ALTER TABLE absensi_guru ALTER COLUMN guru_id SET NOT NULL;
ALTER TABLE absensi_guru ALTER COLUMN bulan SET NOT NULL;
ALTER TABLE absensi_guru ALTER COLUMN tahun SET NOT NULL;
ALTER TABLE absensi_guru ALTER COLUMN tenant_id SET NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='absensi_guru'::regclass AND contype='u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (guru_id, bulan, tahun)'
  ) THEN
    ALTER TABLE absensi_guru ADD CONSTRAINT absensi_guru_guru_bulan_tahun_key
      UNIQUE (guru_id, bulan, tahun);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='absensi_guru'::regclass AND conname='absensi_guru_bulan_check') THEN
    ALTER TABLE absensi_guru ADD CONSTRAINT absensi_guru_bulan_check
      CHECK (bulan BETWEEN 1 AND 12) NOT VALID;
  END IF;
END $$;
ALTER TABLE absensi_guru VALIDATE CONSTRAINT absensi_guru_bulan_check;

CREATE UNIQUE INDEX IF NOT EXISTS uq_guru_tenant_id_id ON guru (tenant_id, id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='absensi_guru'::regclass AND conname='absensi_guru_tenant_guru_fkey') THEN
    ALTER TABLE absensi_guru ADD CONSTRAINT absensi_guru_tenant_guru_fkey
      FOREIGN KEY (tenant_id, guru_id) REFERENCES guru(tenant_id, id)
      ON DELETE CASCADE NOT VALID;
  END IF;
END $$;
ALTER TABLE absensi_guru VALIDATE CONSTRAINT absensi_guru_tenant_guru_fkey;

COMMIT;
