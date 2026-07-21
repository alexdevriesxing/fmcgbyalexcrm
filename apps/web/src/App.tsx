import { useState } from 'react';
import { CatalogWorkspace } from './components/CatalogWorkspace';
import { ControlTower } from './components/ControlTower';
import { GovernanceWorkspace } from './components/GovernanceWorkspace';
import { InventoryWorkspace } from './components/InventoryWorkspace';

type Workspace = 'overview' | 'inventory' | 'catalog' | 'governance';

type NavigationItem = {
  id: Workspace;
  label: string;
  shortLabel: string;
  description: string;
};

const navigationItems: NavigationItem[] = [
  { id: 'overview', label: 'Control tower', shortLabel: 'CT', description: 'Executive operating overview' },
  { id: 'inventory', label: 'Inventory & WMS', shortLabel: 'IW', description: 'Stock, lots, FEFO and movements' },
  { id: 'catalog', label: 'Master data', shortLabel: 'MD', description: 'Products, locations and parties' },
  { id: 'governance', label: 'Governance', shortLabel: 'GV', description: 'Approvals, roles and access' }
];

const workspaceTitles: Record<Workspace, { eyebrow: string; title: string }> = {
  overview: { eyebrow: 'Tuesday, 21 July 2026', title: 'Good evening, Alex' },
  inventory: { eyebrow: 'Operations · Inventory', title: 'Inventory command centre' },
  catalog: { eyebrow: 'Foundation · Master data', title: 'Business data workspace' },
  governance: { eyebrow: 'Administration · Governance', title: 'Controls and access' }
};

export function App() {
  const [workspace, setWorkspace] = useState<Workspace>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const heading = workspaceTitles[workspace];

  function selectWorkspace(nextWorkspace: Workspace) {
    setWorkspace(nextWorkspace);
    setSidebarOpen(false);
  }

  return (
    <div className="app-shell">
      <button
        className={`sidebar-scrim ${sidebarOpen ? 'visible' : ''}`}
        type="button"
        aria-label="Close navigation"
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">FA</span>
          <span><strong>FMCG by Alex</strong><small>SuperApp</small></span>
        </div>

        <div className="sidebar-section">
          <span className="sidebar-label">Workspace</span>
          <nav aria-label="Primary navigation">
            {navigationItems.map((item) => (
              <button
                className={`nav-item ${workspace === item.id ? 'active' : ''}`}
                type="button"
                key={item.id}
                aria-current={workspace === item.id ? 'page' : undefined}
                onClick={() => selectWorkspace(item.id)}
              >
                <span className="nav-icon" aria-hidden="true">{item.shortLabel}</span>
                <span><strong>{item.label}</strong><small>{item.description}</small></span>
              </button>
            ))}
          </nav>
        </div>

        <div className="sidebar-section secondary-navigation">
          <span className="sidebar-label">Business suite</span>
          <button className="secondary-nav-item" type="button"><span>SO</span>Sales & orders<small>Foundation</small></button>
          <button className="secondary-nav-item" type="button"><span>CR</span>CRM & service<small>Foundation</small></button>
          <button className="secondary-nav-item" type="button"><span>PO</span>Procurement<small>Planned</small></button>
          <button className="secondary-nav-item" type="button"><span>FI</span>Finance<small>Planned</small></button>
        </div>

        <div className="tenant-card">
          <div className="tenant-card-head"><span className="tenant-avatar">DG</span><span><small>Current company</small><strong>Demo FMCG Group</strong></span></div>
          <div className="tenant-meta"><span>Netherlands</span><span>EUR</span><span>Europe/Amsterdam</span></div>
          <button className="tenant-switch" type="button">Switch company <span aria-hidden="true">↗</span></button>
        </div>

        <div className="sidebar-profile">
          <span className="avatar">AD</span>
          <span><strong>Alex de Vries</strong><small>Tenant Administrator</small></span>
          <button className="row-menu" type="button" aria-label="Open account menu">•••</button>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-heading">
            <button className="mobile-menu" type="button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>☰</button>
            <div><span className="eyebrow">{heading.eyebrow}</span><h1>{heading.title}</h1></div>
          </div>
          <div className="top-actions">
            <button className="search-button" type="button" onClick={() => setSearchOpen(true)}>
              <span aria-hidden="true">⌕</span><span>Search anything</span><kbd>⌘ K</kbd>
            </button>
            <button className="icon-button" type="button" aria-label="Open notifications"><span aria-hidden="true">◎</span><i>4</i></button>
            <button className="create-button" type="button"><span aria-hidden="true">＋</span>Create</button>
          </div>
        </header>

        <div className="environment-banner">
          <span className="environment-dot" />
          <strong>Development environment</strong>
          <span>OIDC-ready · Tenant isolation active · Ledger checks passing</span>
          <button type="button">View system status</button>
        </div>

        <div className="workspace-content">
          {workspace === 'overview' && <ControlTower />}
          {workspace === 'inventory' && <InventoryWorkspace />}
          {workspace === 'catalog' && <CatalogWorkspace />}
          {workspace === 'governance' && <GovernanceWorkspace />}
        </div>

        <footer className="app-footer">
          <span>FMCG by Alex SuperApp · Platform build 0.6.0</span>
          <span>Secure multi-tenant foundation · Append-only ledgers · Maker-checker governance</span>
        </footer>
      </main>

      {searchOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setSearchOpen(false)}>
          <section className="command-dialog" role="dialog" aria-modal="true" aria-labelledby="command-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="command-search"><span aria-hidden="true">⌕</span><input autoFocus placeholder="Search products, orders, customers, lots or actions" aria-label="Global search" /><button type="button" onClick={() => setSearchOpen(false)}>Esc</button></div>
            <div className="command-results">
              <span className="sidebar-label" id="command-title">Quick navigation</span>
              {navigationItems.map((item) => (
                <button type="button" key={item.id} onClick={() => { selectWorkspace(item.id); setSearchOpen(false); }}>
                  <span className="nav-icon">{item.shortLabel}</span><span><strong>{item.label}</strong><small>{item.description}</small></span><span aria-hidden="true">↵</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
