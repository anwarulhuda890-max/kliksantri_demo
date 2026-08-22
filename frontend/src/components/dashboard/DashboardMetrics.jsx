import { FaChalkboardTeacher, FaExclamationCircle, FaUserGraduate, FaUsers, FaWallet } from "react-icons/fa";
import KpiCard from "../ui/KpiCard";
import KpiGrid from "../ui/KpiGrid";
import { formatCurrency, formatNumber } from "../../utils/formatCurrency";

function DashboardMetricsStyles() {
  return (
    <style>{`
      .dashboard-metrics-grid {
        margin-bottom: 0;
      }

      .dashboard-metrics-grid.kpi-grid-v3 {
        gap: 10px;
      }

      .dashboard-kpi-wrap .kpi-card-v3 {
        position: relative;
        border-radius: var(--radius-lg) !important;
        border: 1px solid var(--border) !important;
        background: var(--card) !important;
        box-shadow: var(--shadow-kpi) !important;
        padding: 9px 10px !important;
        min-height: 68px !important;
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        display: grid !important;
        grid-template-columns: 30px minmax(0, 1fr);
        grid-template-rows: auto auto;
        column-gap: 10px !important;
        row-gap: 2px !important;
        align-items: center !important;
        transition: box-shadow 180ms ease, transform 180ms ease;
      }

      .dashboard-kpi-wrap .kpi-card-v3:hover {
        box-shadow: var(--shadow-md) !important;
        transform: translateY(-1px);
      }

      .dashboard-kpi-wrap .kpi-card-v3__icon {
        grid-row: 1 / span 2;
        grid-column: 1;
        align-self: center;
        margin-bottom: 0 !important;
      }

      .dashboard-kpi-wrap .kpi-card-v3__value {
        grid-column: 2;
        grid-row: 1;
        font-size: clamp(1.15rem, 1.45vw, 1.45rem) !important;
        font-weight: 800 !important;
        letter-spacing: -0.03em !important;
        color: var(--text-primary) !important;
        line-height: 1.1 !important;
        overflow: visible !important;
        white-space: normal !important;
        text-overflow: unset !important;
        word-break: break-word;
      }

      .dashboard-kpi-wrap .kpi-card-v3__label {
        grid-column: 2;
        grid-row: 2;
        font-size: 10px !important;
        font-weight: 600 !important;
        color: var(--text-secondary) !important;
        letter-spacing: 0.03em !important;
        text-transform: uppercase;
        line-height: 1.25 !important;
        overflow: visible !important;
        white-space: normal !important;
        text-overflow: unset !important;
      }

      .dashboard-kpi-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        border-radius: var(--radius-sm);
        font-size: 15px;
        flex-shrink: 0;
      }

      .dashboard-kpi-icon--green {
        background: var(--success-subtle);
        color: var(--primary);
        border: 1px solid color-mix(in srgb, var(--primary) 18%, transparent);
      }

      .dashboard-kpi-icon--amber {
        background: var(--warning-subtle);
        color: var(--warning);
        border: 1px solid color-mix(in srgb, var(--warning) 22%, transparent);
      }

      .dashboard-kpi-icon--blue {
        background: var(--info-subtle);
        color: var(--info);
        border: 1px solid color-mix(in srgb, var(--info) 18%, transparent);
      }

      .dashboard-kpi-icon--red {
        background: var(--danger-subtle);
        color: var(--danger);
        border: 1px solid color-mix(in srgb, var(--danger) 18%, transparent);
      }

      @media (max-width: 767px) {
        .dashboard-kpi-wrap .kpi-card-v3 {
          min-height: 66px !important;
        }
      }
    `}</style>
  );
}

function MetricIcon({ children, tone = "green" }) {
  return (
    <span className={`dashboard-kpi-icon dashboard-kpi-icon--${tone}`}>
      {children}
    </span>
  );
}

function DashboardMetrics({ summary, meta }) {
  const isUnitScope = meta?.scope === "unit";
  const belumKembali = summary.belum_kembali || 0;
  const tunggakan = summary.total_tunggakan;

  return (
    <>
      <DashboardMetricsStyles />
      <KpiGrid className="dashboard-metrics-grid">
        <div className="dashboard-kpi-wrap dashboard-kpi-wrap--santri">
          <KpiCard
            icon={<MetricIcon tone="green"><FaUsers /></MetricIcon>}
            label={isUnitScope ? "Santri Unit Aktif" : "Total Santri"}
            value={formatNumber(summary.total_santri)}
            accent="primary"
          />
        </div>
        {isUnitScope ? (
          <div className="dashboard-kpi-wrap dashboard-kpi-wrap--kelas">
            <KpiCard
              icon={<MetricIcon tone="blue"><FaChalkboardTeacher /></MetricIcon>}
              label="Kelas Unit"
              value={formatNumber(summary.total_kelas || 0)}
              accent="info"
            />
          </div>
        ) : null}
        {!isUnitScope ? (
          <>
        <div className="dashboard-kpi-wrap dashboard-kpi-wrap--kelas">
          <KpiCard
            icon={<MetricIcon tone="blue"><FaChalkboardTeacher /></MetricIcon>}
            label="Total Kelas"
            value={formatNumber(summary.total_kelas || 0)}
            accent="info"
          />
        </div>
        <div className="dashboard-kpi-wrap dashboard-kpi-wrap--alumni">
          <KpiCard
            icon={<MetricIcon tone="blue"><FaUserGraduate /></MetricIcon>}
            label="Total Alumni"
            value={formatNumber(summary.total_alumni || 0)}
            accent="info"
          />
        </div>
        <div className="dashboard-kpi-wrap dashboard-kpi-wrap--kembali">
          <KpiCard
            icon={<MetricIcon tone="amber"><FaExclamationCircle /></MetricIcon>}
            label="Santri Belum Kembali"
            value={formatNumber(belumKembali)}
            accent={belumKembali > 0 ? "danger" : "primary"}
          />
        </div>
        <div className="dashboard-kpi-wrap dashboard-kpi-wrap--kas">
          <KpiCard
            icon={<MetricIcon tone="blue"><FaWallet /></MetricIcon>}
            label="Saldo Buku Kas"
            value={formatCurrency(summary.saldo_kas)}
            accent="success"
          />
        </div>
        <div className="dashboard-kpi-wrap dashboard-kpi-wrap--tunggakan">
          <KpiCard
            icon={<MetricIcon tone="red"><FaExclamationCircle /></MetricIcon>}
            label="Total Tunggakan"
            value={formatCurrency(tunggakan)}
            accent={tunggakan > 0 ? "danger" : "primary"}
          />
        </div>
          </>
        ) : null}
      </KpiGrid>
    </>
  );
}

export default DashboardMetrics;
