import Card from "../ui/Card";
import { formatCurrency, formatNumber } from "../../utils/formatCurrency";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

function Metric({ label, value, money = false }) {
  return (
    <Card padding="sm" shadow="card" radius="xl">
      <article className="dashboard-unit-v1__metric">
        <span>{label}</span>
        <strong>{money ? formatCurrency(value) : formatNumber(value)}</strong>
      </article>
    </Card>
  );
}

function ListPanel({ title, rows, empty, renderValue }) {
  return (
    <Card padding="sm" shadow="card" radius="xl">
      <article className="dashboard-unit-v1__panel">
        <h3>{title}</h3>
        {rows.length ? (
          <div className="dashboard-unit-v1__list">
            {rows.map((row, index) => (
              <div key={row.id || `${row.name}-${index}`}>
                <span><b>{index + 1}</b>{row.name}</span>
                <strong>{renderValue(row)}</strong>
              </div>
            ))}
          </div>
        ) : <p className="dashboard-unit-v1__empty">{empty}</p>}
      </article>
    </Card>
  );
}

function chartGeometry(rows = []) {
  const width = 720, height = 230, pad = { left: 58, right: 18, top: 20, bottom: 34 };
  const points = rows.filter((row) => row.closing_balance != null)
    .map((row) => ({ month: Number(row.month), value: Number(row.closing_balance) }));
  if (!points.length) return { width, height, pad, points: [], path: "", ticks: [] };
  const values = points.map((point) => point.value);
  const min = Math.min(0, ...values), max = Math.max(0, ...values), range = max - min || 1;
  const mapped = points.map((point) => ({
    ...point,
    x: pad.left + ((point.month - 1) / 11) * (width - pad.left - pad.right),
    y: pad.top + ((max - point.value) / range) * (height - pad.top - pad.bottom),
  }));
  const path = mapped.reduce((result, point, index) => {
    if (!index) return `M ${point.x} ${point.y}`;
    const previous = mapped[index - 1], mid = (previous.x + point.x) / 2;
    return `${result} C ${mid} ${previous.y}, ${mid} ${point.y}, ${point.x} ${point.y}`;
  }, "");
  const ticks = Array.from({ length: 4 }, (_, index) => ({
    y: pad.top + (index / 3) * (height - pad.top - pad.bottom),
    value: max - (index / 3) * range,
  }));
  return { width, height, pad, points: mapped, path, ticks };
}

function compactMoney(value) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", notation: "compact", maximumFractionDigits: 1 }).format(Number(value || 0));
}

function CashChart({ rows, year }) {
  const chart = chartGeometry(rows);
  return (
    <Card padding="sm" shadow="card" radius="xl">
      <article className="dashboard-unit-v1__panel">
        <h3>Saldo Buku Kas Unit</h3>
        <p className="dashboard-unit-v1__subtitle">Saldo akhir kumulatif per bulan · {year}</p>
        {chart.points.length ? (
          <div className="dashboard-unit-v1__chart">
            <svg viewBox={`0 0 ${chart.width} ${chart.height}`} preserveAspectRatio="none" role="img" aria-label={`Saldo Buku Kas Unit tahun ${year}`}>
              {chart.ticks.map((tick) => <g key={tick.y}>
                <line x1={chart.pad.left} x2={chart.width - chart.pad.right} y1={tick.y} y2={tick.y} />
                <text x={chart.pad.left - 8} y={tick.y + 4} textAnchor="end">{compactMoney(tick.value)}</text>
              </g>)}
              <path d={chart.path} />
              {chart.points.map((point) => <circle key={point.month} cx={point.x} cy={point.y} r="4">
                <title>{MONTHS[point.month - 1]}: {formatCurrency(point.value)}</title>
              </circle>)}
              {MONTHS.map((month, index) => <text key={month} x={chart.pad.left + (index / 11) * (chart.width - chart.pad.left - chart.pad.right)} y={chart.height - 9} textAnchor="middle">{month}</text>)}
            </svg>
          </div>
        ) : <p className="dashboard-unit-v1__empty">Belum ada data Buku Kas.</p>}
      </article>
    </Card>
  );
}

