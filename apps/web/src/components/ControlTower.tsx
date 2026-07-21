import type { ModuleEntitlement } from '@fmcgbyalex/contracts';
import { useApplication } from '../state/ApplicationProvider';
import { useCommercial } from '../state/CommercialProvider';

type TargetWorkspace = 'crm' | 'sales' | 'inventory' | 'catalog' | 'governance';

type OperationalAlert = {
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  action: string;
  workspace: TargetWorkspace;
};

export function ControlTower({ onNavigate }: { onNavigate: (workspace: TargetWorkspace) => void }) {
  const application = useApplication();
  const commercial = useCommercial();
  const inventory = application.data.inventory;
  const approvals = application.data.approvals?.requests ?? [];
  const members = application.data.administration?.memberships ?? [];
  const modules = application.session?.modules ?? [];
  const products = application.data.products;
  const warehouses = application.data.warehouses;
  const parties = application.data.parties;
  const crm = commercial.crm;
  const sales = commercial.sales;
  const currencyCode = application.session?.tenant.defaultCurrency ?? 'EUR';
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending');
  const enabledModules = modules.filter((module) => module.enabled);
  const acceptedQuotes = sales?.quotes.filter((quote) => quote.status === 'accepted').length ?? 0;
  const alerts = buildAlerts({
    nearExpiry: inventory?.totals.nearExpiryBase ?? 0,
    expired: inventory?.totals.expiredBase ?? 0,
    quarantine: inventory?.totals.quarantineBase ?? 0,
    pendingApprovals: pendingApprovals.length,
    overdueTasks: crm?.metrics.overdueTaskCount ?? 0,
    acceptedQuotes,
    products: products.length,
    warehouses: warehouses.length,
    parties: parties.length
  });
  const healthScore = Math.max(35, 100 - alerts.reduce((total, alert) => total + (alert.severity === 'critical' ? 18 : alert.severity === 'warning' ? 9 : 3), 0));

  return (
    <section className="workspace-stack" aria-labelledby="control-tower-title">
      <div className="hero control-hero commercial-hero">
        <div>
          <span className="pill">Live executive control tower</span>
          <h2 id="control-tower-title">One operating truth from prospect to warehouse commitment.</h2>
          <p>The figures below come from the selected company’s CRM, sales orders, inventory ledger, master data and governance state—not seeded dashboard rows.</p>
          <div className="hero-actions"><button className="hero-primary" type="button" onClick={() => onNavigate('sales')}>Open sales cockpit</button><button className="hero-secondary" type="button" onClick={() => onNavigate('crm')}>Review pipeline</button></div>
        </div>
        <div className="hero-scorecard"><span>Operational readiness</span><strong>{healthScore}</strong><small>{alerts.length === 0 ? 'Strong · no current operating alerts' : `${alerts.length} live actions need attention`}</small><div className="health-meter"><i style={{ width: `${healthScore}%` }} /></div></div>
      </div>

      <div className="metric-strip executive-metrics live-executive-metrics">
        <article><span>Weighted pipeline</span><strong>{formatMoney(crm?.metrics.weightedPipelineMinor ?? 0, currencyCode)}</strong><small>{crm?.metrics.activeOpportunityCount ?? 0} active opportunities</small></article>
        <article><span>Open quote value</span><strong>{formatMoney(sales?.metrics.openQuoteValueMinor ?? 0, currencyCode)}</strong><small>{sales?.metrics.openQuoteCount ?? 0} customer quotations</small></article>
        <article><span>Committed orders</span><strong>{formatMoney(sales?.metrics.activeOrderValueMinor ?? 0, currencyCode)}</strong><small>{sales?.metrics.activeOrderCount ?? 0} active orders</small></article>
        <article><span>Available stock</span><strong>{(inventory?.totals.availableBase ?? 0).toLocaleString()}</strong><small>{(sales?.metrics.reservedQuantityBase ?? 0).toLocaleString()} units reserved</small></article>
        <article><span>Overdue follow-up</span><strong>{crm?.metrics.overdueTaskCount ?? 0}</strong><small>{crm?.metrics.dueSoonTaskCount ?? 0} due within 7 days</small></article>
        <article><span>Open approvals</span><strong>{pendingApprovals.length}</strong><small>{members.filter((member) => member.status === 'active').length} active members</small></article>
      </div>

      <div className="dashboard-grid">
        <article className="dashboard-panel attention-panel">
          <div className="panel-heading"><div><span className="eyebrow">Priority queue</span><h3>Requires attention</h3></div><span className="result-count">{alerts.length} alerts</span></div>
          <div className="alert-list">
            {alerts.length === 0 ? <div className="healthy-state"><span>✓</span><div><strong>No operating exceptions</strong><small>CRM, sales, inventory and governance have no current control-tower alerts.</small></div></div> : alerts.map((alert) => <div className="alert-row" key={`${alert.severity}:${alert.title}`}><span className={`severity-dot ${alert.severity}`} /><div><strong>{alert.title}</strong><small>{alert.detail}</small></div><button className="text-button" type="button" onClick={() => onNavigate(alert.workspace)}>{alert.action}</button></div>)}
          </div>
        </article>

        <article className="dashboard-panel readiness-panel">
          <div className="panel-heading"><div><span className="eyebrow">End-to-end readiness</span><h3>Commercial operating coverage</h3></div><span className="period-chip">Now</span></div>
          <ReadinessRow label="CRM account base" value={`${crm?.metrics.accountCount ?? 0} active accounts`} percentage={(crm?.metrics.accountCount ?? 0) > 0 ? 100 : 0} onOpen={() => onNavigate('crm')} />
          <ReadinessRow label="Pipeline discipline" value={`${crm?.metrics.activeOpportunityCount ?? 0} opportunities`} percentage={(crm?.metrics.activeOpportunityCount ?? 0) > 0 ? 100 : 25} onOpen={() => onNavigate('crm')} />
          <ReadinessRow label="Order commitments" value={`${sales?.metrics.activeOrderCount ?? 0} active orders`} percentage={(sales?.metrics.activeOrderCount ?? 0) > 0 ? 100 : 25} onOpen={() => onNavigate('sales')} />
          <ReadinessRow label="Inventory availability" value={`${inventory?.totals.skuCount ?? 0} stocked SKUs`} percentage={(inventory?.totals.quantityBase ?? 0) > 0 ? 100 : 25} onOpen={() => onNavigate('inventory')} />
        </article>
      </div>

      <div className="workspace-heading compact-heading"><div><span className="eyebrow">Capability launcher</span><h2>Tenant modules</h2><p>Entitlements come from the authenticated session. Disabled modules remain unavailable in both navigation and API access.</p></div><button className="ghost-button" type="button" onClick={() => onNavigate('governance')}>Open governance</button></div>
      <div className="capability-grid">{modules.map((module, index) => <ModuleCard module={module} index={index} onNavigate={onNavigate} key={module.key} />)}</div>
      {enabledModules.length === 0 && <div className="inline-problem"><strong>No business modules are enabled</strong><span>Use a maker-checker entitlement request to activate tenant capabilities.</span></div>}
    </section>
  );
}

