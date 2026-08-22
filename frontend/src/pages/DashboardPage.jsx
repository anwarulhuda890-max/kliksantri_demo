import { useEffect, useState } from "react";
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
import { getUser } from "../utils/storage";
import { hasPermission } from "../utils/hasPermission";
import { useActiveUnit } from "../context/ActiveUnitContext";

const DEFAULT_SHORTCUTS = [
  { permission: "absensi.view", label: "Absensi Santri", path: "/absensi" },
  { permission: "program_unit.view", label: "Program Unit", path: "/program-unit" },
  { permission: "kas_instansi.view", label: "Kas Unit", path: "/kas-instansi" },
  { permission: "pembayaran.view", label: "Pembayaran", path: "/pembayaran" },
  { permission: "santri.view", label: "Data Santri", path: "/santri" },
  { permission: "pengumuman.view", label: "Pengumuman", path: "/pengumuman" },
];

function DashboardPage() {
  const user = getUser();
  const {
    activeUnitId,
    activeUnit,
    allUnitsAllowed,
    loading: unitLoading,
    error: unitError,
  } = useActiveUnit();
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState("");
  const [summaryReady, setSummaryReady] = useState(false);

  const [summary, setSummary] = useState({
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
  });

  const pembayaranTerbaru = summary?.pembayaran_terbaru || [];
  const role = user?.role || "";
  const canViewDashboardData = hasPermission("dashboard.view");
  const shortcuts = DEFAULT_SHORTCUTS.filter((item) => hasPermission(item.permission));

  const grafikKas = (summary?.grafik_kas || []).map((item) => ({
    bulan: ["", "Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"][
      Number(item.bulan)
    ],
    masuk: Number(item.masuk),
    keluar: Number(item.keluar),
  }));

  const workspaceReady = !unitLoading && !unitError && (allUnitsAllowed || Boolean(activeUnitId));
  const workspaceUnavailable = !unitLoading && !unitError && !allUnitsAllowed && !activeUnitId;
  const dashboardReady = canViewDashboardData && workspaceReady && summaryReady && !summaryError;

  useEffect(() => {
    if (!canViewDashboardData || !workspaceReady) return undefined;
    let cancelled = false;

    async function loadSummary() {
      setSummaryLoading(true);
      setSummaryError("");
      setSummaryReady(false);
      try {
        const params = activeUnitId ? { unit_id: activeUnitId } : { scope: "all" };
        const response = await api.get("/dashboard/summary", { params });
        if (!cancelled) {
          setSummary(response.data.data);
          setSummaryReady(true);
        }
      } catch (err) {
        if (!cancelled) {
          setSummaryError(err.response?.data?.error || "Dashboard workspace belum dapat dimuat");
        }
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    }

    loadSummary();
    return () => { cancelled = true; };
  }, [activeUnitId, canViewDashboardData, workspaceReady]);

  return (
    <AppShell title="Dashboard" breadcrumb="Dashboard">
      <DashboardResponsiveStyles />
      <div className="dashboard-page dashboard-monitoring-v3">
        <section className="dashboard-section dashboard-section--hero">
          <DashboardHero />
        </section>

        {canViewDashboardData && workspaceReady ? (
          <section className="dashboard-section">
            <div style={workspacePanelStyle}>
              Workspace aktif: {activeUnit?.nama || "Semua Unit"}
            </div>
          </section>
        ) : null}

        {canViewDashboardData && (unitError || workspaceUnavailable || summaryError) ? (
          <section className="dashboard-section">
            <div style={unavailablePanelStyle}>
              <strong>Dashboard tidak tersedia.</strong>
              <span>{unitError || summaryError || "Ruang kerja unit belum dapat dimuat"}</span>
            </div>
          </section>
        ) : null}

        {canViewDashboardData && (unitLoading || summaryLoading) ? (
          <section className="dashboard-section">
            <div style={loadingPanelStyle}>Memuat ruang kerja unit...</div>
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

        {dashboardReady && role === "superadmin" && (
          <>
          <section className="dashboard-section dashboard-section--metrics">
            <DashboardMetrics summary={summary} />
          </section>

          <section className="dashboard-section dashboard-section--panels">
            <div className="dashboard-row-3">
              <DashboardKesehatanHariIni summary={summary} />
              <DashboardAnnouncement
                pembayaranTerbaru={pembayaranTerbaru}
                sahriyahStatus={summary.sahriyah_status}
                totalPembayaran={summary.total_pembayaran}
                totalTunggakan={summary.total_tunggakan}
              />
              <DashboardViolations
                topPelanggar={(summary.santri_poin_tertinggi || []).slice(0, 5)}
              />
            </div>
          </section>

          <section className="dashboard-section dashboard-section--chart">
            <DashboardFinanceChart grafikKas={grafikKas} />
          </section>
          </>
        )}

        {dashboardReady && role === "keuangan" && <DashboardKeuangan summary={summary} />}

        {dashboardReady && role === "pendidikan" && <DashboardPendidikan summary={summary} />}

        {dashboardReady && role === "keamanan" && <DashboardKeamanan summary={summary} />}

        {dashboardReady && role === "sekretaris" && <DashboardSekretaris summary={summary} />}

        {dashboardReady && !["superadmin", "keuangan", "pendidikan", "keamanan", "sekretaris"].includes(role) && (
          <section className="dashboard-section dashboard-section--metrics">
            <DashboardMetrics summary={summary} />
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

const workspacePanelStyle = {
  padding: "12px 16px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text-primary)",
  fontWeight: 700,
};

const unavailablePanelStyle = {
  display: "grid",
  gap: "6px",
  padding: "18px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--danger, #dc2626)",
  background: "var(--surface)",
  color: "var(--text-primary)",
};

const loadingPanelStyle = {
  padding: "18px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text-secondary)",
};

export default DashboardPage;