function SahriyahPanel({ data }) {
  const total = Number(data.total || 0);
  const paidPct = total ? Math.round((Number(data.paid || 0) / total) * 100) : 0;
  const partialPct = total ? Math.round((Number(data.partial || 0) / total) * 100) : 0;
  const unpaidPct = Math.max(0, 100 - paidPct - partialPct);
  const gradient = `conic-gradient(var(--success) 0 ${paidPct}%, var(--warning) ${paidPct}% ${paidPct + partialPct}%, var(--danger) ${paidPct + partialPct}% 100%)`;
  const rows = [["Lunas", data.paid, paidPct, "success"], ["Nyicil", data.partial, partialPct, "warning"], ["Belum Bayar", data.unpaid, unpaidPct, "danger"]];
  return (
    <Card padding="sm" shadow="card" radius="xl">
      <article className="dashboard-unit-v1__panel">
        <h3>Status Sahriyah</h3>
        <p className="dashboard-unit-v1__subtitle">Bulan berjalan · {formatNumber(total)} santri</p>
        <div className="dashboard-unit-v1__donut-layout">
          <div className="dashboard-unit-v1__donut" style={{ background: gradient }}><span><b>{paidPct}%</b>Lunas</span></div>
          <div className="dashboard-unit-v1__legend">
            {rows.map(([label, count, pct, tone]) => <div key={label}>
              <span><i className={`dashboard-unit-v1__dot dashboard-unit-v1__dot--${tone}`} />{label}</span>
              <strong>{formatNumber(count)} ({pct}%)</strong>
            </div>)}
          </div>
        </div>
      </article>
    </Card>
  );
}

