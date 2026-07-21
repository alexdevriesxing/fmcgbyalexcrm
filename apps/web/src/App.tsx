import { useEffect, useMemo, useState } from 'react';
import { CatalogWorkspace } from './components/CatalogWorkspace';
import { ControlTower } from './components/ControlTower';
import { CrmWorkspace } from './components/CrmWorkspace';
import { GovernanceWorkspace } from './components/GovernanceWorkspace';
import { InventoryWorkspace } from './components/InventoryWorkspace';
import { Modal } from './components/Modal';
import { SalesWorkspace } from './components/SalesWorkspace';
import type { CrmAction } from './components/forms/CrmDialog';
import type { InventoryAction } from './components/forms/InventoryActionDialog';
import type { MasterDataAction } from './components/forms/MasterDataDialog';
import type { SalesAction } from './components/forms/SalesDialog';
import { useApplication } from './state/ApplicationProvider';
import { useCommercial } from './state/CommercialProvider';

export type Workspace = 'overview' | 'crm' | 'sales' | 'inventory' | 'catalog' | 'governance';

type NavigationItem = {
  id: Workspace;
  label: string;
  shortLabel: string;
  description: string;
  moduleKey?: 'crm' | 'sales' | 'inventory' | 'master-data' | 'platform';
};

type PendingAction =
  | { workspace: 'catalog'; action: MasterDataAction }
  | { workspace: 'inventory'; action: InventoryAction }
  | { workspace: 'crm'; action: Extract<CrmAction, string> }
  | { workspace: 'sales'; action: Extract<SalesAction, string> }
  | { workspace: 'governance'; action: 'invite' }
  | null;

type SearchResult = {
  id: string;
  label: string;
  detail: string;
  shortLabel: string;
  workspace: Workspace;
};

const navigationItems: NavigationItem[] = [
  { id: 'overview', label: 'Control tower', shortLabel: 'CT', description: 'Executive operating overview' },
  { id: 'crm', label: 'CRM & pipeline', shortLabel: 'CR', description: 'Accounts, activities and follow-up', moduleKey: 'crm' },
  { id: 'sales', label: 'Sales & orders', shortLabel: 'SO', description: 'Pricing, quotes and commitments', moduleKey: 'sales' },
  { id: 'inventory', label: 'Inventory & WMS', shortLabel: 'IW', description: 'Stock, lots, FEFO and movements', moduleKey: 'inventory' },
  { id: 'catalog', label: 'Master data', shortLabel: 'MD', description: 'Products, locations and parties', moduleKey: 'master-data' },
  { id: 'governance', label: 'Governance', shortLabel: 'GV', description: 'Approvals, roles and access', moduleKey: 'platform' }
];

