-- Canonical Santri/Unit backfill for the first multi-unit operational sprint.
-- Additive and idempotent. It intentionally leaves ambiguous rows for operator review.
BEGIN;

CREATE TABLE IF NOT EXISTS multi_unit_backfill_review (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entity_type VARCHAR(40) NOT NULL,
  entity_id BIGINT NOT NULL,
  reason VARCHAR(80) NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(20) NOT NULL DEFAULT 'REVIEW_REQUIRED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT multi_unit_backfill_review_status_check
    CHECK (status IN ('REVIEW_REQUIRED','RESOLVED','IGNORED')),
  CONSTRAINT multi_unit_backfill_review_unique
    UNIQUE (tenant_id, entity_type, entity_id, reason)
);

-- A legacy class is deterministic only when class and santri share the same tenant.
INSERT INTO santri_units (
  tenant_id, santri_id, unit_id, unit_student_number, status,
  joined_at, left_at, is_primary, metadata
)
SELECT
  s.tenant_id,
  s.id,
  k.unit_id,
  NULLIF(TRIM(s.nis), ''),
  CASE
    WHEN LOWER(TRIM(COALESCE(s.status, 'aktif'))) IN ('aktif','active','') THEN 'active'
    ELSE 'inactive'
  END,
  s.tanggal_masuk_pesantren,
  NULL,
  NOT EXISTS (
    SELECT 1 FROM santri_units primary_membership
    WHERE primary_membership.tenant_id = s.tenant_id
      AND primary_membership.santri_id = s.id
      AND primary_membership.status = 'active'
      AND primary_membership.left_at IS NULL
      AND primary_membership.is_primary = true
  ),
  jsonb_build_object('backfill_source', 'santri.kelas_id', 'migration', '071')
FROM santri s
JOIN kelas k
  ON k.id = s.kelas_id
 AND k.tenant_id = s.tenant_id
JOIN unit_pendidikan u
  ON u.id = k.unit_id
 AND u.tenant_id = s.tenant_id
WHERE NOT EXISTS (
  SELECT 1 FROM santri_units existing
  WHERE existing.tenant_id = s.tenant_id
    AND existing.santri_id = s.id
    AND existing.unit_id = k.unit_id
    AND existing.status = CASE
      WHEN LOWER(TRIM(COALESCE(s.status, 'aktif'))) IN ('aktif','active','') THEN 'active'
      ELSE 'inactive'
    END
);

-- Enrollment is backfilled only for an active membership with an unambiguous legacy class.
INSERT INTO santri_kelas_enrollments (
  tenant_id, santri_unit_id, kelas_id, start_date, status
)
SELECT su.tenant_id, su.id, s.kelas_id, COALESCE(su.joined_at, s.tanggal_masuk_pesantren), 'active'
FROM santri s
JOIN kelas k
  ON k.id = s.kelas_id
 AND k.tenant_id = s.tenant_id
JOIN santri_units su
  ON su.tenant_id = s.tenant_id
 AND su.santri_id = s.id
 AND su.unit_id = k.unit_id
 AND su.status = 'active'
 AND su.left_at IS NULL
WHERE LOWER(TRIM(COALESCE(s.status, 'aktif'))) IN ('aktif','active','')
  AND NOT EXISTS (
    SELECT 1 FROM santri_kelas_enrollments existing
    WHERE existing.tenant_id = su.tenant_id
      AND existing.santri_unit_id = su.id
      AND existing.status = 'active'
      AND existing.end_date IS NULL
  );

-- No class means no deterministic unit. Do not guess a Pesantren/default unit.
INSERT INTO multi_unit_backfill_review (tenant_id, entity_type, entity_id, reason, detail)
SELECT s.tenant_id, 'santri', s.id, 'MISSING_LEGACY_CLASS',
       jsonb_build_object('legacy_kelas_id', s.kelas_id)
FROM santri s
WHERE s.kelas_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM santri_units su
    WHERE su.tenant_id = s.tenant_id AND su.santri_id = s.id
  )
ON CONFLICT (tenant_id, entity_type, entity_id, reason) DO NOTHING;

-- A dangling or cross-tenant class reference must be repaired by an operator.
INSERT INTO multi_unit_backfill_review (tenant_id, entity_type, entity_id, reason, detail)
SELECT s.tenant_id, 'santri', s.id, 'INVALID_OR_CROSS_TENANT_CLASS',
       jsonb_build_object('legacy_kelas_id', s.kelas_id)
FROM santri s
LEFT JOIN kelas k
  ON k.id = s.kelas_id AND k.tenant_id = s.tenant_id
WHERE s.kelas_id IS NOT NULL
  AND k.id IS NULL
ON CONFLICT (tenant_id, entity_type, entity_id, reason) DO NOTHING;

COMMIT;
