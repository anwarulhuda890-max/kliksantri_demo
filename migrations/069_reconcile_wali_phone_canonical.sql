-- Sprint 0B: normalize legacy 62... wali identifiers to the active service's 08... contract.
-- Unlike migrations 007/014 this never creates accounts and never assigns/reset a PIN.
-- Any target collision blocks the migration; operators must reconcile account ownership manually.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM wali_akun source
    JOIN wali_akun target
      ON target.tenant_id=source.tenant_id
     AND target.nomor_hp='0'||SUBSTRING(source.nomor_hp FROM 3)
     AND target.id<>source.id
    WHERE source.status='active' AND target.status='active' AND source.nomor_hp LIKE '62%'
  ) THEN RAISE EXCEPTION '069 blocked: wali_akun phone normalization collision'; END IF;

  IF EXISTS (
    SELECT 1 FROM (
      SELECT tenant_id,
             CASE WHEN nomor_hp LIKE '62%' THEN '0'||SUBSTRING(nomor_hp FROM 3) ELSE nomor_hp END normalized_phone
      FROM wali_akun WHERE status='active'
    ) normalized
    GROUP BY tenant_id,normalized_phone HAVING COUNT(*)>1
  ) THEN RAISE EXCEPTION '069 blocked: duplicate canonical wali account phone'; END IF;
END $$;

UPDATE wali_akun
SET nomor_hp='0'||SUBSTRING(nomor_hp FROM 3), updated_at=NOW()
WHERE status='active' AND nomor_hp LIKE '62%';

UPDATE wali_santri ws
SET nomor_hp='0'||SUBSTRING(ws.nomor_hp FROM 3)
FROM tenants t,santri s
WHERE t.id=ws.tenant_id AND t.status='active'
  AND s.id=ws.santri_id AND s.tenant_id=ws.tenant_id
  AND LOWER(TRIM(COALESCE(s.status,'')))='aktif'
  AND ws.nomor_hp LIKE '62%';

COMMIT;
