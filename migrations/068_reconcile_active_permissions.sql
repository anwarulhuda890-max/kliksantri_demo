-- Sprint 0B: permissions referenced by active backend/frontend modules.
-- Replaces DML-only migrations 022, 026, 050 and 063 with an additive canonical grant set.
-- Existing extra grants are never deleted automatically; unsafe pimpinan grants block execution.
BEGIN;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM role_permissions rp
    JOIN roles r ON r.id=rp.role_id
    JOIN permissions p ON p.id=rp.permission_id
    WHERE r.name='pimpinan_yayasan'
      AND (p.key LIKE '%.manage' OR p.key LIKE '%.create' OR p.key LIKE '%.update'
           OR p.key LIKE '%.delete' OR p.key IN ('role.manage','user.manage','rfid.manage'))
  ) THEN RAISE EXCEPTION '068 blocked: pimpinan_yayasan has write/manage grants requiring manual review'; END IF;
END $$;

INSERT INTO permissions (key,label,grup) VALUES
  ('absensi.manage','Kelola Absensi Santri','absensi'),
  ('kesehatan.view','Lihat Kesehatan Santri','kesehatan'),
  ('kesehatan.manage','Kelola Kesehatan Santri','kesehatan'),
  ('alumni.view','Lihat Alumni Pesantren','alumni'),
  ('alumni.manage','Kelola Alumni Pesantren','alumni'),
  ('konten_pesantren.view','Lihat Konten Pesantren','konten_pesantren'),
  ('konten_pesantren.manage','Kelola Konten Pesantren','konten_pesantren'),
  ('wallet.view','Lihat Dompet','wallet'),
  ('wallet.manage','Kelola Dompet','wallet')
ON CONFLICT (key) DO UPDATE SET label=EXCLUDED.label, grup=EXCLUDED.grup;

INSERT INTO role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.name='superadmin' AND p.key IN (
  'absensi.manage','kesehatan.view','kesehatan.manage','alumni.view','alumni.manage',
  'konten_pesantren.view','konten_pesantren.manage','wallet.view','wallet.manage'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.name='sekretaris' AND p.key IN (
  'alumni.view','alumni.manage','konten_pesantren.view','konten_pesantren.manage'
)
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.name IN ('pendidikan','keuangan') AND p.key IN ('wallet.view','wallet.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.name='pimpinan_yayasan' AND p.key IN (
  'dashboard.view','santri.view','wali.view','guru.view','kelas.view','absensi.view',
  'hafalan.view','nilai.view','pelanggaran.view','perizinan.view','pembayaran.view',
  'bukukas.view','kas_instansi.view','kas_instansi.konsolidasi','program_unit.view'
)
ON CONFLICT DO NOTHING;

-- Reconcile only the obsolete visible brand value; preserve every other setting.
DO $$ BEGIN
  IF to_regclass('public.platform_settings') IS NOT NULL THEN
    UPDATE platform_settings
    SET settings=jsonb_set(settings,'{platform_name}',to_jsonb('KlikPesantren'::text),true),
        updated_at=NOW()
    WHERE id=1 AND settings->>'platform_name'='KlikSantri';
  END IF;
END $$;

COMMIT;
