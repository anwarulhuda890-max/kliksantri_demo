import Card from "../ui/Card";
import { formatCurrency, formatNumber } from "../../utils/formatCurrency";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function BreakdownRows({ rows, valueKey = "count", currency = false }) {
  const renderRow = (row) => (
    <div className="dashboard-all-v1__breakdown-row" key={row.unit_id}>
      <span>{row.unit_name}</span>
      <strong>{currency ? formatCurrency(row[valueKey]) : formatNumber(row[valueKey])}</strong>
    </div>
  );
  const visible = rows.slice(0, 5);
  const hidden = rows.slice(5);

  return (
    <div className="dashboard-all-v1__breakdown">
      {visible.map(renderRow)}
      {hidden.length > 0 ? (
        <details className="dashboard-all-v1__details">
          <summary>Lihat semua ({rows.length} unit)</summary>
          <div className="dashboard-all-v1__details-list">{hidden.map(renderRow)}</div>
        </details>
      ) : null}
    </div>
  );
}

function DatabaseCard({ title, value, rows, note }) {
  return (
    <Card padding="sm" shadow="card" radius="xl">
      <article className="dashboard-all-v1__kpi-card">
        <p className="dashboard-all-v1__eyebrow">{title}</p>
        <strong className="dashboard-all-v1__value">{formatNumber(value)}</strong>
        <p className="dashboard-all-v1__note">{note}</p>
        <BreakdownRows rows={rows} />
      </article>
    </Card>
  );
}

function compactCurrency(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value || 0));
}

function buildChart(monthly = []) {
  const width = 720;
  const height = 238;
  const pad = { left: 58, right: 18, top: 22, bottom: 36 };
  const points = monthly
    .filter((item) => item.closing_balance != null)
    .map((item) => ({ month: Number(item.month), value: Number(item.closing_balance) }));
  if (points.length === 0) return { width, height, points: [], path: "", ticks: [] };

  const values = points.map((point) => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const range = max - min || 1;
  const chartWidth = width - pad.left - pad.right;
  const chartHeight = height - pad.top - pad.bottom;
  const mapped = points.map((point) => ({
    ...point,
    x: pad.left + ((point.month - 1) / 11) * chartWidth,
    y: pad.top + ((max - point.value) / range) * chartHeight,
  }));
  const path = mapped.reduce((result, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = mapped[index - 1];
    const mid = (previous.x + point.x) / 2;
    return `${result} C ${mid} ${previous.y}, ${mid} ${point.y}, ${point.x} ${point.y}`;
  }, "");
  const ticks = Array.from({ length: 4 }, (_, index) => {
    const ratio = index / 3;
    return {
      y: pad.top + ratio * chartHeight,
      value: max - ratio * range,
    };
  });
  return { width, height, points: mapped, path, ticks, pad };
}

function CashClosingChart({ rows, year, onYearChange }) {
  const chart = buildChart(rows);
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, index) => currentYear - index);

  return (
    <Card padding="sm" shadow="card" radius="xl">
      <article className="dashboard-all-v1__chart-card">
        <div className="dashboard-all-v1__chart-heading">
          <div>
            <p className="dashboard-all-v1__eyebrow">SALDO BUKU KAS SEMUA UNIT</p>
            <h3>Saldo akhir gabungan per bulan</h3>
          </div>
          <label>
            <span>Tahun</span>
            <select value={year} onChange={(event) => onYearChange(Number(event.target.value))}>
              {years.map((item) => <option value={item} key={item}>{item}</option>)}
            </select>
          </label>
        </div>
        {chart.points.length > 0 ? (
          <div className="dashboard-all-v1__chart-wrap">
            <svg
              viewBox={`0 0 ${chart.width} ${chart.height}`}
              role="img"
              aria-label={`Saldo Buku Kas Semua Unit tahun ${year}`}
              preserveAspectRatio="none"
            >
              {chart.ticks.map((tick) => (
                <g key={tick.y}>
                  <line className="dashboard-all-v1__grid-line" x1={chart.pad.left} x2={chart.width - chart.pad.right} y1={tick.y} y2={tick.y} />
                  <text className="dashboard-all-v1__axis-text" x={chart.pad.left - 8} y={tick.y + 4} textAnchor="end">
                    {compactCurrency(tick.value)}
                  </text>
                </g>
              ))}
              <path className="dashboard-all-v1__line" d={chart.path} />
              {chart.points.map((point) => (
                <g key={point.month}>
                  <circle className="dashboard-all-v1__dot" cx={point.x} cy={point.y} r="4">
                    <title>{MONTH_LABELS[point.month - 1]}: {formatCurrency(point.value)}</title>
                  </circle>
                </g>
              ))}
              {MONTH_LABELS.map((label, index) => (
                <text
                  className="dashboard-all-v1__axis-text"
                  key={label}
                  x={chart.pad.left + (index / 11) * (chart.width - chart.pad.left - chart.pad.right)}
                  y={chart.height - 10}
                  textAnchor="middle"
                >
                  {label}
                </text>
              ))}
            </svg>
          </div>
        ) : (
          <p className="dashboard-all-v1__empty">Belum ada saldo penutupan pada tahun ini.</p>
        )}
        <p className="dashboard-all-v1__chart-caption">
          Bulan setelah bulan berjalan dibiarkan kosong. Nilai setiap bulan adalah saldo kumulatif seluruh unit aktif pada akhir bulan.
        </p>
      </article>
    </Card>
  );
}

