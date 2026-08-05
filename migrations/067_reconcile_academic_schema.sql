-- Sprint 0B: academic/alumni schema required by active source.
-- Replaces 057-060 with final tenant-safe relations and no demo curriculum seed.
-- santri.kamar remains a backward-compatible legacy/default field until unit membership owns room data.
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_santri_tenant_id_id ON santri (tenant_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_kelas_tenant_id_id ON kelas (tenant_id, id);

CREATE TABLE IF NOT EXISTS mata_pelajaran (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  nama VARCHAR(120) NOT NULL,
  aktif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mata_pelajaran_tenant_nama_key UNIQUE (tenant_id, nama)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_mata_pelajaran_tenant_id_id ON mata_pelajaran (tenant_id, id);
CREATE INDEX IF NOT EXISTS idx_mata_pelajaran_tenant_active
  ON mata_pelajaran (tenant_id, aktif, nama);

CREATE TABLE IF NOT EXISTS kelas_mata_pelajaran (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kelas_id INTEGER NOT NULL,
  mata_pelajaran_id BIGINT NOT NULL,
  urutan SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT kelas_mapel_kelas_tenant_fkey
    FOREIGN KEY (tenant_id, kelas_id) REFERENCES kelas(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT kelas_mapel_mapel_tenant_fkey
    FOREIGN KEY (tenant_id, mata_pelajaran_id) REFERENCES mata_pelajaran(tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT kelas_mapel_tenant_key UNIQUE (tenant_id, kelas_id, mata_pelajaran_id)
);
CREATE INDEX IF NOT EXISTS idx_kelas_mapel_tenant_kelas
  ON kelas_mata_pelajaran (tenant_id, kelas_id, urutan);

ALTER TABLE santri ADD COLUMN IF NOT EXISTS kamar VARCHAR(120);
CREATE INDEX IF NOT EXISTS idx_santri_tenant_kamar ON santri (tenant_id, kamar);

CREATE TABLE IF NOT EXISTS alumni (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  santri_id INTEGER,
  nama VARCHAR(150) NOT NULL,
  nis VARCHAR(80),
  jenis_kelamin VARCHAR(20),
  tahun_masuk INTEGER,
  tahun_lulus INTEGER,
  angkatan VARCHAR(80),
  status_kelulusan VARCHAR(20) NOT NULL DEFAULT 'lulus',
  kelas_terakhir VARCHAR(150),
  kontak VARCHAR(50),
  alamat TEXT,
  pekerjaan VARCHAR(150),
  catatan TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT alumni_status_kelulusan_check CHECK (status_kelulusan IN ('lulus','keluar')),
  CONSTRAINT alumni_santri_tenant_fkey
    FOREIGN KEY (tenant_id, santri_id) REFERENCES santri(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT alumni_tenant_santri_unique UNIQUE (tenant_id, santri_id)
);
CREATE INDEX IF NOT EXISTS idx_alumni_tenant_nama ON alumni (tenant_id, nama);
CREATE INDEX IF NOT EXISTS idx_alumni_tenant_tahun ON alumni (tenant_id, tahun_lulus);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM mata_pelajaran mp LEFT JOIN tenants t ON t.id=mp.tenant_id
    WHERE t.id IS NULL OR mp.nama IS NULL OR TRIM(mp.nama)=''
  ) THEN RAISE EXCEPTION '067 blocked: invalid mata_pelajaran ownership/name'; END IF;
  IF EXISTS (SELECT 1 FROM mata_pelajaran GROUP BY tenant_id,LOWER(TRIM(nama)) HAVING COUNT(*)>1) THEN
    RAISE EXCEPTION '067 blocked: duplicate mata_pelajaran names';
  END IF;
  IF EXISTS (
    SELECT 1 FROM kelas_mata_pelajaran km
    LEFT JOIN kelas k ON k.id=km.kelas_id
    LEFT JOIN mata_pelajaran mp ON mp.id=km.mata_pelajaran_id
    WHERE k.id IS NULL OR mp.id IS NULL
       OR km.tenant_id IS DISTINCT FROM k.tenant_id
       OR km.tenant_id IS DISTINCT FROM mp.tenant_id
  ) THEN RAISE EXCEPTION '067 blocked: kelas-mapel orphan/cross-tenant rows'; END IF;
  IF EXISTS (SELECT 1 FROM kelas_mata_pelajaran GROUP BY tenant_id,kelas_id,mata_pelajaran_id HAVING COUNT(*)>1) THEN
    RAISE EXCEPTION '067 blocked: duplicate kelas-mapel rows';
  END IF;
  IF EXISTS (
    SELECT 1 FROM alumni a LEFT JOIN tenants t ON t.id=a.tenant_id
    LEFT JOIN santri s ON s.id=a.santri_id
    WHERE t.id IS NULL OR a.nama IS NULL OR TRIM(a.nama)=''
       OR a.status_kelulusan NOT IN ('lulus','keluar')
       OR (a.santri_id IS NOT NULL AND (s.id IS NULL OR a.tenant_id IS DISTINCT FROM s.tenant_id))
  ) THEN RAISE EXCEPTION '067 blocked: alumni invalid/orphan/cross-tenant rows'; END IF;
  IF EXISTS (SELECT 1 FROM alumni WHERE santri_id IS NOT NULL GROUP BY tenant_id,santri_id HAVING COUNT(*)>1) THEN
    RAISE EXCEPTION '067 blocked: duplicate alumni membership';
  END IF;
END $$;

-- Additive snapshot for existing exited/graduated santri. Source handles future transitions.
INSERT INTO alumni (
  tenant_id, santri_id, nama, nis, jenis_kelamin, alamat, kelas_terakhir, status_kelulusan
)
SELECT s.tenant_id, s.id, s.nama, s.nis, s.jenis_kelamin, s.alamat, k.nama_kelas,
       CASE WHEN LOWER(TRIM(s.status))='keluar' THEN 'keluar' ELSE 'lulus' END
FROM santri s
LEFT JOIN kelas k ON k.id=s.kelas_id AND k.tenant_id=s.tenant_id
WHERE LOWER(TRIM(COALESCE(s.status,''))) IN ('lulus','keluar')
ON CONFLICT (tenant_id, santri_id) DO NOTHING;

COMMIT;