export function App() {
  const application = useApplication();
  const commercial = useCommercial();
  const [workspace, setWorkspace] = useState<Workspace>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const session = application.session;
  const currentTenant = application.tenants.find((tenant) => tenant.id === application.tenantId) ?? null;
  const moduleMap = new Map((session?.modules ?? []).map((module) => [module.key, module.enabled]));
  const visibleNavigation = navigationItems.filter((item) => !item.moduleKey || moduleMap.get(item.moduleKey) === true);
  const pendingApprovals = application.data.approvals?.requests.filter((approval) => approval.status === 'pending').length ?? 0;
  const inventoryRisk = (application.data.inventory?.totals.nearExpiryBase ?? 0) +
    (application.data.inventory?.totals.expiredBase ?? 0) +
    (application.data.inventory?.totals.quarantineBase ?? 0);
  const overdueTasks = commercial.crm?.metrics.overdueTaskCount ?? 0;
  const acceptedQuotes = commercial.sales?.quotes.filter((quote) => quote.status === 'accepted').length ?? 0;
  const notificationCount = pendingApprovals + overdueTasks + acceptedQuotes + (inventoryRisk > 0 ? 1 : 0);
  const heading = workspaceHeading(workspace, session?.user.displayName ?? 'Operator');

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const searchResults = useMemo(
    () => buildSearchResults(application, commercial, searchQuery),
    [application.data, application.session, commercial.crm, commercial.sales, searchQuery]
  );
  const enabledCreateActions = createActions(application.hasPermission);

  function selectWorkspace(nextWorkspace: Workspace) {
    setWorkspace(nextWorkspace);
    setSidebarOpen(false);
  }

  function launchAction(action: Exclude<PendingAction, null>) {
    setPendingAction(action);
    setWorkspace(action.workspace);
    setCreateOpen(false);
    setSearchOpen(false);
    setSidebarOpen(false);
  }

  function openNotificationTarget() {
    if (overdueTasks > 0) selectWorkspace('crm');
    else if (acceptedQuotes > 0) selectWorkspace('sales');
    else if (pendingApprovals > 0) selectWorkspace('governance');
    else selectWorkspace('inventory');
  }

  async function refreshEverything() {
    await Promise.all([application.refreshAll(), commercial.refresh()]);
  }

  return (
    <div className="app-shell">
      <button className={`sidebar-scrim ${sidebarOpen ? 'visible' : ''}`} type="button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} />

      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand"><span className="brand-mark" aria-hidden="true">FA</span><span><strong>FMCG by Alex</strong><small>SuperApp</small></span></div>
        <div className="sidebar-section">
          <span className="sidebar-label">Workspace</span>
          <nav aria-label="Primary navigation">
            {visibleNavigation.map((item) => <button className={`nav-item ${workspace === item.id ? 'active' : ''}`} type="button" key={item.id} aria-current={workspace === item.id ? 'page' : undefined} onClick={() => selectWorkspace(item.id)}><span className="nav-icon" aria-hidden="true">{item.shortLabel}</span><span><strong>{item.label}</strong><small>{item.description}</small></span></button>)}
          </nav>
        </div>

        <div className="sidebar-section secondary-navigation">
          <span className="sidebar-label">Next capabilities</span>
          {(session?.modules ?? []).filter((module) => ['procurement', 'finance', 'field-execution', 'analytics'].includes(module.key)).map((module) => <button className="secondary-nav-item" type="button" key={module.key} disabled><span>{module.label.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()}</span>{module.label}<small>{module.enabled ? module.status : 'Disabled'}</small></button>)}
        </div>

        <div className="tenant-card">
          <div className="tenant-card-head"><span className="tenant-avatar">{initials(currentTenant?.displayName ?? 'Tenant')}</span><span><small>Current company</small><strong>{currentTenant?.displayName ?? 'No tenant selected'}</strong></span></div>
          {currentTenant && <div className="tenant-meta"><span>{currentTenant.defaultLocale}</span><span>{currentTenant.defaultCurrency}</span><span>{currentTenant.defaultTimezone}</span></div>}
          {application.tenants.length > 1 ? <label className="tenant-select"><span className="sr-only">Switch company</span><select value={application.tenantId ?? ''} onChange={(event) => void application.selectTenant(event.target.value)}>{application.tenants.map((tenant) => <option value={tenant.id} key={tenant.id}>{tenant.displayName}</option>)}</select></label> : <button className="tenant-switch" type="button" disabled>Single company membership <span aria-hidden="true">✓</span></button>}
        </div>

        <div className="sidebar-profile"><span className="avatar">{initials(session?.user.displayName ?? 'User')}</span><span><strong>{session?.user.displayName ?? 'Authenticated user'}</strong><small>{session?.roles.join(', ') || 'No assigned role'}</small></span><button className="row-menu" type="button" aria-label="Sign out" title="Sign out" onClick={application.signOut}>↪</button></div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-heading"><button className="mobile-menu" type="button" aria-label="Open navigation" onClick={() => setSidebarOpen(true)}>☰</button><div><span className="eyebrow">{heading.eyebrow}</span><h1>{heading.title}</h1></div></div>
          <div className="top-actions"><button className="search-button" type="button" onClick={() => setSearchOpen(true)}><span aria-hidden="true">⌕</span><span>Search company operations</span><kbd>⌘ K</kbd></button><button className="icon-button" type="button" aria-label={`${notificationCount} operational notifications`} onClick={openNotificationTarget}><span aria-hidden="true">◎</span>{notificationCount > 0 && <i>{notificationCount > 9 ? '9+' : notificationCount}</i>}</button><button className="create-button" type="button" onClick={() => setCreateOpen(true)} disabled={enabledCreateActions.length === 0}><span aria-hidden="true">＋</span>Create</button></div>
        </header>

        <div className={`environment-banner ${application.refreshing || commercial.refreshing ? 'refreshing' : ''}`}><span className="environment-dot" /><strong>{capitalize(application.runtime.environment)} environment</strong><span>{application.runtime.authenticationMode === 'development' ? 'Development identity' : 'OIDC bearer authentication'} · Tenant {currentTenant?.slug ?? 'unselected'} · Live operational state</span><button type="button" onClick={() => void refreshEverything()} disabled={application.refreshing || commercial.refreshing}>{application.refreshing || commercial.refreshing ? 'Refreshing…' : 'Refresh all data'}</button></div>

        {application.notice && <GlobalNotice notice={application.notice} onClose={application.dismissNotice} />}
        {commercial.notice && <GlobalNotice notice={commercial.notice} onClose={commercial.dismissNotice} />}

        <div className="workspace-content">
          {workspace === 'overview' && <ControlTower onNavigate={selectWorkspace} />}
          {workspace === 'crm' && <CrmWorkspace requestedAction={pendingAction?.workspace === 'crm' ? pendingAction.action : null} onActionConsumed={() => setPendingAction(null)} />}
          {workspace === 'sales' && <SalesWorkspace requestedAction={pendingAction?.workspace === 'sales' ? pendingAction.action : null} onActionConsumed={() => setPendingAction(null)} />}
          {workspace === 'inventory' && <InventoryWorkspace requestedAction={pendingAction?.workspace === 'inventory' ? pendingAction.action : null} onActionConsumed={() => setPendingAction(null)} />}
          {workspace === 'catalog' && <CatalogWorkspace requestedAction={pendingAction?.workspace === 'catalog' ? pendingAction.action : null} onActionConsumed={() => setPendingAction(null)} />}
          {workspace === 'governance' && <GovernanceWorkspace requestedAction={pendingAction?.workspace === 'governance' ? pendingAction.action : null} onActionConsumed={() => setPendingAction(null)} />}
        </div>

        <footer className="app-footer"><span>FMCG by Alex SuperApp · Platform build 0.8.0</span><span>Live CRM · Inventory-backed orders · Append-only ledgers · Maker-checker governance</span></footer>
      </main>

      {searchOpen && <div className="dialog-backdrop" role="presentation" onMouseDown={() => setSearchOpen(false)}><section className="command-dialog" role="dialog" aria-modal="true" aria-labelledby="command-title" onMouseDown={(event) => event.stopPropagation()}><div className="command-search"><span aria-hidden="true">⌕</span><input autoFocus value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search accounts, opportunities, quotes, orders, products or stock" aria-label="Global search" /><button type="button" onClick={() => setSearchOpen(false)}>Esc</button></div><div className="command-results"><span className="sidebar-label" id="command-title">{searchQuery.trim() ? 'Tenant search results' : 'Quick navigation'}</span>{(searchQuery.trim() ? searchResults : visibleNavigation.map((item) => ({ id: item.id, label: item.label, detail: item.description, shortLabel: item.shortLabel, workspace: item.id }))).slice(0, 18).map((result) => <button type="button" key={result.id} onClick={() => { selectWorkspace(result.workspace); setSearchOpen(false); setSearchQuery(''); }}><span className="nav-icon">{result.shortLabel}</span><span><strong>{result.label}</strong><small>{result.detail}</small></span><span aria-hidden="true">↵</span></button>)}{searchQuery.trim() && searchResults.length === 0 && <div className="command-empty">No loaded tenant record matches “{searchQuery.trim()}”.</div>}</div></section></div>}

      {createOpen && <Modal eyebrow="Tenant actions" title="Create or post" description="Only actions permitted by your current role are available." onClose={() => setCreateOpen(false)}><div className="create-action-grid">{enabledCreateActions.map((action) => <button type="button" key={`${action.workspace}:${String(action.action)}`} onClick={() => launchAction(action)}><span>{action.icon}</span><div><strong>{action.label}</strong><small>{action.detail}</small></div><i>→</i></button>)}</div></Modal>}
    </div>
  );
}

function GlobalNotice({ notice, onClose }: { notice: { tone: string; title: string; detail: string }; onClose: () => void }) {
  return <div className={`global-notice ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}><div><strong>{notice.title}</strong><span>{notice.detail}</span></div><button type="button" aria-label="Dismiss notification" onClick={onClose}>×</button></div>;
}

function workspaceHeading(workspace: Workspace, displayName: string): { eyebrow: string; title: string } {
  const now = new Date();
  const date = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);
  if (workspace === 'overview') return { eyebrow: date, title: `${greeting(now)}, ${displayName.split(/\s+/)[0] ?? displayName}` };
  if (workspace === 'crm') return { eyebrow: 'Commercial · CRM', title: 'Relationships and pipeline' };
  if (workspace === 'sales') return { eyebrow: 'Commercial · Sales', title: 'Quotes, orders and commitments' };
  if (workspace === 'inventory') return { eyebrow: 'Operations · Inventory', title: 'Inventory command centre' };
  if (workspace === 'catalog') return { eyebrow: 'Foundation · Master data', title: 'Business data workspace' };
  return { eyebrow: 'Administration · Governance', title: 'Controls and access' };
}

function buildSearchResults(application: ReturnType<typeof useApplication>, commercial: ReturnType<typeof useCommercial>, query: string): SearchResult[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const results: SearchResult[] = [];
  for (const account of commercial.crm?.accounts ?? []) if ([account.code, account.name, account.accountType, account.countryCode].some((value) => value.toLowerCase().includes(normalized))) results.push({ id: `account:${account.id}`, label: account.name, detail: `${account.code} · ${account.accountType} · ${account.openOpportunityCount} opportunities`, shortLabel: 'AC', workspace: 'crm' });
  for (const opportunity of commercial.crm?.opportunities ?? []) if ([opportunity.name, opportunity.accountName, opportunity.stage, opportunity.nextAction ?? ''].some((value) => value.toLowerCase().includes(normalized))) results.push({ id: `opportunity:${opportunity.id}`, label: opportunity.name, detail: `${opportunity.accountName} · ${opportunity.stage}`, shortLabel: 'OP', workspace: 'crm' });
  for (const task of commercial.crm?.tasks ?? []) if ([task.subject, task.detail ?? '', task.priority, task.status].some((value) => value.toLowerCase().includes(normalized))) results.push({ id: `task:${task.id}`, label: task.subject, detail: `${task.priority} · ${task.status}`, shortLabel: 'TK', workspace: 'crm' });
  for (const quote of commercial.sales?.quotes ?? []) if ([quote.quoteNumber, quote.accountName, quote.status, quote.customerReference ?? ''].some((value) => value.toLowerCase().includes(normalized))) results.push({ id: `quote:${quote.id}`, label: quote.quoteNumber, detail: `${quote.accountName} · ${quote.status}`, shortLabel: 'QT', workspace: 'sales' });
  for (const order of commercial.sales?.orders ?? []) if ([order.orderNumber, order.accountName, order.status, order.customerReference ?? ''].some((value) => value.toLowerCase().includes(normalized))) results.push({ id: `order:${order.id}`, label: order.orderNumber, detail: `${order.accountName} · ${order.status}`, shortLabel: 'SO', workspace: 'sales' });
  for (const product of application.data.products) { if ([product.code, product.name, product.brand, product.category].some((value) => value.toLowerCase().includes(normalized))) results.push({ id: `product:${product.id}`, label: product.name, detail: `${product.code} · ${product.brand}`, shortLabel: 'PR', workspace: 'catalog' }); for (const variant of product.variants) if ([variant.sku, variant.name, variant.barcode ?? ''].some((value) => value.toLowerCase().includes(normalized))) results.push({ id: `variant:${variant.id}`, label: variant.name, detail: `${variant.sku} · ${product.name}`, shortLabel: 'SK', workspace: 'catalog' }); }
  for (const balance of application.data.inventory?.balances ?? []) if ([balance.sku, balance.productName, balance.variantName, balance.lot.lotCode, balance.warehouseCode].some((value) => value.toLowerCase().includes(normalized))) results.push({ id: `stock:${balance.variantId}:${balance.warehouseId}:${balance.lot.id}:${balance.status}`, label: `${balance.sku} · ${balance.lot.lotCode}`, detail: `${balance.warehouseCode} · ${balance.quantityBase.toLocaleString()} · ${balance.status}`, shortLabel: 'ST', workspace: 'inventory' });
  for (const approval of application.data.approvals?.requests ?? []) if ([approval.title, approval.resourceId, approval.requesterDisplayName, approval.action].some((value) => value.toLowerCase().includes(normalized))) results.push({ id: `approval:${approval.id}`, label: approval.title, detail: `${approval.status} · ${approval.requesterDisplayName}`, shortLabel: 'AP', workspace: 'governance' });
  return results;
}

function createActions(hasPermission: (permission: string) => boolean): Array<Exclude<PendingAction, null> & { icon: string; label: string; detail: string }> {
  const actions: Array<Exclude<PendingAction, null> & { icon: string; label: string; detail: string }> = [];
  if (hasPermission('crm.accounts.manage')) actions.push({ workspace: 'crm', action: 'account', icon: 'AC', label: 'CRM account', detail: 'Create a prospect, customer or channel account' });
  if (hasPermission('crm.activities.manage')) actions.push({ workspace: 'crm', action: 'task', icon: 'TK', label: 'Commercial follow-up', detail: 'Schedule an account or opportunity task' });
  if (hasPermission('crm.pipeline.manage')) actions.push({ workspace: 'crm', action: 'opportunity', icon: 'OP', label: 'Opportunity', detail: 'Add expected and weighted pipeline value' });
  if (hasPermission('sales.quotes.manage')) actions.push({ workspace: 'sales', action: 'quote', icon: 'QT', label: 'Quotation', detail: 'Create a server-priced customer quotation' });
  if (hasPermission('sales.pricing.manage')) actions.push({ workspace: 'sales', action: 'price-list', icon: 'PL', label: 'Price list', detail: 'Define SKU quantity breaks and taxes' });
  if (hasPermission('master-data.catalog.manage')) actions.push({ workspace: 'catalog', action: 'product', icon: 'PR', label: 'Product and SKUs', detail: 'Create product, unit, brand, category and variants' });
  if (hasPermission('master-data.locations.manage')) actions.push({ workspace: 'catalog', action: 'warehouse', icon: 'WH', label: 'Warehouse', detail: 'Create entity, site, warehouse, zone and bin' });
  if (hasPermission('master-data.parties.manage')) actions.push({ workspace: 'catalog', action: 'party', icon: 'BP', label: 'Business party', detail: 'Add supplier, customer, distributor or retailer' });
  if (hasPermission('inventory.stock.receive')) actions.push({ workspace: 'inventory', action: 'receive', icon: 'GR', label: 'Goods receipt', detail: 'Receive lot-controlled stock into a warehouse' });
  if (hasPermission('inventory.stock.transfer')) actions.push({ workspace: 'inventory', action: 'transfer', icon: 'TR', label: 'Stock transfer', detail: 'Post a balanced inter-warehouse movement pair' });
  if (hasPermission('platform.invitations.manage')) actions.push({ workspace: 'governance', action: 'invite', icon: 'IN', label: 'Team invitation', detail: 'Invite a member and assign tenant roles' });
  return actions;
}

function greeting(date: Date): string { const hour = date.getHours(); return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'; }
function initials(value: string): string { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join(''); }
function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
