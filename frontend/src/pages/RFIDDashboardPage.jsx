import { useEffect, useMemo, useState } from "react";
import AppShell from "../layouts/AppShell";
import api from "../services/api";
import KpiCard from "../components/ui/KpiCard";
import KpiGrid from "../components/ui/KpiGrid";
import Card from "../components/ui/Card";
import { DashboardResponsiveStyles } from "../components/dashboard/DashboardResponsiveStyles";
import {
  DASHBOARD_PANEL,
  ExecSectionTitle,
  DashboardCompactList,
} from "../components/dashboard/dashboardShared.jsx";
import { formatCurrency, formatNumber } from "../utils/formatCurrency";
import { useActiveUnit } from "../context/ActiveUnitContext";
import { buildUnitScopeParams } from "../utils/unitScopeParams";

function trxTypeLabel(trxType) {
  if (trxType === "payment") return "Pembayaran";
  if (trxType === "topup") return "Topup";
  if (trxType === "refund") return "Refund";
  return String(trxType || "Transaksi");
}

function RFIDDashboardPage() {
  const { activeUnitId, allUnitsAllowed } = useActiveUnit();
  const scopeParams = useMemo(
    () => buildUnitScopeParams({ activeUnitId, allUnitsAllowed }),
    [activeUnitId, allUnitsAllowed],
  );
  const [dashboard, setDashboard] = useState({});
  const [summary, setSummary] = useState({});

  const loadData = async () => {
    try {
      const [dashRes, summaryRes] = await Promise.all([
        api.get("/rfid/dashboard", { params: scopeParams }),
        api.get("/rfid/dashboard-summary", { params: scopeParams }),
      ]);
      setDashboard(dashRes.data || {});
      setSummary(summaryRes.data?.data || {});
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, [scopeParams]);

  const recentActivity = useMemo(
    () => (summary.recent_activity || []).map((item) => ({
      key: `rfid-${item.id}`,
      title: item.nama_santri || `Santri #${item.santri_id}`,
      subtitle: `${trxTypeLabel(item.trx_type)} · ${item.nama_merchant || "—"}`,
      meta: formatCurrency(item.nominal),
    })),
    [summary.recent_activity],
  );

  const syncQueue = (Number(summary.pending_sync) || 0) + (Number(dashboard.failed_sync) || 0);
  const topMerchant = summary.top_merchant;

  return (
    <AppShell
      title="Dashboard Dompet"
      description="Ringkasan saldo dan aktivitas Dompet Santri"
      breadcrumb="Keuangan / Dompet Santri / Dashboard"
    >
      <DashboardResponsiveStyles />
      <div className="dashboard-role-v3">
        <KpiGrid>
          <KpiCard
            label="Total Saldo Dompet"
            value={formatCurrency(dashboard.total_saldo || 0)}
            accent="primary"
          />
          <KpiCard
            label="Total Belanja"
            value={formatCurrency(dashboard.belanja_hari_ini || summary.nominal_hari_ini || 0)}
            accent="info"
          />
          <KpiCard
            label="Merchant Aktif"
            value={formatNumber(dashboard.merchant_aktif || 0)}
            accent="success"
          />
          <KpiCard
            label="Device Online"
            value={formatNumber(summary.device_online ?? dashboard.device_online ?? 0)}
            accent={(summary.device_offline ?? dashboard.device_offline ?? 0) > 0 ? "warning" : "success"}
          />
        </KpiGrid>

        <div className="dashboard-monitor-grid dashboard-monitor-grid--rfid">
          <Card {...DASHBOARD_PANEL}>
            <ExecSectionTitle title="Sinkronisasi Hari Ini" subtitle="Antrian sync perangkat RFID" />
            <div className="dashboard-monitor-stat">
              <span className="dashboard-monitor-stat__value">{formatNumber(syncQueue)}</span>
              <span className="dashboard-monitor-stat__label">Antrian sync</span>
            </div>
            <p className="dashboard-monitor-meta">
              {formatNumber(summary.pending_sync || dashboard.pending_sync || 0)} pending ·{" "}
              {formatNumber(dashboard.failed_sync || 0)} gagal
            </p>
          </Card>

          <Card {...DASHBOARD_PANEL}>
            <ExecSectionTitle title="Transaksi Hari Ini" subtitle="Volume transaksi dompet hari ini" />
            <div className="dashboard-monitor-stat">
              <span className="dashboard-monitor-stat__value">
                {formatNumber(summary.transaksi_hari_ini || 0)}
              </span>
              <span className="dashboard-monitor-stat__label">Transaksi</span>
            </div>
            <p className="dashboard-monitor-meta">
              Total {formatCurrency(summary.nominal_hari_ini || dashboard.belanja_hari_ini || 0)}
            </p>
          </Card>

          <Card {...DASHBOARD_PANEL}>
            <ExecSectionTitle title="Refund Hari Ini" subtitle="Pengembalian saldo transaksi RFID" />
            <div className="dashboard-monitor-stat">
              <span className="dashboard-monitor-stat__value">
                {formatNumber(summary.refund_hari_ini || 0)}
              </span>
              <span className="dashboard-monitor-stat__label">Refund</span>
            </div>
            <p className="dashboard-monitor-meta">
              Topup hari ini: {formatNumber(summary.topup_hari_ini || 0)}
            </p>
          </Card>

          <Card {...DASHBOARD_PANEL}>
            <ExecSectionTitle title="Top Merchant" subtitle="Merchant paling aktif (30 hari)" />
            <div className="dashboard-monitor-stat">
              <span className="dashboard-monitor-stat__value dashboard-monitor-stat__value--text">
                {topMerchant?.name || "—"}
              </span>
              <span className="dashboard-monitor-stat__label">Merchant teratas</span>
            </div>
            <p className="dashboard-monitor-meta">
              {topMerchant
                ? `${formatNumber(topMerchant.count)} transaksi tercatat`
                : "Belum ada transaksi merchant."}
            </p>
          </Card>
        </div>

        <div className="dashboard-panel">
          <Card {...DASHBOARD_PANEL}>
            <ExecSectionTitle
              title="Aktivitas Dompet Terbaru"
              subtitle="5 transaksi dompet terakhir"
            />
            <DashboardCompactList
              items={recentActivity}
              emptyNote="Belum ada aktivitas dompet tercatat."
            />
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

export default RFIDDashboardPage;
