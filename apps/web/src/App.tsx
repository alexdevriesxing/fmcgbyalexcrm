import type { ModuleEntitlement } from '@fmcgbyalex/contracts';

const modules: ModuleEntitlement[] = [
  { key: 'platform', enabled: true, status: 'foundation', label: 'Platform & Admin', description: 'Tenants, users, roles, workflow, files and audit' },
  { key: 'procurement', enabled: true, status: 'planned', label: 'Procurement', description: 'Sourcing, suppliers, purchase orders and inbound' },
  { key: 'production', enabled: true, status: 'planned', label: 'Production', description: 'MRP, recipes, scheduling, quality and maintenance' },
  { key: 'workforce', enabled: true, status: 'planned', label: 'Workforce', description: 'Shifts, skills, attendance, labor and training' },
  { key: 'inventory', enabled: true, status: 'foundation', label: 'Inventory & WMS', description: 'Lots, expiry, aging, FEFO, counts and dispatch' },
  { key: 'sales', enabled: true, status: 'foundation', label: 'Sales', description: 'Pricing, quotations, orders, delivery and returns' },
  { key: 'finance', enabled: true, status: 'planned', label: 'Finance', description: 'Accounting, invoicing, AR, AP, tax and cash' },
  { key: 'crm', enabled: true, status: 'foundation', label: 'CRM', description: 'Accounts, contacts, activities, pipeline and service' },
  { key: 'geospatial', enabled: true, status: 'planned', label: 'Routes & Zones', description: 'Territories, maps, routing, field visits and proof' },
  { key: 'distributors', enabled: true, status: 'planned', label: 'Distribution', description: 'Distributors, retailers, sell-out and coverage' },
  { key: 'trade-terms', enabled: true, status: 'planned', label: 'Trade Terms', description: 'Agreements, rebates, claims, accruals and settlement' },
  { key: 'ecommerce', enabled: true, status: 'planned', label: 'E-commerce', description: 'B2B ordering, D2C, marketplaces and subscriptions' },
  { key: 'marketing', enabled: true, status: 'planned', label: 'Marketing', description: 'Campaigns, segments, journeys, consent and ROI' },
  { key: 'analytics', enabled: true, status: 'planned', label: 'Planning & Analytics', description: 'Dashboards, forecasts, S&OP and scenarios' }
];

const kpis = [
  ['€2.84M', 'Net revenue', '+8.2% vs plan'],
  ['96.4%', 'Service level', '+1.7 pts'],
  ['€418K', 'Inventory at risk', 'Aging + near expiry'],
  ['18.6%', 'Gross margin', '+0.9 pts'],
  ['1,284', 'Active outlets', '83% visited'],
  ['€73K', 'Open rebates', '12 require action']
];

export function App() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">FA</span>
          <span><strong>FMCG by Alex</strong><small>SuperApp</small></span>
        </div>

        <nav aria-label="Primary navigation">
          <a className="nav-item active" href="#overview">Overview</a>
          <a className="nav-item" href="#modules">Modules</a>
          <a className="nav-item" href="#operations">Operations</a>
          <a className="nav-item" href="#analytics">Analytics</a>
          <a className="nav-item" href="#admin">Administration</a>
        </nav>

        <div className="tenant-card">
          <span className="eyebrow">Current company</span>
          <strong>Demo FMCG Group</strong>
          <small>Netherlands · EUR</small>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div><span className="eyebrow">Tuesday, 21 July 2026</span><h1>Good afternoon, Alex</h1></div>
          <div className="top-actions"><button className="ghost-button" type="button">Global search</button><button className="primary-button" type="button">Create</button></div>
        </header>

        <section className="hero" id="overview">
          <div>
            <span className="pill">Executive control tower</span>
            <h2>Run the entire FMCG business from one operational truth.</h2>
            <p>Modular ERP, CRM, field execution, commerce and marketing with tenant-grade controls and auditable workflows.</p>
          </div>
          <div className="hero-status"><span>Operational status</span><strong>All core systems healthy</strong><small>Last checked just now</small></div>
        </section>

        <section className="kpi-grid" aria-label="Key performance indicators">
          {kpis.map(([value, label, note]) => <article className="kpi-card" key={label}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>)}
        </section>

        <section className="section-heading" id="modules">
          <div><span className="eyebrow">Capability launcher</span><h2>Business modules</h2></div>
          <button className="ghost-button" type="button">Manage entitlements</button>
        </section>

        <section className="module-grid">
          {modules.map((module, index) => (
            <article className="module-card" key={module.key}>
              <div className="module-icon" aria-hidden="true">{String(index + 1).padStart(2, '0')}</div>
              <div>
                <div className="module-title-row"><h3>{module.label}</h3><span className={`status ${module.status}`}>{module.status}</span></div>
                <p>{module.description}</p>
              </div>
            </article>
          ))}
        </section>

        <section className="workbench" id="operations">
          <article>
            <span className="eyebrow">Requires attention</span><h2>Today’s operational queue</h2>
            <ul><li><strong>24</strong> lots expire within 60 days</li><li><strong>7</strong> orders are blocked by credit control</li><li><strong>12</strong> rebate claims need evidence</li><li><strong>3</strong> production lines have schedule risk</li></ul>
          </article>
          <article>
            <span className="eyebrow">Commercial pulse</span><h2>Channels and campaigns</h2>
            <div className="progress-row"><span>Modern trade</span><progress value="76" max="100">76%</progress></div>
            <div className="progress-row"><span>Traditional trade</span><progress value="62" max="100">62%</progress></div>
            <div className="progress-row"><span>E-commerce</span><progress value="88" max="100">88%</progress></div>
            <div className="progress-row"><span>Campaign ROI</span><progress value="71" max="100">71%</progress></div>
          </article>
        </section>
      </main>
    </div>
  );
}
