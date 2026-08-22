-- The canonical per-unit unique index must exist before removing the legacy
-- tenant-agnostic constraint. This migration does not modify attendance rows.
DO $$
BEGIN
  IF to_regclass('public.uq_absensi_tenant_unit_santri_tanggal_sesi') IS NULL THEN
    RAISE EXCEPTION 'Canonical per-unit attendance unique index is missing';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.absensi'::regclass
      AND conname = 'absensi_unique'
  ) THEN
    ALTER TABLE public.absensi DROP CONSTRAINT absensi_unique;
  END IF;
END $$;

DROP INDEX IF EXISTS public.absensi_unique;
