const express = require("express");

const pool = require("../db");
const { resolveActiveUnit } = require("../services/unitAccessService");
const { getDashboardFinanceSummary } = require("../services/dashboardFinanceSummaryService");

const router = express.Router();

const UNIT_NATIVE_DASHBOARD_FIELDS = [
  "total_santri",
  "santri_aktif",
  "santri_non_aktif",
  "total_kelas",
  "kas_masuk",
  "kas_keluar",
  "saldo_kas",
  "nominal_tagihan",
  "sudah_dibayar",
  "sisa_belum_dibayar",
  "pembayaran_hari_ini",
  "tagihan_belum_lunas",
  "total_pembayaran",
  "total_tunggakan",
  "sahriyah_status",
  "grafik_kas",
  "transaksi_terbaru",
  "pembayaran_terbaru",
  "top_tunggakan",
];

const TENANT_WIDE_DASHBOARD_FIELDS = [
  "total_alumni",
  "total_wali",
  "total_saldo",
  "persentase_kehadiran_santri",
  "persentase_kehadiran_guru",
  "total_hafalan",
  "rata_nilai",
  "absensi_hari_ini",
  "nilai_terisi",
  "total_wali_akun",
  "wali_belum_ganti_pin",
  "santri_poin_tertinggi",
  "total_pelanggaran",
  "total_perizinan",
  "belum_kembali",
  "tamu_hari_ini",
  "tamu_bulan_ini",
  "tamu_masih_didalam",
  "kesehatan_sehat",
  "kesehatan_sakit",
  "kesehatan_perlu_tindak_lanjut",
];

async function queryDashboardSantriCounts(client, tenantId, unitAccess) {
  if (unitAccess.mode === "UNIT") {
    const { rows } = await client.query(
      `SELECT
         COUNT(DISTINCT su.santri_id) FILTER (
           WHERE su.status = 'active'
             AND su.left_at IS NULL
             AND LOWER(TRIM(COALESCE(s.status, 'aktif'))) IN ('aktif', 'active', '')
         )::int AS total,
         COUNT(DISTINCT su.santri_id) FILTER (
           WHERE su.status = 'active'
             AND su.left_at IS NULL
             AND LOWER(TRIM(COALESCE(s.status, 'aktif'))) IN ('aktif', 'active', '')
         )::int AS aktif,
         COUNT(DISTINCT su.santri_id) FILTER (
           WHERE NOT (
             su.status = 'active'
             AND su.left_at IS NULL
             AND LOWER(TRIM(COALESCE(s.status, 'aktif'))) IN ('aktif', 'active', '')
           )
         )::int AS non_aktif
       FROM santri_units su
       JOIN santri s
         ON s.id = su.santri_id
        AND s.tenant_id = su.tenant_id
       WHERE su.tenant_id = $1
         AND su.unit_id = $2`,
      [tenantId, unitAccess.unitId],
    );
    return rows[0] || { total: 0, aktif: 0, non_aktif: 0 };
  }

  const { rows } = await client.query(
    `SELECT
       COUNT(DISTINCT id) FILTER (
         WHERE LOWER(TRIM(COALESCE(status, 'aktif'))) IN ('aktif', 'active', '')
       )::int AS total,
       COUNT(DISTINCT id) FILTER (
         WHERE LOWER(TRIM(COALESCE(status, 'aktif'))) IN ('aktif', 'active', '')
       )::int AS aktif,
       COUNT(DISTINCT id) FILTER (
         WHERE LOWER(TRIM(COALESCE(status, 'aktif'))) NOT IN ('aktif', 'active', '')
       )::int AS non_aktif
     FROM santri
     WHERE tenant_id = $1`,
    [tenantId],
  );
  return rows[0] || { total: 0, aktif: 0, non_aktif: 0 };
}

async function queryDashboardKelasCount(client, tenantId, unitAccess) {
  if (unitAccess.mode === "UNIT") {
    const { rows } = await client.query(
      `SELECT COUNT(DISTINCT k.id)::int AS total
       FROM kelas k
       JOIN unit_pendidikan u
         ON u.id = k.unit_id
        AND u.tenant_id = k.tenant_id
        AND u.is_active = true
       WHERE k.tenant_id = $1
         AND k.unit_id = $2`,
      [tenantId, unitAccess.unitId],
    );
    return Number(rows[0]?.total || 0);
  }

  const { rows } = await client.query(
    `SELECT COUNT(DISTINCT k.id)::int AS total
     FROM kelas k
     JOIN unit_pendidikan u
       ON u.id = k.unit_id
      AND u.tenant_id = k.tenant_id
      AND u.is_active = true
     WHERE k.tenant_id = $1`,
    [tenantId],
  );
  return Number(rows[0]?.total || 0);
}

