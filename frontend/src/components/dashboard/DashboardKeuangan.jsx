import KpiCard from "../ui/KpiCard";
import KpiGrid from "../ui/KpiGrid";
import Card from "../ui/Card";
import DashboardAnnouncement from "./DashboardAnnouncement";
import {
  DASHBOARD_PANEL,
  ExecSectionTitle,
  DashboardCompactList,
} from "./dashboardShared.jsx";
import { formatCurrency, formatNumber } from "../../utils/formatCurrency";
import { formatDateShort } from "../../utils/formatDate";

function DashboardKeuangan({ summary }) {
  const transaksiTerbaru = summary?.transaksi_terbaru || [];
  const pembayaranTerbaru = summary?.pembayaran_terbaru || [];
  const pembayaranHariIni = Number(summary?.pembayaran_hari_ini || 0);
  const tagihanBelumLunas = Number(summary?.tagihan_belum_lunas || 0);

  const recentTransactions = transaksiTerbaru.slice(0, 5).map((item) => ({
    key: `trx-${item.id}`,
    title: item.keterangan || item.kategori || "Transaksi",
    subtitle: `${formatDateShort(item.tanggal)} · ${item.jenis || "—"} · ${item.kategori || "—"}`,
    meta: formatCurrency(item.nominal),
  }));

  return (
    <div className="dashboard-role-v3">
      <KpiGrid>
        <KpiCard
          label="Saldo Buku Kas"
          value={formatCurrency(summary.saldo_kas || 0)}
          accent="primary"
        />
        <KpiCard
          label="Total Tunggakan"
          value={formatCurrency(summary.total_tunggakan || 0)}
          accent={summary.total_tunggakan > 0 ? "danger" : "primary"}
        />
        <KpiCard
          label="Pembayaran Hari Ini"
          value={formatCurrency(pembayaranHariIni)}
          accent={pembayaranHariIni > 0 ? "success" : "neutral"}
        />
        <KpiCard
          label="Tagihan Belum Lunas"
          value={formatNumber(tagihanBelumLunas)}
          accent={tagihanBelumLunas > 0 ? "warning" : "primary"}
        />
      </KpiGrid>

      <div className="dashboard-row-full">
        <DashboardAnnouncement
          pembayaranTerbaru={pembayaranTerbaru}
          totalPembayaran={summary.total_pembayaran}
          totalTunggakan={summary.total_tunggakan}
        />
      </div>

      <div className="dashboard-panel">
        <Card {...DASHBOARD_PANEL}>
          <ExecSectionTitle
            title="Transaksi Terbaru"
            subtitle="5 transaksi buku kas terakhir"
          />
          <DashboardCompactList
            items={recentTransactions}
            emptyNote="Belum ada transaksi tercatat."
          />
        </Card>
      </div>
    </div>
  );
}

export default DashboardKeuangan;