function ManagedUnitRows({ rows }) {
  const renderRow = (row) => (
    <div className="dashboard-all-v1__managed-row" key={row.unit_id}>
      <strong>{row.unit_name}</strong>
      <dl>
        <div><dt>Buku Kas</dt><dd>{formatCurrency(row.cash_balance)}</dd></div>
        <div>
          <dt>Dompet</dt>
          <dd>{row.wallet_enabled ? formatCurrency(row.wallet_balance) : <span className="dashboard-all-v1__inactive">Tidak Aktif</span>}</dd>
        </div>
        <div className="dashboard-all-v1__managed-total"><dt>Total</dt><dd>{formatCurrency(row.total)}</dd></div>
      </dl>
    </div>
  );
  const visible = rows.slice(0, 4);
  const hidden = rows.slice(4);
  return (
    <div className="dashboard-all-v1__managed-list">
      {visible.map(renderRow)}
      {hidden.length > 0 ? (
        <details className="dashboard-all-v1__details">
          <summary>Lihat semua ({rows.length} unit)</summary>
          <div className="dashboard-all-v1__details-list">{hidden.map(renderRow)}</div>
        </details>
      ) : null}
    </div>
  );
}

function DashboardAllUnitsV1({ data, year, onYearChange }) {
  const database = data?.database || {};
  const finance = data?.finance || {};
  const cash = finance.cash || { total_balance: 0, by_unit: [], monthly_closing: [] };
  const managed = finance.managed || { total: 0, cash_total: 0, wallet_total: 0, by_unit: [] };

  return (
    <div className="dashboard-all-v1">
      <style>{`
        .dashboard-all-v1, .dashboard-all-v1 * { box-sizing: border-box; }
        .dashboard-all-v1 { display: grid; gap: 14px; min-width: 0; max-width: 100%; }
        .dashboard-all-v1__section { display: grid; gap: 10px; min-width: 0; }
        .dashboard-all-v1__section-title { margin: 0; color: var(--text-primary); font-size: 14px; font-weight: 800; letter-spacing: .06em; }
        .dashboard-all-v1__database-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; min-width: 0; }
        .dashboard-all-v1__database-grid > *, .dashboard-all-v1__finance-grid > * { min-width: 0; max-width: 100%; overflow: hidden; }
        .dashboard-all-v1__finance-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; min-width: 0; }
        .dashboard-all-v1__finance-grid--chart { grid-template-columns: minmax(0, 1fr); }
        .dashboard-all-v1__kpi-card, .dashboard-all-v1__finance-card, .dashboard-all-v1__chart-card { min-width: 0; max-width: 100%; }
        .dashboard-all-v1__eyebrow { margin: 0; color: var(--text-secondary); font-size: 10px; font-weight: 800; letter-spacing: .06em; }
        .dashboard-all-v1__value { display: block; margin-top: 5px; color: var(--text-primary); font-size: clamp(1.7rem, 4vw, 2.35rem); line-height: 1.05; overflow-wrap: anywhere; }
        .dashboard-all-v1__value--money { font-size: clamp(1.35rem, 3vw, 2rem); }
        .dashboard-all-v1__note { margin: 5px 0 10px; min-height: 30px; color: var(--text-muted); font-size: 11px; line-height: 1.4; }
        .dashboard-all-v1__breakdown { display: grid; gap: 0; border-top: 1px solid var(--border); }
        .dashboard-all-v1__breakdown-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; padding: 7px 0; border-bottom: 1px solid var(--border); color: var(--text-secondary); font-size: 12px; }
        .dashboard-all-v1__breakdown-row span { min-width: 0; overflow-wrap: anywhere; }
        .dashboard-all-v1__breakdown-row strong { color: var(--text-primary); text-align: right; }
        .dashboard-all-v1__details summary { cursor: pointer; padding: 8px 0; color: var(--primary); font-size: 12px; font-weight: 700; }
        .dashboard-all-v1__details-list { display: grid; min-width: 0; }
        .dashboard-all-v1__formula { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; margin: 10px 0 0; padding: 10px; border-radius: var(--radius-md); background: var(--surface-muted); color: var(--text-secondary); font-size: 12px; }
        .dashboard-all-v1__formula strong { color: var(--text-primary); text-align: right; }
        .dashboard-all-v1__chart-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
        .dashboard-all-v1__chart-heading h3 { margin: 4px 0 0; color: var(--text-primary); font-size: 16px; }
        .dashboard-all-v1__chart-heading label { display: grid; gap: 3px; flex: 0 0 auto; color: var(--text-secondary); font-size: 10px; font-weight: 700; }
        .dashboard-all-v1__chart-heading select { max-width: 100%; min-width: 90px; padding: 7px 9px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface); color: var(--text-primary); }
        .dashboard-all-v1__chart-wrap { width: 100%; max-width: 100%; min-width: 0; margin-top: 12px; overflow: hidden; }
        .dashboard-all-v1__chart-wrap svg { display: block; width: 100%; height: 250px; max-width: 100%; overflow: visible; }
        .dashboard-all-v1__grid-line { stroke: var(--border); stroke-width: 1; }
        .dashboard-all-v1__line { fill: none; stroke: var(--primary); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
        .dashboard-all-v1__dot { fill: var(--card); stroke: var(--primary); stroke-width: 3; }
        .dashboard-all-v1__axis-text { fill: var(--text-muted); font-size: 10px; }
        .dashboard-all-v1__chart-caption, .dashboard-all-v1__empty { margin: 8px 0 0; color: var(--text-muted); font-size: 11px; line-height: 1.45; }
        .dashboard-all-v1__managed-list { display: grid; gap: 8px; margin-top: 12px; }
        .dashboard-all-v1__managed-row { min-width: 0; padding: 10px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--surface-muted); }
        .dashboard-all-v1__managed-row > strong { display: block; overflow-wrap: anywhere; color: var(--text-primary); font-size: 13px; }
        .dashboard-all-v1__managed-row dl { display: grid; gap: 4px; margin: 8px 0 0; }
        .dashboard-all-v1__managed-row dl div { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; color: var(--text-secondary); font-size: 11px; }
        .dashboard-all-v1__managed-row dt, .dashboard-all-v1__managed-row dd { margin: 0; min-width: 0; }
        .dashboard-all-v1__managed-row dd { text-align: right; color: var(--text-primary); overflow-wrap: anywhere; }
        .dashboard-all-v1__managed-total { padding-top: 5px; border-top: 1px solid var(--border); font-weight: 800; }
        .dashboard-all-v1__inactive { color: var(--text-muted); font-style: italic; }
        @media (min-width: 640px) and (max-width: 1023px) {
          .dashboard-all-v1__database-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
          .dashboard-all-v1__database-grid > :last-child { grid-column: 1 / -1; }
        }
        @media (max-width: 767px) {
          .dashboard-all-v1__finance-grid { grid-template-columns: minmax(0, 1fr); }
        }
        @media (max-width: 639px) {
          .dashboard-all-v1__database-grid { grid-template-columns: minmax(0, 1fr); }
          .dashboard-all-v1__database-grid > :last-child { grid-column: auto; }
          .dashboard-all-v1__chart-heading { align-items: stretch; flex-direction: column; }
          .dashboard-all-v1__chart-heading label { width: 100%; }
          .dashboard-all-v1__chart-heading select { width: 100%; }
          .dashboard-all-v1__chart-wrap svg { height: 220px; }
        }
      `}</style>

      <section className="dashboard-all-v1__section" aria-labelledby="dashboard-all-database">
        <h2 className="dashboard-all-v1__section-title" id="dashboard-all-database">DATA BASE</h2>
        <div className="dashboard-all-v1__database-grid">
          <DatabaseCard
            title="TOTAL SANTRI"
            value={database.students?.unique_total}
            rows={database.students?.by_unit || []}
            note="Identitas santri unik dengan minimal satu membership aktif."
          />
          <DatabaseCard
            title="TOTAL KELAS"
            value={database.classes?.total}
            rows={database.classes?.by_unit || []}
            note="Kelas unit-owned; total sama dengan jumlah breakdown."
          />
          <DatabaseCard
            title="TOTAL GURU"
            value={database.teachers?.unique_total}
            rows={database.teachers?.by_unit || []}
            note="Identitas guru unik; guru lintas unit dihitung satu kali."
          />
        </div>
      </section>

      <section className="dashboard-all-v1__section" aria-labelledby="dashboard-all-finance">
        <h2 className="dashboard-all-v1__section-title" id="dashboard-all-finance">KEUANGAN</h2>
        <div className="dashboard-all-v1__finance-grid">
          <Card padding="sm" shadow="card" radius="xl">
            <article className="dashboard-all-v1__finance-card">
              <p className="dashboard-all-v1__eyebrow">TOTAL SALDO BUKU KAS SEMUA UNIT</p>
              <strong className="dashboard-all-v1__value dashboard-all-v1__value--money">{formatCurrency(cash.total_balance)}</strong>
              <p className="dashboard-all-v1__note">Saldo berjalan kumulatif: seluruh Masuk dikurangi seluruh Keluar.</p>
              <BreakdownRows rows={cash.by_unit || []} valueKey="balance" currency />
            </article>
          </Card>

          <Card padding="sm" shadow="card" radius="xl">
            <article className="dashboard-all-v1__finance-card">
              <p className="dashboard-all-v1__eyebrow">TOTAL KEUANGAN</p>
              <strong className="dashboard-all-v1__value dashboard-all-v1__value--money">{formatCurrency(managed.total)}</strong>
              <div className="dashboard-all-v1__formula">
                <span>Buku Kas</span><strong>{formatCurrency(managed.cash_total)}</strong>
                <span>Dompet Santri</span><strong>{formatCurrency(managed.wallet_total)}</strong>
                <span>Total</span><strong>{formatCurrency(managed.total)}</strong>
              </div>
              <ManagedUnitRows rows={managed.by_unit || []} />
            </article>
          </Card>
        </div>
        <div className="dashboard-all-v1__finance-grid dashboard-all-v1__finance-grid--chart">
          <CashClosingChart rows={cash.monthly_closing || []} year={year} onYearChange={onYearChange} />
        </div>
      </section>
    </div>
  );
}

export default DashboardAllUnitsV1;
