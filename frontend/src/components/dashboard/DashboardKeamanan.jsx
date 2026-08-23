import KpiCard from "../ui/KpiCard";
import KpiGrid from "../ui/KpiGrid";
import Card from "../ui/Card";
import DashboardViolations from "./DashboardViolations";
import DashboardKesehatanHariIni from "./DashboardKesehatanHariIni";
import {
  DASHBOARD_PANEL,
  ExecSectionTitle,
  DashboardCompactList,
} from "./dashboardShared.jsx";
import { formatNumber } from "../../utils/formatCurrency";
import { formatDateShort } from "../../utils/formatDate";

function DashboardKeamanan({ summary }) {
  const perizinanAktifCount = Number(summary.belum_kembali || 0);
  const perizinanAktif = summary.recent_perizinan || [];

  const perizinanItems = perizinanAktif.map((item) => ({
    key: `izin-${item.id}`,
    title: item.nama || `Santri #${item.santri_id}`,
    subtitle: `${formatDateShort(item.tanggal)} · ${item.keterangan || item.alasan || "Perizinan aktif"}`,
    meta: "Keluar",
  }));

  return (
    <div className="dashboard-role-v3">
      <DashboardKesehatanHariIni summary={summary} />
      <KpiGrid>
        <KpiCard
          label="Santri Belum Kembali"
          value={formatNumber(summary.belum_kembali || 0)}
          accent={summary.belum_kembali > 0 ? "danger" : "primary"}
        />
        <KpiCard
          label="Perizinan Aktif"
          value={formatNumber(perizinanAktifCount || summary.belum_kembali || 0)}
          accent={(perizinanAktifCount || summary.belum_kembali) > 0 ? "warning" : "primary"}
        />
        <KpiCard
          label="Pelanggaran Bulan Ini"
          value={formatNumber(summary.total_pelanggaran || 0)}
          accent="warning"
        />
        <KpiCard
          label="Tamu Yayasan Hari Ini"
          value={formatNumber(summary.tamu_hari_ini || 0)}
          accent="info"
        />
      </KpiGrid>

      <div className="dashboard-row-full">
        <DashboardViolations
          topPelanggar={(summary.santri_poin_tertinggi || []).slice(0, 5)}
        />
      </div>

      <div className="dashboard-panel">
        <Card {...DASHBOARD_PANEL}>
          <ExecSectionTitle
            title="Perizinan Aktif"
            subtitle="Santri yang masih berada di luar pesantren"
          />
          <DashboardCompactList
            items={perizinanItems}
            emptyNote="Tidak ada perizinan aktif saat ini."
          />
        </Card>
      </div>
    </div>
  );
}

export default DashboardKeamanan;
