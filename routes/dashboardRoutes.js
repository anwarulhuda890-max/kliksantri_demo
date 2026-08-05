const express = require("express");

const pool = require("../db");
const { resolveActiveUnit } = require("../services/unitAccessService");

const router = express.Router();

// ======================
// DASHBOARD SUMMARY
// ======================

router.get(

  "/summary",

  async (req, res) => {

    try {

      const tenantId = req.tenantId;
      const unitAccess = await resolveActiveUnit(req);
      if (unitAccess.mode === "UNIT") {
        return res.status(409).json({
          success: false,
          error: "Dashboard unit belum tersedia sampai snapshot unit modul selesai",
          code: "DASHBOARD_UNIT_SNAPSHOT_PENDING",
          meta: {
            scope: "unit",
            unit_id: unitAccess.unitId,
            unit_name: unitAccess.unit?.nama || null,
            generated_at: new Date().toISOString(),
            data_quality: "partial_legacy",
          },
        });
      }
      const bulanIni = new Date().getMonth() + 1;
      const tahunIni = new Date().getFullYear();

      const santri =
        await pool.query(
          `SELECT COUNT(*) AS total
           FROM santri
           WHERE tenant_id = $1
             AND LOWER(TRIM(COALESCE(status, 'aktif'))) IN ('aktif', 'active', '')`,
          [tenantId]
        );

      const alumni =
        await pool.query(
          `SELECT COUNT(*) AS total FROM alumni WHERE tenant_id = $1`,
          [tenantId]
        );

      const kelas =
        await pool.query(
          `SELECT COUNT(*) AS total FROM kelas WHERE tenant_id = $1`,
          [tenantId]
        );

      const wali =
        await pool.query(
          `SELECT COUNT(*) AS total FROM wali_santri WHERE tenant_id = $1`,
          [tenantId]
        );

      const saldo =
        await pool.query(
          `
          SELECT COALESCE(SUM(saldo), 0) AS total_saldo
          FROM santri
          WHERE tenant_id = $1
          `,
          [tenantId]
        );


      // ======================
      // ABSENSI SANTRI
      // ======================

      const hadirSantri =
        await pool.query(
          `
          SELECT COUNT(*) AS total
          FROM absensi
          WHERE tenant_id = $1
            AND (status = 'H' OR status = 'Hadir')
          `,
          [tenantId]
        );

      const totalAbsensi =
        await pool.query(
          `
          SELECT COUNT(*) AS total
          FROM absensi
          WHERE tenant_id = $1
          `,
          [tenantId]
        );

      // ======================
      // HAFALAN BULAN INI
      // ======================

      const totalHafalan =
        await pool.query(
          `
          SELECT COUNT(*) AS total
          FROM hafalan
          WHERE tenant_id = $1 AND bulan = $2 AND tahun = $3
          `,
          [tenantId, bulanIni, tahunIni]
        );

      // ======================
      // RATA NILAI
      // ======================

      const rataNilai =
        await pool.query(
          `
          SELECT COALESCE(AVG(nilai), 0) AS rata
          FROM nilai_mingguan
          WHERE tenant_id = $1 AND bulan = $2 AND tahun = $3
          `,
          [tenantId, bulanIni, tahunIni]
        );

      // ======================
      // ABSENSI GURU
      // ======================

      let persentaseGuru = 0;

      try {

        const guruHadir =
          await pool.query(
            `
            SELECT COALESCE(SUM(total_hadir), 0) AS total
            FROM absensi_guru
            WHERE tenant_id = $1
            `,
            [tenantId]
          );

        const guruTotal =
          await pool.query(
            `
            SELECT COALESCE(
              SUM(total_hadir + total_izin + total_sakit + total_alfa),
              0
            ) AS total
            FROM absensi_guru
            WHERE tenant_id = $1
            `,
            [tenantId]
          );

        persentaseGuru =

          Number(
            guruTotal.rows[0].total
          ) === 0

            ? 0

            : Math.round(

                (

                  Number(
                    guruHadir.rows[0].total
                  )

                  /

                  Number(
                    guruTotal.rows[0].total
                  )

                ) * 100

              );

      }

      catch {

        persentaseGuru = 0;

      }

      // ======================
      // PERSENTASE SANTRI
      // ======================

      const persentaseSantri =

        Number(
          totalAbsensi.rows[0].total
        ) === 0

          ? 0

          : Math.round(

              (

                Number(
                  hadirSantri.rows[0].total
                )

                /

                Number(
                  totalAbsensi.rows[0].total
                )

              ) * 100

            );

      // ======================
// BELUM KEMBALI
// ======================

const belumKembali =
  await pool.query(
    `
    SELECT COUNT(*) AS total
    FROM perizinan
    WHERE tenant_id = $1 AND status = 'keluar'
    `,
    [tenantId]
  );

const totalPerizinan =
  await pool.query(
    `
    SELECT COUNT(*) AS total
    FROM perizinan
    WHERE tenant_id = $1
      AND EXTRACT(MONTH FROM tanggal) = $2
      AND EXTRACT(YEAR FROM tanggal) = $3
    `,
    [tenantId, bulanIni, tahunIni]
  );

const totalPelanggaran =
  await pool.query(
    `
    SELECT COUNT(*) AS total
    FROM pelanggaran
    WHERE tenant_id = $1
      AND EXTRACT(MONTH FROM tanggal) = $2
      AND EXTRACT(YEAR FROM tanggal) = $3
    `,
    [tenantId, bulanIni, tahunIni]
  );

const santriMelanggar =
  await pool.query(
    `
    SELECT COUNT(DISTINCT santri_id) AS total
    FROM pelanggaran
    WHERE tenant_id = $1
      AND EXTRACT(MONTH FROM tanggal) = $2
      AND EXTRACT(YEAR FROM tanggal) = $3
    `,
    [tenantId, bulanIni, tahunIni]
  );

const persentaseMelanggar =

  Number(
    santri.rows[0].total
  ) === 0

    ? 0

    : Math.round(

        (

          Number(
            santriMelanggar.rows[0].total
          )

          /

          Number(
            santri.rows[0].total
          )

        ) * 100

      );

      // ======================
      // SANTRI AKTIF / NON AKTIF
      // ======================

      let santriAktif    = Number(santri.rows[0].total);
      let santriNonAktif = 0;

      try {
        const santriStatus = await pool.query(
          `SELECT
             COUNT(*) FILTER (
               WHERE LOWER(TRIM(COALESCE(status, 'aktif'))) IN ('aktif', 'active', '')
             ) AS aktif,
             COUNT(*) FILTER (
               WHERE LOWER(TRIM(COALESCE(status, 'aktif'))) NOT IN ('aktif', 'active', '')
             ) AS non_aktif
           FROM santri
           WHERE tenant_id = $1`,
          [tenantId]
        );
        santriAktif    = Number(santriStatus.rows[0].aktif);
        santriNonAktif = Number(santriStatus.rows[0].non_aktif);
      } catch { /* kolom status tidak ada, gunakan fallback */ }

      // ======================
      // ABSENSI HARI INI
      // ======================

      const absensiHariIni = await pool.query(
        `SELECT COUNT(*) AS total FROM absensi
         WHERE tenant_id = $1 AND tanggal = CURRENT_DATE`,
        [tenantId]
      );

      const nilaiTerisi = await pool.query(
        `SELECT COUNT(*) AS total FROM nilai_mingguan
         WHERE tenant_id = $1 AND bulan = $2 AND tahun = $3`,
        [tenantId, bulanIni, tahunIni]
      );

      const santriPoinTertinggi = await pool.query(
        `SELECT s.nama, COUNT(p.id) AS jumlah_pelanggaran
         FROM pelanggaran p
         JOIN santri s ON p.santri_id = s.id AND s.tenant_id = p.tenant_id
         WHERE p.tenant_id = $1
           AND EXTRACT(MONTH FROM p.tanggal) = $2
           AND EXTRACT(YEAR FROM p.tanggal) = $3
         GROUP BY s.id, s.nama
         ORDER BY jumlah_pelanggaran DESC
         LIMIT 5`,
        [tenantId, bulanIni, tahunIni]
      );

      // ======================
      // WALI AKUN
      // ======================

      let totalWaliAkun     = 0;
      let waliBelumGantiPin = 0;

      try {
        const waliAkunResult = await pool.query(
          `SELECT
             COUNT(*) AS total,
             COUNT(*) FILTER (WHERE must_change_pin = true) AS belum_ganti
           FROM wali_akun
           WHERE tenant_id = $1`,
          [tenantId]
        );
        totalWaliAkun     = Number(waliAkunResult.rows[0].total);
        waliBelumGantiPin = Number(waliAkunResult.rows[0].belum_ganti);
      } catch { /* wali_akun belum dibuat */ }

      // ======================
      // DASHBOARD KEUANGAN (tenant-scoped)
      // ======================

const kasMasuk =
await pool.query(

`

SELECT

COALESCE(
SUM(nominal),
0
) AS total

FROM buku_kas

WHERE tenant_id = $3
  AND jenis = 'Masuk'

AND EXTRACT(
MONTH FROM tanggal
) = $1

AND EXTRACT(
YEAR FROM tanggal
) = $2

`,

[
bulanIni,
tahunIni,
tenantId
]

);

const kasKeluar =
await pool.query(

`

SELECT

COALESCE(
SUM(nominal),
0
) AS total

FROM buku_kas

WHERE tenant_id = $3
  AND jenis = 'Keluar'

AND EXTRACT(
MONTH FROM tanggal
) = $1

AND EXTRACT(
YEAR FROM tanggal
) = $2

`,

[
bulanIni,
tahunIni,
tenantId
]

);

const pembayaranSahriyah =
await pool.query(

`

SELECT

COALESCE(
SUM(total_bayar),
0
) AS total

FROM tagihan_sahriyah

WHERE tenant_id = $1
  AND bulan = $2
  AND tahun = $3

`,

[tenantId, bulanIni, tahunIni]

);

const tunggakanSahriyah =
await pool.query(

`

WITH current_bills AS (
  SELECT DISTINCT ON (santri_id)
    santri_id,
    status,
    nominal,
    total_bayar,
    sisa_tagihan
  FROM tagihan_sahriyah
  WHERE tenant_id = $1
    AND bulan = $2
    AND tahun = $3
  ORDER BY santri_id, id DESC
)
SELECT COALESCE(SUM(
  CASE
    WHEN b.santri_id IS NULL
      OR LOWER(TRIM(COALESCE(b.status, ''))) NOT IN ('lunas', 'cicilan')
      THEN COALESCE(NULLIF(b.nominal, 0), ss.nominal_uang, 0)
    WHEN LOWER(TRIM(COALESCE(b.status, ''))) LIKE '%cicil%'
      THEN GREATEST(
        COALESCE(
          NULLIF(b.sisa_tagihan, 0),
          COALESCE(NULLIF(b.nominal, 0), ss.nominal_uang, 0) - COALESCE(b.total_bayar, 0)
        ),
        0
      )
    ELSE 0
  END
), 0)::bigint AS total
FROM santri s
LEFT JOIN current_bills b ON b.santri_id = s.id
LEFT JOIN sahriyah_setting ss
  ON ss.santri_id = s.id
 AND ss.tenant_id = s.tenant_id
WHERE s.tenant_id = $1

`,

[tenantId, bulanIni, tahunIni]

);

const statusSahriyah =
await pool.query(
  `
  WITH current_bills AS (
    SELECT DISTINCT ON (santri_id)
      santri_id,
      status,
      sisa_tagihan
    FROM tagihan_sahriyah
    WHERE tenant_id = $1
      AND bulan = $2
      AND tahun = $3
    ORDER BY santri_id, id DESC
  )
  SELECT
    COUNT(s.id)::int AS total_santri,
    COUNT(*) FILTER (
      WHERE b.santri_id IS NOT NULL
        AND LOWER(TRIM(COALESCE(b.status, ''))) = 'lunas'
    )::int AS lunas,
    COUNT(*) FILTER (
      WHERE b.santri_id IS NOT NULL
        AND LOWER(TRIM(COALESCE(b.status, ''))) LIKE '%cicil%'
    )::int AS cicilan,
    COUNT(*) FILTER (
      WHERE b.santri_id IS NULL
        OR (
          LOWER(TRIM(COALESCE(b.status, ''))) <> 'lunas'
          AND LOWER(TRIM(COALESCE(b.status, ''))) NOT LIKE '%cicil%'
        )
    )::int AS belum_bayar
  FROM santri s
  LEFT JOIN current_bills b ON b.santri_id = s.id
  WHERE s.tenant_id = $1
    AND LOWER(TRIM(COALESCE(s.status, 'aktif'))) IN ('aktif', 'active', '')
  `,
  [tenantId, bulanIni, tahunIni]
);

// ======================
// GRAFIK KAS
// ======================

const grafikKas =
await pool.query(

`

SELECT

EXTRACT(
MONTH FROM tanggal
) AS bulan,

COALESCE(

SUM(

CASE

WHEN jenis = 'Masuk'

THEN nominal

ELSE 0

END

),

0

) AS masuk,

COALESCE(

SUM(

CASE

WHEN jenis = 'Keluar'

THEN nominal

ELSE 0

END

),

0

) AS keluar

FROM buku_kas

WHERE tenant_id = $2

AND

EXTRACT(
YEAR FROM tanggal
) = $1

GROUP BY bulan

ORDER BY bulan

`,

[
tahunIni,
tenantId
]

);

// ======================
// TRANSAKSI TERBARU
// ======================

const transaksiTerbaru =
await pool.query(

`

SELECT

id,
tanggal,
jenis,
kategori,
keterangan,
nominal,
petugas

FROM buku_kas

WHERE tenant_id = $1

ORDER BY tanggal DESC,
id DESC

LIMIT 10

`,

[tenantId]

);

// ======================
// PEMBAYARAN TERBARU
// ======================

const pembayaranTerbaru =
await pool.query(

`

SELECT

p.id,
p.nama_tagihan,
p.nominal_bayar,
p.sisa_tunggakan,
p.status,

s.nama

FROM pembayaran p

LEFT JOIN santri s

ON p.santri_id = s.id
AND s.tenant_id = p.tenant_id

WHERE p.tenant_id = $1

ORDER BY p.id DESC

LIMIT 10

`,

[tenantId]

);

// ======================
// TOP TUNGGAKAN
// ======================

const topTunggakan =
await pool.query(

`

SELECT
s.nama,
t.sisa_tagihan
FROM tagihan_sahriyah t
LEFT JOIN santri s
ON s.id = t.santri_id
AND s.tenant_id = t.tenant_id
WHERE t.tenant_id = $1
  AND t.sisa_tagihan > 0
ORDER BY t.sisa_tagihan DESC
LIMIT 10

`,

[tenantId]

);


      // ======================
      // DAFTAR TAMU
      // ======================

const tamuHariIni =
await pool.query(`
SELECT COUNT(*) total
FROM tamu
WHERE tenant_id = $1 AND tanggal = CURRENT_DATE
`, [tenantId]);

const tamuBulanIni =
await pool.query(`
SELECT COUNT(*) total
FROM tamu
WHERE tenant_id = $1
  AND EXTRACT(MONTH FROM tanggal)=EXTRACT(MONTH FROM CURRENT_DATE)
  AND EXTRACT(YEAR FROM tanggal)=EXTRACT(YEAR FROM CURRENT_DATE)
`, [tenantId]);

const tamuMasihDidalam =
await pool.query(`
SELECT COUNT(*) total
FROM tamu
WHERE tenant_id = $1 AND status='Masuk'
`, [tenantId]);

const kesehatanStats = await pool.query(`
  WITH latest AS (
    SELECT DISTINCT ON (ks.santri_id)
      ks.santri_id,
      ks.status_kesehatan,
      ks.status_penanganan
    FROM kesehatan_santri ks
    INNER JOIN santri s ON s.id = ks.santri_id AND s.tenant_id = ks.tenant_id
    WHERE ks.tenant_id = $1
      AND LOWER(TRIM(COALESCE(s.status, 'aktif'))) IN ('aktif', 'active', '')
    ORDER BY ks.santri_id, ks.created_at DESC
  ),
  santri_aktif AS (
    SELECT COUNT(*)::int AS total
    FROM santri
    WHERE tenant_id = $1
      AND LOWER(TRIM(COALESCE(status, 'aktif'))) IN ('aktif', 'active', '')
  )
  SELECT
    (SELECT total FROM santri_aktif) AS total_santri,
    COUNT(*) FILTER (WHERE l.status_kesehatan = 'sakit')::int AS sakit,
    COUNT(*) FILTER (
      WHERE l.status_kesehatan = 'sakit'
        AND l.status_penanganan IN ('observasi', 'istirahat')
    )::int AS perlu_tindak_lanjut
  FROM latest l
`, [tenantId]);

const kStat = kesehatanStats.rows[0] || {};
const kTotalSantri = Number(kStat.total_santri || 0);
const kSakit = Number(kStat.sakit || 0);

      res.json({

        success: true,

        meta: {
          scope: "all",
          unit_id: null,
          unit_name: null,
          generated_at: new Date().toISOString(),
          data_quality: "tenant_aggregate_legacy",
        },

        data: {

          total_santri:
            Number(santri.rows[0].total),

          total_alumni:
            Number(alumni.rows[0].total),

          santri_aktif:
            santriAktif,

          santri_non_aktif:
            santriNonAktif,

          total_kelas:
            Number(kelas.rows[0].total),

          total_wali:
            Number(wali.rows[0].total),

          total_saldo:
            Number(saldo.rows[0].total_saldo),

          persentase_kehadiran_santri:
            persentaseSantri,

          persentase_kehadiran_guru:
            persentaseGuru,

          total_hafalan:
            Number(totalHafalan.rows[0].total),

          rata_nilai:
            Math.round(rataNilai.rows[0].rata),

          absensi_hari_ini:
            Number(absensiHariIni.rows[0].total),

          nilai_terisi:
            Number(nilaiTerisi.rows[0].total),

          santri_poin_tertinggi:
            santriPoinTertinggi.rows.map(r => ({
              nama: r.nama,
              jumlah_pelanggaran: Number(r.jumlah_pelanggaran)
            })),

          total_wali_akun:
            totalWaliAkun,

          wali_belum_ganti_pin:
            waliBelumGantiPin,

belum_kembali:
  Number(
    belumKembali.rows[0].total
  ),

total_perizinan:
  Number(
    totalPerizinan.rows[0].total
  ),

total_pelanggaran:
  Number(
    totalPelanggaran.rows[0].total
  ),

persentase_melanggar:
  persentaseMelanggar,

  kas_masuk:
  Number(
    kasMasuk.rows[0].total
  ),

kas_keluar:
  Number(
    kasKeluar.rows[0].total
  ),

saldo_kas:
  Number(
    kasMasuk.rows[0].total
  )
  -
  Number(
    kasKeluar.rows[0].total
  ),

total_pembayaran:
  Number(
    pembayaranSahriyah.rows[0].total
  ),

total_tunggakan:
  Number(
    tunggakanSahriyah.rows[0].total
  ),

sahriyah_status: {
  total_santri: Number(statusSahriyah.rows[0].total_santri),
  lunas: Number(statusSahriyah.rows[0].lunas),
  cicilan: Number(statusSahriyah.rows[0].cicilan),
  belum_bayar: Number(statusSahriyah.rows[0].belum_bayar),
},

grafik_kas:
  grafikKas.rows,

transaksi_terbaru:
  transaksiTerbaru.rows,

pembayaran_terbaru:
  pembayaranTerbaru.rows,

top_tunggakan:
topTunggakan.rows,

tamu_hari_ini:
Number(
  tamuHariIni.rows[0].total
),

tamu_bulan_ini:
Number(
  tamuBulanIni.rows[0].total
),

tamu_masih_didalam:
Number(
  tamuMasihDidalam.rows[0].total
),

kesehatan_sehat:
  Math.max(kTotalSantri - kSakit, 0),

kesehatan_sakit:
  kSakit,

kesehatan_perlu_tindak_lanjut:
  Number(kStat.perlu_tindak_lanjut || 0),

        }

      });

    }

    catch (err) {

      console.log(err);

      res.status(500).json({

        success: false,

        error:
          err.message

      });

    }

  }

);

module.exports = router;