function ModuleCard({ module, index, onNavigate }: { module: ModuleEntitlement; index: number; onNavigate: (workspace: TargetWorkspace) => void }) {
  const target: TargetWorkspace | null = module.key === 'crm' ? 'crm' : module.key === 'sales' ? 'sales' : module.key === 'inventory' ? 'inventory' : module.key === 'master-data' ? 'catalog' : module.key === 'platform' ? 'governance' : null;
  return <article className={`capability-card ${module.enabled ? '' : 'disabled-capability'}`}><div className="capability-top"><span className="capability-icon">{String(index + 1).padStart(2, '0')}</span><span className={`delivery-chip ${module.enabled ? module.status : 'planned'}`}>{module.enabled ? module.status : 'disabled'}</span></div><h3>{module.label}</h3><p>{module.description}</p><div className="capability-footer"><strong>Version {module.version}</strong><button type="button" aria-label={`Open ${module.label}`} disabled={!module.enabled || !target} onClick={() => target && onNavigate(target)}>{target && module.enabled ? '→' : '—'}</button></div></article>;
}

function ReadinessRow({ label, value, percentage, onOpen }: { label: string; value: string; percentage: number; onOpen: () => void }) {
  return <button className="readiness-row" type="button" onClick={onOpen}><div><strong>{label}</strong><small>{value}</small></div><div className="channel-track"><i style={{ width: `${percentage}%` }} /></div><span>{percentage}%</span></button>;
}

function buildAlerts(input: { nearExpiry: number; expired: number; quarantine: number; pendingApprovals: number; overdueTasks: number; acceptedQuotes: number; products: number; warehouses: number; parties: number }): OperationalAlert[] {
  const alerts: OperationalAlert[] = [];
  if (input.overdueTasks > 0) alerts.push({ severity: 'critical', title: `${input.overdueTasks} commercial follow-ups are overdue`, detail: 'Account and opportunity actions need immediate ownership.', action: 'Open CRM queue', workspace: 'crm' });
  if (input.acceptedQuotes > 0) alerts.push({ severity: 'warning', title: `${input.acceptedQuotes} accepted quotations await allocation`, detail: 'Convert accepted terms into warehouse-backed sales orders.', action: 'Allocate orders', workspace: 'sales' });
  if (input.expired > 0) alerts.push({ severity: 'critical', title: `${input.expired.toLocaleString()} base units are expired`, detail: 'Review allocation blocks and disposition before further warehouse activity.', action: 'Open aging', workspace: 'inventory' });
  if (input.nearExpiry > 0) alerts.push({ severity: 'warning', title: `${input.nearExpiry.toLocaleString()} base units are near expiry`, detail: 'Use FEFO planning to prioritize the earliest eligible lots.', action: 'Plan FEFO', workspace: 'inventory' });
  if (input.quarantine > 0) alerts.push({ severity: 'warning', title: `${input.quarantine.toLocaleString()} base units remain in quarantine`, detail: 'Quality disposition is required before this stock can be allocated.', action: 'Review stock', workspace: 'inventory' });
  if (input.pendingApprovals > 0) alerts.push({ severity: 'info', title: `${input.pendingApprovals} approval requests are pending`, detail: 'Independent decisions may be blocking protected changes.', action: 'Open inbox', workspace: 'governance' });
  if (input.products === 0) alerts.push({ severity: 'critical', title: 'The tenant catalog is empty', detail: 'Products and SKUs are required before pricing or stock receipt.', action: 'Create product', workspace: 'catalog' });
  if (input.warehouses === 0) alerts.push({ severity: 'critical', title: 'No warehouse is configured', detail: 'Create a warehouse before sales orders can reserve inventory.', action: 'Create warehouse', workspace: 'catalog' });
  if (input.parties === 0) alerts.push({ severity: 'info', title: 'No suppliers or channel partners exist', detail: 'Create parties to connect receiving and commercial workflows.', action: 'Create party', workspace: 'catalog' });
  return alerts;
}

function formatMoney(valueMinor: number, currencyCode: string): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode, maximumFractionDigits: 0 }).format(valueMinor / 100);
}
