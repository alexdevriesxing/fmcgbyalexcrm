const modules = [
  { key: 'inventory', short: 'IW', label: 'Inventory & WMS', description: 'Lots, expiry, FEFO, movements and warehouse control', status: 'Live', metric: '8,740 units' },
  { key: 'master-data', short: 'MD', label: 'Master Data', description: 'Products, SKUs, packs, parties and operating locations', status: 'Live', metric: '6 SKUs' },
  { key: 'sales', short: 'SO', label: 'Sales & Orders', description: 'Pricing, quotations, orders, allocation and delivery', status: 'Foundation', metric: '€2.84M' },
  { key: 'crm', short: 'CR', label: 'CRM', description: 'Accounts, contacts, activities, pipeline and follow-up', status: 'Foundation', metric: '1,284 outlets' },
  { key: 'finance', short: 'FI', label: 'Finance', description: 'Accounting, invoicing, receivables, payables and cash', status: 'Planned', metric: '€73K open' },
  { key: 'procurement', short: 'PO', label: 'Procurement', description: 'Suppliers, purchase orders, inbound and landed cost', status: 'Planned', metric: '18 inbound' },
  { key: 'field', short: 'FE', label: 'Field Execution', description: 'Visits, merchandising, proof and route execution', status: 'Planned', metric: '83% coverage' },
  { key: 'analytics', short: 'AI', label: 'Planning & Analytics', description: 'Forecasts, scenarios, S&OP and alerts', status: 'Planned', metric: '7 alerts' }
];

const alerts = [
  { severity: 'critical', title: '480 units expire within 8 days', detail: 'Island Coconut Water · Rotterdam Import', action: 'Review FEFO' },
  { severity: 'warning', title: '240 units remain in quarantine', detail: 'Botanical Sparkling · QA-00631', action: 'Open quality case' },
  { severity: 'warning', title: '7 orders blocked by credit control', detail: '€28,420 requested shipment value', action: 'Review accounts' },
  { severity: 'info', title: '18 purchase orders due this week', detail: 'Four suppliers · two import containers', action: 'Open inbound plan' }
];

export function ControlTower() {
  return (
    <section className="workspace-stack" aria-labelledby="control-tower-title">
      <div className="hero control-hero">
        <div>
          <span className="pill">Executive control tower</span>
          <h2 id="control-tower-title">One operating truth for the entire FMCG business.</h2>
          <p>Coordinate product, stock, customers, trade execution and governance from a modular tenant-safe platform.</p>
          <div className="hero-actions"><button className="hero-primary" type="button">Open daily cockpit</button><button className="hero-secondary" type="button">View operating plan</button></div>
        </div>
        <div className="hero-scorecard">
          <span>Operational health</span>
          <strong>92</strong>
          <small>Strong · 4 actions need attention</small>
          <div className="health-meter"><i /></div>
        </div>
      </div>

      <div className="metric-strip executive-metrics">
        <article><span>Net revenue</span><strong>€2.84M</strong><small className="positive-number">+8.2% vs plan</small></article>
        <article><span>Service level</span><strong>96.4%</strong><small className="positive-number">+1.7 points</small></article>
        <article><span>Inventory at risk</span><strong>€418K</strong><small>Aging and near expiry</small></article>
        <article><span>Gross margin</span><strong>18.6%</strong><small className="positive-number">+0.9 points</small></article>
        <article><span>Active outlets</span><strong>1,284</strong><small>83% visited this cycle</small></article>
        <article><span>Open approvals</span><strong>3</strong><small>1 critical decision</small></article>
      </div>

      <div className="dashboard-grid">
        <article className="dashboard-panel attention-panel">
          <div className="panel-heading"><div><span className="eyebrow">Priority queue</span><h3>Requires attention</h3></div><button className="ghost-button compact" type="button">View all</button></div>
          <div className="alert-list">
            {alerts.map((alert) => (
              <div className="alert-row" key={alert.title}>
                <span className={`severity-dot ${alert.severity}`} />
                <div><strong>{alert.title}</strong><small>{alert.detail}</small></div>
                <button className="text-button" type="button">{alert.action}</button>
              </div>
            ))}
          </div>
        </article>

        <article className="dashboard-panel channel-panel">
          <div className="panel-heading"><div><span className="eyebrow">Commercial pulse</span><h3>Channel performance</h3></div><span className="period-chip">MTD</span></div>
          <div className="channel-chart">
            <ChannelRow label="Modern trade" value="€1.12M" percentage={78} change="+11%" />
            <ChannelRow label="Traditional trade" value="€884K" percentage={64} change="+4%" />
            <ChannelRow label="E-commerce" value="€536K" percentage={88} change="+19%" />
            <ChannelRow label="Horeca" value="€300K" percentage={52} change="-2%" />
          </div>
        </article>
      </div>

      <div className="workspace-heading compact-heading">
        <div><span className="eyebrow">Capability launcher</span><h2>Business modules</h2><p>Open the workflows you need; disabled capabilities stay hidden and reject API access.</p></div>
        <button className="ghost-button" type="button">Manage entitlements</button>
      </div>
      <div className="capability-grid">
        {modules.map((module) => (
          <article className="capability-card" key={module.key}>
            <div className="capability-top"><span className="capability-icon">{module.short}</span><span className={`delivery-chip ${module.status.toLowerCase()}`}>{module.status}</span></div>
            <h3>{module.label}</h3>
            <p>{module.description}</p>
            <div className="capability-footer"><strong>{module.metric}</strong><button type="button" aria-label={`Open ${module.label}`}>→</button></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ChannelRow({ label, value, percentage, change }: { label: string; value: string; percentage: number; change: string }) {
  return (
    <div className="channel-row">
      <div><strong>{label}</strong><small>{value}</small></div>
      <div className="channel-track"><i style={{ width: `${percentage}%` }} /></div>
      <span className={change.startsWith('-') ? 'negative-number' : 'positive-number'}>{change}</span>
    </div>
  );
}