export default function DashboardSpecificUnit({ data, onClassChange }) {
  const eligibility = data?.eligibility || {};
  const counts = data?.counts || {};
  const finance = data?.finance || {};
  const cards = [
    [eligibility.students, "Total Santri", counts.students],
    [eligibility.classes, "Total Kelas", counts.classes],
    [eligibility.teachers, "Total Guru", counts.teachers],
    [eligibility.health, "Santri Sakit", counts.sick],
    [eligibility.permits, "Santri Izin", counts.permits],
    [eligibility.cash, "Saldo Buku Kas", finance.cash_balance, true],
    [eligibility.cash && eligibility.wallet, "Total Keuangan", finance.total, true],
  ].filter(([visible]) => visible);
  const showAcademic = eligibility.grades || eligibility.attendance;
  return (
    <div className="dashboard-unit-v1">
      <style>{`
        .dashboard-unit-v1,.dashboard-unit-v1 *{box-sizing:border-box}.dashboard-unit-v1{display:grid;gap:10px;min-width:0;max-width:100%}
        .dashboard-unit-v1__metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;min-width:0}
        .dashboard-unit-v1__metrics>*{min-width:0;overflow:hidden}.dashboard-unit-v1__metric{min-width:0}.dashboard-unit-v1__metric span{display:block;color:var(--text-secondary);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em}
        .dashboard-unit-v1__metric strong{display:block;margin-top:6px;color:var(--text-primary);font-size:clamp(1.2rem,2.3vw,1.75rem);line-height:1.1;overflow-wrap:anywhere}
        .dashboard-unit-v1__finance,.dashboard-unit-v1__panels,.dashboard-unit-v1__academic-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;min-width:0}
        .dashboard-unit-v1__finance>*:first-child{grid-column:1/-1}.dashboard-unit-v1__finance>*,.dashboard-unit-v1__panels>*,.dashboard-unit-v1__academic-grid>*{min-width:0;overflow:hidden}
        .dashboard-unit-v1__panel{min-width:0}.dashboard-unit-v1__panel h3{margin:0;color:var(--text-primary);font-size:14px}.dashboard-unit-v1__subtitle,.dashboard-unit-v1__empty{margin:4px 0 0;color:var(--text-muted);font-size:11px;line-height:1.4}
        .dashboard-unit-v1__money{display:grid;gap:7px;margin-top:10px}.dashboard-unit-v1__money div{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;color:var(--text-secondary);font-size:12px}
        .dashboard-unit-v1__money strong{color:var(--text-primary);text-align:right;overflow-wrap:anywhere}.dashboard-unit-v1__money div:last-child{padding-top:7px;border-top:1px solid var(--border);font-weight:800}
        .dashboard-unit-v1__chart{width:100%;max-width:100%;min-width:0;margin-top:8px;overflow:hidden}.dashboard-unit-v1__chart svg{display:block;width:100%;height:220px}.dashboard-unit-v1__chart line{stroke:var(--border)}.dashboard-unit-v1__chart path{fill:none;stroke:var(--primary);stroke-width:4;stroke-linecap:round}.dashboard-unit-v1__chart circle{fill:var(--card);stroke:var(--primary);stroke-width:3}.dashboard-unit-v1__chart text{fill:var(--text-muted);font-size:10px}
        .dashboard-unit-v1__donut-layout{display:flex;align-items:center;gap:14px;margin-top:12px;min-width:0}.dashboard-unit-v1__donut{width:100px;height:100px;border-radius:50%;padding:14px;flex:0 0 auto}.dashboard-unit-v1__donut>span{display:flex;flex-direction:column;align-items:center;justify-content:center;width:100%;height:100%;border-radius:50%;background:var(--card);color:var(--text-muted);font-size:10px}.dashboard-unit-v1__donut b{color:var(--text-primary);font-size:17px}
        .dashboard-unit-v1__legend{display:grid;gap:6px;min-width:0;flex:1}.dashboard-unit-v1__legend>div,.dashboard-unit-v1__list>div{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border);font-size:11px}.dashboard-unit-v1__legend span,.dashboard-unit-v1__list span{min-width:0;color:var(--text-secondary);overflow-wrap:anywhere}.dashboard-unit-v1__legend strong,.dashboard-unit-v1__list strong{color:var(--text-primary);text-align:right}.dashboard-unit-v1__dot{display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:50%}.dashboard-unit-v1__dot--success{background:var(--success)}.dashboard-unit-v1__dot--warning{background:var(--warning)}.dashboard-unit-v1__dot--danger{background:var(--danger)}
        .dashboard-unit-v1__list{display:grid;margin-top:8px}.dashboard-unit-v1__list b{display:inline-grid;place-items:center;width:20px;height:20px;margin-right:7px;border-radius:50%;background:var(--surface-muted);color:var(--text-primary);font-size:10px}
        .dashboard-unit-v1__academic{display:grid;gap:10px;min-width:0}.dashboard-unit-v1__academic-head{display:flex;align-items:end;justify-content:space-between;gap:10px}.dashboard-unit-v1__academic-head h2{margin:0;color:var(--text-primary);font-size:14px}.dashboard-unit-v1__academic-head label{display:grid;gap:3px;color:var(--text-secondary);font-size:10px;font-weight:700}.dashboard-unit-v1__academic-head select{min-width:180px;max-width:100%;padding:8px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--surface);color:var(--text-primary)}
        @media(max-width:1023px){.dashboard-unit-v1__metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
        @media(max-width:767px){.dashboard-unit-v1__finance,.dashboard-unit-v1__panels,.dashboard-unit-v1__academic-grid{grid-template-columns:minmax(0,1fr)}.dashboard-unit-v1__academic-head{align-items:stretch;flex-direction:column}.dashboard-unit-v1__academic-head label,.dashboard-unit-v1__academic-head select{width:100%;min-width:0}}
        @media(max-width:639px){.dashboard-unit-v1__metrics{grid-template-columns:minmax(0,1fr)}.dashboard-unit-v1__donut-layout{align-items:stretch;flex-direction:column}.dashboard-unit-v1__donut{align-self:center}.dashboard-unit-v1__chart svg{height:205px}}
      `}</style>
      {cards.length ? <section className="dashboard-unit-v1__metrics">{cards.map(([, label, value, money]) => <Metric key={label} label={label} value={value} money={money} />)}</section> : null}
      {eligibility.cash || eligibility.wallet ? <section className="dashboard-unit-v1__finance">
        {eligibility.cash ? <CashChart rows={finance.monthly_closing || []} year={data.year} /> : null}
        {eligibility.cash && eligibility.wallet ? <Card padding="sm" shadow="card" radius="xl"><article className="dashboard-unit-v1__panel"><h3>Total Keuangan</h3>
          <div className="dashboard-unit-v1__money">
            <div><span>Buku Kas</span><strong>{formatCurrency(finance.cash_balance)}</strong></div>
            <div><span>Dompet Santri</span><strong>{formatCurrency(finance.wallet_balance)}</strong></div>
            <div><span>Total</span><strong>{formatCurrency(finance.total)}</strong></div>
          </div></article></Card> : null}
        {eligibility.sahriyah ? <SahriyahPanel data={data.sahriyah || {}} /> : null}
      </section> : eligibility.sahriyah ? <section className="dashboard-unit-v1__panels"><SahriyahPanel data={data.sahriyah || {}} /></section> : null}
      {eligibility.violations ? <section className="dashboard-unit-v1__panels"><ListPanel title="Top 5 Pelanggaran Bulan Ini" rows={data.violations || []} empty="Belum ada pelanggaran." renderValue={(row) => `${formatNumber(row.count)} kejadian · ${formatNumber(row.points)} poin`} /></section> : null}
      {showAcademic ? <section className="dashboard-unit-v1__academic">
        <div className="dashboard-unit-v1__academic-head"><h2>Ringkasan Akademik per Kelas</h2>
          <label><span>Kelas</span><select value={data.selected_class_id || ""} onChange={(event) => onClassChange(event.target.value)}>
            {data.classes?.length ? data.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="">Belum ada kelas</option>}
          </select></label>
        </div>
        <div className="dashboard-unit-v1__academic-grid">
          {eligibility.grades ? <ListPanel title="Top 3 Nilai Bulan Ini" rows={data.grades || []} empty="Belum ada nilai pada kelas ini." renderValue={(row) => row.score} /> : null}
          {eligibility.attendance ? <ListPanel title="Top 3 Alfa Bulan Ini" rows={data.alpha || []} empty="Belum ada Alfa pada kelas ini." renderValue={(row) => `${formatNumber(row.count)} Alfa`} /> : null}
        </div>
      </section> : null}
    </div>
  );
}
