import KpiCard from "../ui/KpiCard";
import KpiGrid from "../ui/KpiGrid";
import Card from "../ui/Card";
import StatusBadge from "../ui/StatusBadge";
import { DASHBOARD_PANEL, ExecSectionTitle } from "./dashboardShared.jsx";
import { formatNumber } from "../../utils/formatCurrency";
import { formatDateShort } from "../../utils/formatDate";

function DashboardSekretaris({ summary }) {
  const pengumumanAktif = Number(summary.pengumuman_aktif || 0);
  const recentPengumuman = summary.pengumuman_terbaru || [];

  return (
    <div className="dashboard-role-v3">
      <KpiGrid>
        <KpiCard
          label="Total Pengumuman"
          value={formatNumber(summary.total_pengumuman || 0)}
          accent="primary"
        />
        <KpiCard
          label="Pengumuman Aktif"
          value={formatNumber(pengumumanAktif)}
          accent={pengumumanAktif > 0 ? "success" : "neutral"}
        />
        <KpiCard
          label="Total Santri"
          value={formatNumber(summary.total_santri || 0)}
          accent="info"
        />
        <KpiCard
          label="Total Wali"
          value={formatNumber(summary.total_wali || 0)}
          accent="primary"
        />
      </KpiGrid>

      <div className="dashboard-panel">
        <Card {...DASHBOARD_PANEL}>
          <ExecSectionTitle
            title="Pengumuman Terbaru"
            subtitle="5 pengumuman terakhir dipublikasikan"
          />
          {recentPengumuman.length === 0 ? (
            <p className="dashboard-empty-note">Belum ada pengumuman.</p>
          ) : (
            <div className="dashboard-violations-list">
              {recentPengumuman.map((item, index, arr) => (
                <div
                  key={item.id}
                  className={`dashboard-violation-row${index < arr.length - 1 ? " dashboard-violation-row--bordered" : ""}`}
                >
                  <div className="dashboard-compact-list-main">
                    <span className="dashboard-pelanggar-name">{item.judul}</span>
                    <span className="dashboard-compact-list-sub">
                      {formatDateShort(item.published_at || item.created_at)}
                      {item.prioritas ? ` · ${item.prioritas}` : ""}
                    </span>
                  </div>
                  <span className="dashboard-feed-badge">
                    <StatusBadge status={item.is_active ? "Aktif" : "Nonaktif"} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

export default DashboardSekretaris;
