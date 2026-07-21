import type {
  InvitationSummary,
  MembershipSummary,
  ModuleEntitlement
} from '@fmcgbyalex/contracts';

const modules: ModuleEntitlement[] = [
  { key: 'platform', enabled: true, status: 'foundation', label: 'Platform & Admin', description: 'Tenants, users, roles, workflow, files and audit', version: 1 },
  { key: 'procurement', enabled: true, status: 'planned', label: 'Procurement', description: 'Sourcing, suppliers, purchase orders and inbound', version: 1 },
  { key: 'production', enabled: true, status: 'planned', label: 'Production', description: 'MRP, recipes, scheduling, quality and maintenance', version: 1 },
  { key: 'workforce', enabled: true, status: 'planned', label: 'Workforce', description: 'Shifts, skills, attendance, labor and training', version: 1 },
  { key: 'inventory', enabled: true, status: 'foundation', label: 'Inventory & WMS', description: 'Lots, expiry, aging, FEFO, counts and dispatch', version: 1 },
  { key: 'sales', enabled: true, status: 'foundation', label: 'Sales', description: 'Pricing, quotations, orders, delivery and returns', version: 1 },
  { key: 'finance', enabled: true, status: 'planned', label: 'Finance', description: 'Accounting, invoicing, AR, AP, tax and cash', version: 1 },
  { key: 'crm', enabled: true, status: 'foundation', label: 'CRM', description: 'Accounts, contacts, activities, pipeline and service', version: 1 },
  { key: 'geospatial', enabled: true, status: 'planned', label: 'Routes & Zones', description: 'Territories, maps, routing, field visits and proof', version: 1 },
  { key: 'distributors', enabled: true, status: 'planned', label: 'Distribution', description: 'Distributors, retailers, sell-out and coverage', version: 1 },
  { key: 'trade-terms', enabled: true, status: 'planned', label: 'Trade Terms', description: 'Agreements, rebates, claims, accruals and settlement', version: 1 },
  { key: 'ecommerce', enabled: true, status: 'planned', label: 'E-commerce', description: 'B2B ordering, D2C, marketplaces and subscriptions', version: 1 },
  { key: 'marketing', enabled: true, status: 'planned', label: 'Marketing', description: 'Campaigns, segments, journeys, consent and ROI', version: 1 },
  { key: 'analytics', enabled: true, status: 'planned', label: 'Planning & Analytics', description: 'Dashboards, forecasts, S&OP and scenarios', version: 1 }
];

const kpis = [
  ['€2.84M', 'Net revenue', '+8.2% vs plan'],
  ['96.4%', 'Service level', '+1.7 pts'],
  ['€418K', 'Inventory at risk', 'Aging + near expiry'],
  ['18.6%', 'Gross margin', '+0.9 pts'],
  ['1,284', 'Active outlets', '83% visited'],
  ['€73K', 'Open rebates', '12 require action']
];

const members: MembershipSummary[] = [
  {
    userId: 'usr_alex',
    email: 'alex@fmcgbyalex.com',
    displayName: 'Alex de Vries',
    status: 'active',
    roles: ['tenant-admin'],
    createdAt: '2026-07-21T09:00:00.000Z',
    updatedAt: '2026-07-21T09:00:00.000Z'
  },
  {
    userId: 'usr_sales',
    email: 'sales@example.com',
    displayName: 'Commercial Manager',
    status: 'active',
    roles: ['operator'],
    createdAt: '2026-07-21T09:00:00.000Z',
    updatedAt: '2026-07-21T09:00:00.000Z'
  },
  {
    userId: 'usr_finance',
    email: 'finance@example.com',
    displayName: 'Finance Controller',
    status: 'active',
    roles: ['viewer'],
    createdAt: '2026-07-21T09:00:00.000Z',
    updatedAt: '2026-07-21T09:00:00.000Z'
  }
];

const invitations: InvitationSummary[] = [
  {
    id: 'inv_1',
    email: 'operations@example.com',
    displayName: 'Operations Lead',
    status: 'pending',
    roles: ['operator'],
    expiresAt: '2026-07-28T09:00:00.000Z',
    createdAt: '2026-07-21T09:00:00.000Z',
    acceptedAt: null
  }
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
          <button className="tenant-switch" type="button">Switch company</button>
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

        <section className="section-heading" id="admin">
          <div><span className="eyebrow">Tenant control plane</span><h2>People, roles and access</h2></div>
          <button className="primary-button" type="button">Invite team member</button>
        </section>

        <section className="admin-summary" aria-label="Administration summary">
          <article><span>Active members</span><strong>{members.filter((member) => member.status === 'active').length}</strong><small>Across 3 system roles</small></article>
          <article><span>Pending invitations</span><strong>{invitations.filter((invitation) => invitation.status === 'pending').length}</strong><small>Encrypted one-time acceptance</small></article>
          <article><span>Authentication</span><strong>OIDC</strong><small>Passkeys and MFA ready</small></article>
          <article><span>Tenant isolation</span><strong>Enforced</strong><small>Membership verified per request</small></article>
        </section>

        <section className="admin-grid">
          <article className="admin-panel">
            <div className="panel-heading"><div><span className="eyebrow">Company access</span><h3>Members</h3></div><button className="ghost-button compact" type="button">Manage roles</button></div>
            <div className="member-list">
              {members.map((member) => (
                <div className="member-row" key={member.userId}>
                  <div className="avatar" aria-hidden="true">{member.displayName.split(' ').map((part) => part[0]).join('').slice(0, 2)}</div>
                  <div className="member-copy"><strong>{member.displayName}</strong><small>{member.email}</small></div>
                  <div className="role-stack">{member.roles.map((role) => <span className="role-badge" key={role}>{role}</span>)}</div>
                  <span className={`member-status ${member.status}`}>{member.status}</span>
                  <button className="row-menu" type="button" aria-label={`Manage ${member.displayName}`}>•••</button>
                </div>
              ))}
            </div>
          </article>

          <article className="admin-panel invitation-panel">
            <div className="panel-heading"><div><span className="eyebrow">Secure onboarding</span><h3>Invitations</h3></div><span className="secure-chip">AES-256-GCM</span></div>
            {invitations.map((invitation) => (
              <div className="invitation-card" key={invitation.id}>
                <div><strong>{invitation.displayName ?? invitation.email}</strong><small>{invitation.email}</small></div>
                <div className="invitation-meta"><span>{invitation.roles.join(', ')}</span><span>Expires in 7 days</span></div>
                <div className="invitation-actions"><button className="ghost-button compact" type="button">Copy secure link</button><button className="text-button danger" type="button">Revoke</button></div>
              </div>
            ))}
            <div className="security-note"><strong>Invitation safety</strong><p>Acceptance secrets are encrypted at rest, bound to a verified identity email and never written to logs or event payloads.</p></div>
          </article>
        </section>
      </main>
    </div>
  );
}
