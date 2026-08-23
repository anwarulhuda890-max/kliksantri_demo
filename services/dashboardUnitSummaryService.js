function normalizeScopeUnitId(unitId) {
  if (unitId == null || unitId === '') return null;
  const parsed = Number(unitId);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error('Dashboard unit_id tidak valid');
  return parsed;
}

function percentage(numerator, denominator) {
  const total = Number(denominator || 0);
  return total === 0 ? 0 : Math.round((Number(numerator || 0) / total) * 100);
}

async function getDashboardUnitSummary(client, { tenantId, unitId, month, year }) {
  const scopedUnitId = normalizeScopeUnitId(unitId);
  const params = [Number(tenantId), scopedUnitId, Number(month), Number(year)];

  const [academic, operational, recentPermits, topViolations, announcements, health, guests] = await Promise.all([
    client.query(
      `SELECT
         (SELECT COUNT(*)::int
          FROM guru_units gu
          JOIN guru g ON g.id=gu.guru_id AND g.tenant_id=gu.tenant_id
          JOIN unit_pendidikan u ON u.id=gu.unit_id AND u.tenant_id=gu.tenant_id AND u.is_active=true
          WHERE gu.tenant_id=$1 AND gu.status='active' AND gu.left_at IS NULL
            AND ($2::int IS NULL OR gu.unit_id=$2)) AS total_guru,
         (SELECT COUNT(*) FILTER (WHERE a.status IN ('H','Hadir'))::int
          FROM absensi a
          JOIN unit_pendidikan u ON u.id=a.unit_id AND u.tenant_id=a.tenant_id AND u.is_active=true
          WHERE a.tenant_id=$1 AND ($2::int IS NULL OR a.unit_id=$2)) AS santri_hadir,
         (SELECT COUNT(*)::int
          FROM absensi a
          JOIN unit_pendidikan u ON u.id=a.unit_id AND u.tenant_id=a.tenant_id AND u.is_active=true
          WHERE a.tenant_id=$1 AND ($2::int IS NULL OR a.unit_id=$2)) AS santri_absensi_total,
         (SELECT COUNT(*)::int
          FROM absensi a
          JOIN unit_pendidikan u ON u.id=a.unit_id AND u.tenant_id=a.tenant_id AND u.is_active=true
          WHERE a.tenant_id=$1 AND ($2::int IS NULL OR a.unit_id=$2) AND a.tanggal=CURRENT_DATE) AS absensi_hari_ini,
         (SELECT COALESCE(SUM(ag.total_hadir),0)::bigint
          FROM absensi_guru ag
          JOIN unit_pendidikan u ON u.id=ag.unit_id AND u.tenant_id=ag.tenant_id AND u.is_active=true
          WHERE ag.tenant_id=$1 AND ($2::int IS NULL OR ag.unit_id=$2)) AS guru_hadir,
         (SELECT COALESCE(SUM(ag.total_hadir+ag.total_izin+ag.total_sakit+ag.total_alfa),0)::bigint
          FROM absensi_guru ag
          JOIN unit_pendidikan u ON u.id=ag.unit_id AND u.tenant_id=ag.tenant_id AND u.is_active=true
          WHERE ag.tenant_id=$1 AND ($2::int IS NULL OR ag.unit_id=$2)) AS guru_absensi_total,
         (SELECT COUNT(*)::int
          FROM hafalan h
          JOIN unit_pendidikan u ON u.id=h.unit_id AND u.tenant_id=h.tenant_id AND u.is_active=true
          WHERE h.tenant_id=$1 AND ($2::int IS NULL OR h.unit_id=$2) AND h.bulan=$3 AND h.tahun=$4) AS total_hafalan,
         (SELECT COUNT(*)::int
          FROM nilai_mingguan n
          JOIN unit_pendidikan u ON u.id=n.unit_id AND u.tenant_id=n.tenant_id AND u.is_active=true
          WHERE n.tenant_id=$1 AND ($2::int IS NULL OR n.unit_id=$2) AND n.bulan=$3 AND n.tahun=$4) AS nilai_terisi,
         (SELECT COALESCE(SUM(n.nilai),0)::numeric
          FROM nilai_mingguan n
          JOIN unit_pendidikan u ON u.id=n.unit_id AND u.tenant_id=n.tenant_id AND u.is_active=true
          WHERE n.tenant_id=$1 AND ($2::int IS NULL OR n.unit_id=$2) AND n.bulan=$3 AND n.tahun=$4) AS nilai_total`,
      params,
    ),
    client.query(
      `SELECT
         COUNT(*) FILTER (WHERE p.tanggal IS NOT NULL AND EXTRACT(MONTH FROM p.tanggal)=$3 AND EXTRACT(YEAR FROM p.tanggal)=$4)::int AS total_perizinan,
         COUNT(*) FILTER (WHERE LOWER(TRIM(COALESCE(p.status,'')))='keluar')::int AS belum_kembali,
         (SELECT COUNT(*)::int
          FROM pelanggaran pl
          JOIN unit_pendidikan plu ON plu.id=pl.unit_id AND plu.tenant_id=pl.tenant_id AND plu.is_active=true
          WHERE pl.tenant_id=$1 AND ($2::int IS NULL OR pl.unit_id=$2)
            AND EXTRACT(MONTH FROM pl.tanggal)=$3 AND EXTRACT(YEAR FROM pl.tanggal)=$4) AS total_pelanggaran
         ,(SELECT COUNT(DISTINCT pl.santri_id)::int
          FROM pelanggaran pl
          JOIN unit_pendidikan plu ON plu.id=pl.unit_id AND plu.tenant_id=pl.tenant_id AND plu.is_active=true
          WHERE pl.tenant_id=$1 AND ($2::int IS NULL OR pl.unit_id=$2)
            AND EXTRACT(MONTH FROM pl.tanggal)=$3 AND EXTRACT(YEAR FROM pl.tanggal)=$4) AS santri_melanggar
       FROM perizinan p
       JOIN unit_pendidikan u ON u.id=p.unit_id AND u.tenant_id=p.tenant_id AND u.is_active=true
       WHERE p.tenant_id=$1 AND ($2::int IS NULL OR p.unit_id=$2)`,
      params,
    ),
    client.query(
      `SELECT p.id,p.santri_id,p.tanggal,p.alasan,p.catatan,p.status,p.unit_id,s.nama
       FROM perizinan p
       JOIN unit_pendidikan u ON u.id=p.unit_id AND u.tenant_id=p.tenant_id AND u.is_active=true
       JOIN santri s ON s.id=p.santri_id AND s.tenant_id=p.tenant_id
       WHERE p.tenant_id=$1 AND ($2::int IS NULL OR p.unit_id=$2)
         AND LOWER(TRIM(COALESCE(p.status,'')))='keluar'
       ORDER BY p.tanggal DESC,p.id DESC LIMIT 5`,
      params.slice(0, 2),
    ),
    client.query(
      `SELECT s.id,s.nama,COUNT(p.id)::int AS jumlah_pelanggaran,p.unit_id
       FROM pelanggaran p
       JOIN unit_pendidikan u ON u.id=p.unit_id AND u.tenant_id=p.tenant_id AND u.is_active=true
       JOIN santri s ON s.id=p.santri_id AND s.tenant_id=p.tenant_id
       WHERE p.tenant_id=$1 AND ($2::int IS NULL OR p.unit_id=$2)
         AND EXTRACT(MONTH FROM p.tanggal)=$3 AND EXTRACT(YEAR FROM p.tanggal)=$4
       GROUP BY s.id,s.nama,p.unit_id
       ORDER BY jumlah_pelanggaran DESC,s.id LIMIT 5`,
      params,
    ),
    client.query(
      `SELECT p.id,p.judul,p.prioritas,p.published_at,p.created_at,p.is_active,p.unit_id,
              COUNT(*) OVER()::int AS total_count,
              COUNT(*) FILTER (WHERE p.is_active) OVER()::int AS active_count
       FROM pengumuman p
       JOIN unit_pendidikan u ON u.id=p.unit_id AND u.tenant_id=p.tenant_id AND u.is_active=true
       WHERE p.tenant_id=$1 AND p.scope_type='unit' AND ($2::int IS NULL OR p.unit_id=$2)
       ORDER BY p.created_at DESC,p.id DESC LIMIT 5`,
      params.slice(0, 2),
    ),
    client.query(
      `WITH scoped_memberships AS (
         SELECT su.id,su.santri_id,su.unit_id
         FROM santri_units su
         JOIN santri s ON s.id=su.santri_id AND s.tenant_id=su.tenant_id
         JOIN unit_pendidikan u ON u.id=su.unit_id AND u.tenant_id=su.tenant_id AND u.is_active=true
         WHERE su.tenant_id=$1 AND ($2::int IS NULL OR su.unit_id=$2)
           AND su.status='active' AND su.left_at IS NULL
           AND LOWER(TRIM(COALESCE(s.status,'aktif'))) IN ('aktif','active','')
       ), latest AS (
         SELECT DISTINCT ON (ks.unit_id,ks.santri_unit_id)
           ks.unit_id,ks.santri_unit_id,ks.status_kesehatan,ks.status_penanganan
         FROM kesehatan_santri ks
         JOIN scoped_memberships sm ON sm.unit_id=ks.unit_id AND sm.id=ks.santri_unit_id
         WHERE ks.tenant_id=$1
         ORDER BY ks.unit_id,ks.santri_unit_id,ks.created_at DESC,ks.id DESC
       )
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE l.status_kesehatan='sakit')::int AS sakit,
              COUNT(*) FILTER (WHERE l.status_kesehatan='sakit' AND l.status_penanganan IN ('observasi','istirahat'))::int AS perlu
       FROM scoped_memberships sm
       LEFT JOIN latest l ON l.unit_id=sm.unit_id AND l.santri_unit_id=sm.id`,
      params.slice(0, 2),
    ),
    client.query(
      `SELECT COUNT(*) FILTER (WHERE t.tanggal=CURRENT_DATE)::int AS hari_ini,
              COUNT(*) FILTER (WHERE EXTRACT(MONTH FROM t.tanggal)=$2 AND EXTRACT(YEAR FROM t.tanggal)=$3)::int AS bulan_ini,
              COUNT(*) FILTER (WHERE t.status='Masuk')::int AS masih_didalam
       FROM tamu t WHERE t.tenant_id=$1`,
      [Number(tenantId), Number(month), Number(year)],
    ),
  ]);

  const a = academic.rows[0] || {};
  const o = operational.rows[0] || {};
  const h = health.rows[0] || {};
  const g = guests.rows[0] || {};
  const announcementRows = announcements.rows || [];
  const nilaiCount = Number(a.nilai_terisi || 0);

  return {
    academic: {
      total_guru: Number(a.total_guru || 0),
      santri_hadir: Number(a.santri_hadir || 0),
      santri_absensi_total: Number(a.santri_absensi_total || 0),
      persentase_kehadiran_santri: percentage(a.santri_hadir, a.santri_absensi_total),
      absensi_hari_ini: Number(a.absensi_hari_ini || 0),
      guru_hadir: Number(a.guru_hadir || 0),
      guru_absensi_total: Number(a.guru_absensi_total || 0),
      persentase_kehadiran_guru: percentage(a.guru_hadir, a.guru_absensi_total),
      total_hafalan: Number(a.total_hafalan || 0),
      nilai_terisi: nilaiCount,
      nilai_total: Number(a.nilai_total || 0),
      rata_nilai: nilaiCount === 0 ? 0 : Math.round(Number(a.nilai_total || 0) / nilaiCount),
    },
    operational: {
      total_perizinan: Number(o.total_perizinan || 0),
      belum_kembali: Number(o.belum_kembali || 0),
      recent_perizinan: recentPermits.rows,
      total_pelanggaran: Number(o.total_pelanggaran || 0),
      santri_melanggar: Number(o.santri_melanggar || 0),
      santri_poin_tertinggi: topViolations.rows,
      total_pengumuman: Number(announcementRows[0]?.total_count || 0),
      pengumuman_aktif: Number(announcementRows[0]?.active_count || 0),
      pengumuman_terbaru: announcementRows,
    },
    health: {
      total: Number(h.total || 0),
      sehat: Math.max(Number(h.total || 0) - Number(h.sakit || 0), 0),
      sakit: Number(h.sakit || 0),
      perlu_tindak_lanjut: Number(h.perlu || 0),
    },
    guests: {
      ownership: 'TENANT',
      hari_ini: Number(g.hari_ini || 0),
      bulan_ini: Number(g.bulan_ini || 0),
      masih_didalam: Number(g.masih_didalam || 0),
    },
  };
}

module.exports = { getDashboardUnitSummary, normalizeScopeUnitId, percentage };
