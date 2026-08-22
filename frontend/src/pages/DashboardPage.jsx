import { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import AppShell from "../layouts/AppShell";
import { DashboardResponsiveStyles } from "../components/dashboard/DashboardResponsiveStyles";
import DashboardMetrics from "../components/dashboard/DashboardMetrics";
import DashboardHero from "../components/dashboard/DashboardHero";
import DashboardAnnouncement from "../components/dashboard/DashboardAnnouncement";
import DashboardViolations from "../components/dashboard/DashboardViolations";
import DashboardFinanceChart from "../components/dashboard/DashboardFinanceChart";
import DashboardKeuangan from "../components/dashboard/DashboardKeuangan";
import DashboardPendidikan from "../components/dashboard/DashboardPendidikan";
import DashboardKeamanan from "../components/dashboard/DashboardKeamanan";
import DashboardSekretaris from "../components/dashboard/DashboardSekretaris";
import DashboardKesehatanHariIni from "../components/dashboard/DashboardKesehatanHariIni";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { getUser } from "../utils/storage";
import { hasPermission } from "../utils/hasPermission";

const DEFAULT_SHORTCUTS = [
  { permission: "absensi.view", label: "Absensi Santri", path: "/absensi" },
  { permission: "program_unit.view", label: "Program Unit", path: "/program-unit" },
  { permission: "kas_instansi.view", label: "Kas Unit", path: "/kas-instansi" },
  { permission: "pembayaran.view", label: "Pembayaran", path: "/pembayaran" },
  { permission: "santri.view", label: "Data Santri", path: "/santri" },
  { permission: "pengumuman.view", label: "Pengumuman", path: "/pengumuman" },
];

function createEmptySummary() {
  return {
    total_santri: 0,
    total_alumni: 0,
    santri_aktif: 0,
    santri_non_aktif: 0,
    total_kelas: 0,
    total_wali: 0,
    total_saldo: 0,
    persentase_kehadiran_santri: 0,
    persentase_kehadiran_guru: 0,
    total_hafalan: 0,
    rata_nilai: 0,
    absensi_hari_ini: 0,
    nilai_terisi: 0,
    total_wali_akun: 0,
    wali_belum_ganti_pin: 0,
    santri_poin_tertinggi: [],
    kas_masuk: 0,
    kas_keluar: 0,
    saldo_kas: 0,
    total_pembayaran: 0,
    total_tunggakan: 0,
    sahriyah_status: { total_santri: 0, lunas: 0, cicilan: 0, belum_bayar: 0 },
    total_pelanggaran: 0,
    total_perizinan: 0,
    belum_kembali: 0,
    tamu_hari_ini: 0,
    tamu_bulan_ini: 0,
    tamu_masih_didalam: 0,
    grafik_kas: [],
    transaksi_terbaru: [],
    pembayaran_terbaru: [],
    top_tunggakan: [],
  };
}

function DashboardPage() {
  const user = getUser();
  const {
    activeUnitId,
    activeUnit,
    allUnitsAllowed,
    loading: unitLoading,
    error: unitError,
  } = useActiveUnit();

  const [summary, setSummary] = useState(createEmptySummary);
  const [summaryMeta, setSummaryMeta] = useState({ scope: "all", all_units: true });
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");

  const role = user?.role || "";
  const canViewDashboardData = hasPermission("dashboard.view");
  const shortcuts = DEFAULT_SHORTCUTS.filter((item) => hasPermission(item.permission));

  const isUnitWorkspace = Boolean(activeUnitId);
  const dashboardScopeReady = !unitLoading && !unitError && (allUnitsAllowed || isUnitWorkspace);
  const dashboardBlockedMessage = unitError ||
    (!unitLoading && !allUnitsAllowed && !isUnitWorkspace
      ? "Belum memiliki penugasan unit. Minta superadmin mengatur unit untuk akun ini."
      : "");
  const unitContext = isUnitWorkspace
    ? { scope: "unit", unitName: activeUnit?.nama || summaryMeta.unit_name || "Unit" }
    : dashboardScopeReady ? { scope: "all" } : { scope: "blocked" };
  const summaryForView = dashboardScopeReady && !summaryError ? summary : createEmptySummary();
  const pembayaranTerbaru = summaryForView?.pembayaran_terbaru || [];
  const grafikKas = (summaryForView?.grafik_kas || []).map((item) => ({
    bulan: ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][
      Number(item.bulan)
    ],
    masuk: Number(item.masuk),
    keluar: Number(item.keluar),
  }));

  const getSummary = useCallback(async () => {
    if (!activeUnitId && !allUnitsAllowed) {
      setSummary(createEmptySummary());
      setSummaryMeta({ scope: "blocked", all_units: false });
      setSummaryError("Belum memiliki penugasan unit. Minta superadmin mengatur unit untuk akun ini.");
      return;
    }

    try {
      setSummaryLoading(true);
      setSummaryError("");
      const params = activeUnitId ? { unit_id: activeUnitId } : { scope: "all" };
      const response = await api.get("/dashboard/summary", { params });
      setSummary(response.data.data);
      setSummaryMeta(response.data.meta || { scope: activeUnitId ? "unit" : "all" });
    } catch (err) {
      console.error(err);
      const code = err.response?.data?.code;
      setSummary(createEmptySummary());
      setSummaryError(
        ["UNIT_ACCESS_DENIED", "UNIT_REQUIRED"].includes(code)
          ? "Belum memiliki penugasan unit. Minta superadmin mengatur unit untuk akun ini."
          : err.response?.data?.error || "Ringkasan dashboard belum dapat dimuat."
      );
    } finally {
      setSummaryLoading(false);
    }
  }, [activeUnitId, allUnitsAllowed]);

  useEffect(() => {
    if (canViewDashboardData && dashboardScopeReady) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      getSummary();
    }
  }, [canViewDashboardData, dashboardScopeReady, getSummary]);

  return (
    <AppShell title="Dashboard" breadcrumb="Dashboard">
      <DashboardResponsiveStyles />
      <div className="dashboard-page dashboard-monitoring-v3">
        <section className="dashboard-section dashboard-section--hero">
          <DashboardHero unitContext={unitContext} />
        </section>

        {canViewDashboardData && dashboardScopeReady ? (
          <section className="dashboard-section">
            <div style={contextPanelStyle}>
              <strong>
                {isUnitWorkspace
                  ? `Workspace aktif: ${unitContext.unitName}`
                  : "Workspace aktif: Semua Unit"}
              </strong>
              <span>
                {isUnitWorkspace
                  ? "Dashboard menampilkan Santri dan Kelas berbasis unit. Ringkasan lama yang belum unit-native disembunyikan agar tidak terlihat sebagai angka unit."
                  : "Dashboard menampilkan agregasi yayasan/tenant dengan santri unik, bukan jumlah membership."}
              </span>
            </div>
          </section>
        ) : null}

        {canViewDashboardData && !unitLoading && (summaryError || dashboardBlockedMessage) ? (
          <section className="dashboard-section">
            <div style={errorPanelStyle}>{summaryError || dashboardBlockedMessage}</div>
          </section>
        ) : null}

        {unitLoading || summaryLoading ? (
          <section className="dashboard-section">
            <div style={loadingPanelStyle}>Memuat ringkasan workspace aktif...</div>
          </section>
        ) : null}

        {!canViewDashboardData ? (
          <section className="dashboard-section dashboard-section--metrics">
            <div style={shortcutPanelStyle}>
              <div>
                <h2 style={shortcutTitleStyle}>Akses Cepat</h2>
                <p style={shortcutSubtitleStyle}>
                  Pilih halaman yang tersedia untuk role Anda.
                </p>
              </div>
              <div style={shortcutGridStyle}>
                {shortcuts.length > 0 ? (
                  shortcuts.map((item) => (
                    <a key={item.path} href={item.path} style={shortcutLinkStyle}>
                      {item.label}
                    </a>
                  ))
                ) : (
                  <span style={shortcutEmptyStyle}>
                    Belum ada halaman yang bisa diakses. Minta admin mengatur permission role.
                  </span>
                )}
              </div>
            </div>
          </section>
        ) : null}

        {canViewDashboardData && dashboardScopeReady && !summaryError && role === "superadmin" && (
          <>
          <section className="dashboard-section dashboard-section--metrics">
            <DashboardMetrics summary={summaryForView} meta={isUnitWorkspace ? { scope: "unit" } : summaryMeta} />
          </section>

          {!isUnitWorkspace ? (
          <>
          <section className="dashboard-section dashboard-section--panels">
            <div className="dashboard-row-3">
              <DashboardKesehatanHariIni summary={summaryForView} />
              <DashboardAnnouncement
                pembayaranTerbaru={pembayaranTerbaru}
                sahriyahStatus={summaryForView.sahriyah_status}
                totalPembayaran={summaryForView.total_pembayaran}
                totalTunggakan={summaryForView.total_tunggakan}
              />
              <DashboardViolations
                topPelanggar={(summaryForView.santri_poin_tertinggi || []).slice(0, 5)}
              />
            </div>
          </section>

          <section className="dashboard-section dashboard-section--chart">
            <DashboardFinanceChart grafikKas={grafikKas} />
          </section>
          </>
          ) : null}
          </>
        )}

        {canViewDashboardData && dashboardScopeReady && !summaryError && role === "keuangan" && <DashboardKeuangan summary={summaryForView} />}

        {canViewDashboardData && dashboardScopeReady && !summaryError && role === "pendidikan" && <DashboardPendidikan summary={summaryForView} />}

        {canViewDashboardData && dashboardScopeReady && !summaryError && role === "keamanan" && <DashboardKeamanan summary={summaryForView} />}

        {canViewDashboardData && dashboardScopeReady && !summaryError && role === "sekretaris" && <DashboardSekretaris summary={summaryForView} />}

        {canViewDashboardData && dashboardScopeReady && !summaryError && !["superadmin", "keuangan", "pendidikan", "keamanan", "sekretaris"].includes(role) && (
          <section className="dashboard-section dashboard-section--metrics">
            <DashboardMetrics summary={summaryForView} meta={isUnitWorkspace ? { scope: "unit" } : summaryMeta} />
          </section>
        )}
      </div>
    </AppShell>
  );
}

const shortcutPanelStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "20px",
  boxShadow: "var(--shadow-card)",
};

const contextPanelStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px 12px",
  alignItems: "center",
  justifyContent: "space-between",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: "12px 14px",
  color: "var(--text-primary)",
  fontSize: "13px",
  boxShadow: "var(--shadow-card)",
};

const errorPanelStyle = {
  background: "var(--danger-subtle)",
  border: "1px solid color-mix(in srgb, var(--danger) 22%, transparent)",
  borderRadius: "var(--radius-md)",
  padding: "12px 14px",
  color: "var(--danger)",
  fontSize: "13px",
  fontWeight: 700,
};

const loadingPanelStyle = {
  background: "var(--surface-muted)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: "12px 14px",
  color: "var(--text-secondary)",
  fontSize: "13px",
  fontWeight: 700,
};

const shortcutTitleStyle = {
  margin: 0,
  fontSize: "18px",
  color: "var(--text-primary)",
};

const shortcutSubtitleStyle = {
  margin: "6px 0 16px",
  color: "var(--text-secondary)",
  fontSize: "14px",
};

const shortcutGridStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
};

const shortcutLinkStyle = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: "38px",
  padding: "8px 12px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--surface-muted)",
  color: "var(--text-primary)",
  textDecoration: "none",
  fontSize: "13px",
  fontWeight: 700,
};

const shortcutEmptyStyle = {
  color: "var(--text-secondary)",
  fontSize: "14px",
};

export default DashboardPage;