function buildDashboardErrorResponse(err) {
  const status = Number(err?.status || 500);
  if (status >= 400 && status < 500) {
    return {
      status,
      body: {
        success: false,
        error: err.message || "Akses dashboard ditolak",
        code: err.code || "DASHBOARD_ACCESS_DENIED",
        meta: {
          scope: "unresolved",
          data_quality: "access_denied",
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      success: false,
      error: err?.message || "Dashboard belum dapat dimuat",
      code: "DASHBOARD_SUMMARY_FAILED",
    },
  };
}

// ======================
// DASHBOARD SUMMARY
// ======================

router.get(

  "/summary",

  async (req, res) => {

    try {

      const tenantId = req.tenantId;
      const unitAccess = await resolveActiveUnit(req);
      const isUnitScope = unitAccess.mode === "UNIT";
      const bulanIni = new Date().getMonth() + 1;
      const tahunIni = new Date().getFullYear();

      const santri = await queryDashboardSantriCounts(pool, tenantId, unitAccess);

      const alumni =
        await pool.query(
          `SELECT COUNT(*) AS total FROM alumni WHERE tenant_id = $1`,
          [tenantId]
        );

      const totalKelas = await queryDashboardKelasCount(pool, tenantId, unitAccess);

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
    santri.total || 0
  ) === 0

    ? 0

    : Math.round(

        (

          Number(
            santriMelanggar.rows[0].total
          )

          /

          Number(
            santri.total || 0
          )

        ) * 100

      );

      // ======================
      // SANTRI AKTIF / NON AKTIF
      // ======================

      let santriAktif = Number(santri.aktif || santri.total || 0);
      let santriNonAktif = Number(santri.non_aktif || 0);

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

      const financeSummary = await getDashboardFinanceSummary(pool, {
        tenantId,
        unitId: isUnitScope ? unitAccess.unitId : null,
        month: bulanIni,
        year: tahunIni,
      });
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
          scope: isUnitScope ? "unit" : "all",
          all_units: !isUnitScope,
          unit_id: isUnitScope ? unitAccess.unitId : null,
          unit_name: isUnitScope ? unitAccess.unit?.nama || null : null,
          generated_at: new Date().toISOString(),
          data_quality: isUnitScope ? "unit_native_partial" : "tenant_aggregate_mixed",
          unit_native_fields: UNIT_NATIVE_DASHBOARD_FIELDS,
          tenant_wide_fields: TENANT_WIDE_DASHBOARD_FIELDS,
        },

        data: {

          total_santri:
            Number(santri.total || 0),

          total_alumni:
            Number(alumni.rows[0].total),

          santri_aktif:
            santriAktif,

          santri_non_aktif:
            santriNonAktif,

          total_kelas:
            totalKelas,

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
  financeSummary.cash.masuk,

kas_keluar:
  financeSummary.cash.keluar,

saldo_kas:
  financeSummary.cash.saldo,

nominal_tagihan:
  financeSummary.payment.nominal_tagihan,

sudah_dibayar:
  financeSummary.payment.sudah_dibayar,

sisa_belum_dibayar:
  financeSummary.payment.sisa_belum_dibayar,

pembayaran_hari_ini:
  financeSummary.payment.pembayaran_hari_ini,

tagihan_belum_lunas:
  financeSummary.payment.tagihan_belum_lunas,

total_pembayaran:
  financeSummary.sahriyah.sudah_dibayar,

total_tunggakan:
  financeSummary.sahriyah.sisa_belum_dibayar,

sahriyah_status:
  financeSummary.sahriyah.status,

grafik_kas:
  financeSummary.grafik_kas,

transaksi_terbaru:
  financeSummary.transaksi_terbaru,

pembayaran_terbaru:
  financeSummary.pembayaran_terbaru,

top_tunggakan:
  financeSummary.top_tunggakan,

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

      const response = buildDashboardErrorResponse(err);
      if (response.status >= 500) console.log(err);

      res.status(response.status).json(response.body);

    }

  }

);

router._test = {
  buildDashboardErrorResponse,
  queryDashboardKelasCount,
  queryDashboardSantriCounts,
};

module.exports = router;
