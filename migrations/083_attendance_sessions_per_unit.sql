-- 083: Data-driven attendance sessions owned by a unit.
-- Historical attendance rows and the legacy `sesi` label remain intact.

CREATE UNIQUE INDEX IF NOT EXISTS uq_unit_pendidikan_tenant_id_id
  ON unit_pendidikan (tenant_id, id);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  unit_id INTEGER NOT NULL,
  code VARCHAR(80) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  start_time TIME,
  end_time TIME,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attendance_sessions_code_not_blank CHECK (BTRIM(code) <> ''),
  CONSTRAINT attendance_sessions_display_name_not_blank CHECK (BTRIM(display_name) <> ''),
  CONSTRAINT attendance_sessions_unit_tenant_fkey
    FOREIGN KEY (tenant_id, unit_id)
    REFERENCES unit_pendidikan(tenant_id, id)
    ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_sessions_tenant_unit_id
  ON attendance_sessions (tenant_id, unit_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_sessions_tenant_unit_code
  ON attendance_sessions (tenant_id, unit_id, code);
CREATE INDEX IF NOT EXISTS idx_attendance_sessions_unit_order
  ON attendance_sessions (tenant_id, unit_id, active, sort_order, id);

ALTER TABLE absensi
  ADD COLUMN IF NOT EXISTS session_id BIGINT,
  ADD COLUMN IF NOT EXISTS session_name_snapshot VARCHAR(120);

-- Source evidence is the historical row itself. No session is invented for a
-- unit without attendance. The CASE only preserves the previous UI order for
-- legacy labels when those labels actually exist in that unit's history.
WITH historical_sessions AS (
  SELECT DISTINCT a.tenant_id, a.unit_id, BTRIM(a.sesi) AS display_name
  FROM absensi a
  WHERE a.unit_id IS NOT NULL
    AND NULLIF(BTRIM(a.sesi), '') IS NOT NULL
), ranked AS (
  SELECT tenant_id, unit_id, display_name,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, unit_id
           ORDER BY CASE display_name
             WHEN 'Ngaji Pagi' THEN 10
             WHEN 'Sekolah' THEN 20
             WHEN 'Ngaji Siang' THEN 30
             WHEN 'Ngaji Sore' THEN 40
             WHEN 'Ngaji Malam' THEN 50
             ELSE 100
           END, display_name
         ) * 10 AS sort_order
  FROM historical_sessions
)
INSERT INTO attendance_sessions (
  tenant_id, unit_id, code, display_name, sort_order, active
)
SELECT tenant_id,
       unit_id,
       'legacy-' || SUBSTRING(MD5(display_name) FROM 1 FOR 20),
       display_name,
       sort_order,
       true
FROM ranked
ON CONFLICT (tenant_id, unit_id, code) DO NOTHING;

UPDATE absensi a
SET session_id = configured.id,
    session_name_snapshot = COALESCE(a.session_name_snapshot, BTRIM(a.sesi))
FROM attendance_sessions configured
WHERE a.tenant_id = configured.tenant_id
  AND a.unit_id = configured.unit_id
  AND configured.code = 'legacy-' || SUBSTRING(MD5(BTRIM(a.sesi)) FROM 1 FOR 20)
  AND a.unit_id IS NOT NULL
  AND a.session_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM absensi
    WHERE unit_id IS NOT NULL
      AND (session_id IS NULL OR NULLIF(BTRIM(session_name_snapshot), '') IS NULL)
  ) THEN
    RAISE EXCEPTION 'ATTENDANCE_SESSION_BACKFILL_MISMATCH';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'absensi_attendance_session_fkey'
  ) THEN
    ALTER TABLE absensi
      ADD CONSTRAINT absensi_attendance_session_fkey
      FOREIGN KEY (tenant_id, unit_id, session_id)
      REFERENCES attendance_sessions(tenant_id, unit_id, id)
      ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'absensi_unit_session_required_check'
  ) THEN
    ALTER TABLE absensi
      ADD CONSTRAINT absensi_unit_session_required_check
      CHECK (
        unit_id IS NULL OR
        (session_id IS NOT NULL AND NULLIF(BTRIM(session_name_snapshot), '') IS NOT NULL)
      ) NOT VALID;
  END IF;
END $$;

-- Remove former text-key uniqueness only after canonical backfill succeeds.
DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'absensi'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) IN (
        'UNIQUE (santri_id, tanggal, sesi)',
        'UNIQUE (tenant_id, unit_id, santri_id, tanggal, sesi)'
      )
  LOOP
    EXECUTE FORMAT('ALTER TABLE absensi DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

DROP INDEX IF EXISTS uq_absensi_tenant_unit_santri_tanggal_sesi;

CREATE UNIQUE INDEX IF NOT EXISTS uq_absensi_tenant_unit_student_date_session
  ON absensi (tenant_id, unit_id, santri_id, tanggal, session_id)
  WHERE unit_id IS NOT NULL AND session_id IS NOT NULL;

-- Compatibility guard for any unresolved pre-unit legacy rows.
CREATE UNIQUE INDEX IF NOT EXISTS uq_absensi_legacy_student_date_label
  ON absensi (tenant_id, santri_id, tanggal, sesi)
  WHERE unit_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_absensi_tenant_unit_session_date
  ON absensi (tenant_id, unit_id, session_id, tanggal);
