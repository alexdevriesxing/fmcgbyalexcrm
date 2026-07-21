import type { CrmTaskSummary, OpportunitySummary } from '@fmcgbyalex/contracts/commercial';
import { useEffect, useMemo, useState } from 'react';
import { useApplication } from '../state/ApplicationProvider';
import { useCommercial } from '../state/CommercialProvider';
import { EmptyState, InlineLoading } from './Modal';
import { CrmDialog, type CrmAction } from './forms/CrmDialog';

type CrmView = 'accounts' | 'pipeline' | 'tasks' | 'activity';
type RequestedCrmAction = Extract<CrmAction, string>;

export function CrmWorkspace({ requestedAction, onActionConsumed }: { requestedAction: RequestedCrmAction | null; onActionConsumed: () => void }) {
  const application = useApplication();
  const commercial = useCommercial();
  const [view, setView] = useState<CrmView>('accounts');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<CrmAction | null>(null);
  const crm = commercial.crm;

  useEffect(() => {
    if (requestedAction) {
      setDialog(requestedAction);
      onActionConsumed();
    }
  }, [requestedAction, onActionConsumed]);

  const normalized = query.trim().toLowerCase();
  const accounts = useMemo(() => (crm?.accounts ?? []).filter((account) =>
    !normalized || [account.code, account.name, account.accountType, account.countryCode]
      .some((value) => value.toLowerCase().includes(normalized))
  ), [crm?.accounts, normalized]);
  const opportunities = useMemo(() => (crm?.opportunities ?? []).filter((opportunity) =>
    !normalized || [opportunity.name, opportunity.accountName, opportunity.stage, opportunity.nextAction ?? '']
      .some((value) => value.toLowerCase().includes(normalized))
  ), [crm?.opportunities, normalized]);
  const tasks = useMemo(() => (crm?.tasks ?? []).filter((task) =>
    !normalized || [task.subject, task.detail ?? '', task.priority, task.status]
      .some((value) => value.toLowerCase().includes(normalized))
  ), [crm?.tasks, normalized]);
  const activities = useMemo(() => (crm?.recentActivities ?? []).filter((activity) =>
    !normalized || [activity.subject, activity.body ?? '', activity.activityType]
      .some((value) => value.toLowerCase().includes(normalized))
  ), [crm?.recentActivities, normalized]);

  const canManageAccounts = application.hasPermission('crm.accounts.manage');
  const canManageActivities = application.hasPermission('crm.activities.manage');
  const canManagePipeline = application.hasPermission('crm.pipeline.manage');
  const currencyCode = application.session?.tenant.defaultCurrency ?? 'EUR';

  return (
    <section className="workspace-stack" aria-labelledby="crm-title">
      <div className="workspace-heading">
        <div><span className="eyebrow">Customer relationship management</span><h2 id="crm-title">Commercial relationship cockpit</h2><p>Coordinate account ownership, contact history, disciplined follow-up and weighted opportunities in one tenant-safe workspace.</p></div>
        <div className="action-cluster">
          <button className="ghost-button" type="button" onClick={() => exportCrmCsv(crm)} disabled={!crm}>Export CRM</button>
          {canManageActivities && <button className="ghost-button" type="button" onClick={() => setDialog('task')}>New follow-up</button>}
          {canManagePipeline && <button className="ghost-button" type="button" onClick={() => setDialog('opportunity')}>New opportunity</button>}
          {canManageAccounts && <button className="primary-button" type="button" onClick={() => setDialog('account')}>New account</button>}
        </div>
      </div>

      {commercial.loading && !crm ? <InlineLoading label="Loading CRM accounts, pipeline and follow-ups" /> : (
        <>
          <div className="metric-strip commercial-metrics">
            <article><span>Active accounts</span><strong>{crm?.metrics.accountCount.toLocaleString() ?? '0'}</strong><small>Prospects, customers and channel partners</small></article>
            <article><span>Open pipeline</span><strong>{formatMoney(crm?.metrics.pipelineMinor ?? 0, currencyCode)}</strong><small>{crm?.metrics.activeOpportunityCount ?? 0} active opportunities</small></article>
            <article><span>Weighted pipeline</span><strong>{formatMoney(crm?.metrics.weightedPipelineMinor ?? 0, currencyCode)}</strong><small>Probability-adjusted commercial value</small></article>
            <article className={(crm?.metrics.overdueTaskCount ?? 0) > 0 ? 'metric-risk' : ''}><span>Overdue follow-ups</span><strong>{crm?.metrics.overdueTaskCount ?? 0}</strong><small>{crm?.metrics.dueSoonTaskCount ?? 0} additional tasks due within 7 days</small></article>
          </div>

          <div className="segmented-control" role="tablist" aria-label="CRM views">
            <Tab active={view === 'accounts'} onClick={() => setView('accounts')} label="Accounts & contacts" />
            <Tab active={view === 'pipeline'} onClick={() => setView('pipeline')} label="Opportunity pipeline" />
            <Tab active={view === 'tasks'} onClick={() => setView('tasks')} label="Follow-up queue" />
            <Tab active={view === 'activity'} onClick={() => setView('activity')} label="Activity history" />
          </div>

          <div className="filter-bar commercial-filter">
            <label className="search-field"><span className="sr-only">Search CRM</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search accounts, opportunities, tasks or interactions" /></label>
            <span className="result-count">{view === 'accounts' ? accounts.length : view === 'pipeline' ? opportunities.length : view === 'tasks' ? tasks.length : activities.length} records</span>
            <button className="ghost-button compact" type="button" onClick={() => void commercial.refresh()} disabled={commercial.refreshing}>{commercial.refreshing ? 'Refreshing…' : 'Refresh'}</button>
          </div>

          {view === 'accounts' && <AccountsView accounts={accounts} canManage={canManageAccounts} onContact={() => setDialog('contact')} onActivity={() => setDialog('activity')} />}
          {view === 'pipeline' && <PipelineView opportunities={opportunities} currencyCode={currencyCode} canManage={canManagePipeline} onStage={(opportunity) => setDialog({ type: 'stage', opportunity })} />}
          {view === 'tasks' && <TasksView tasks={tasks} canManage={canManageActivities} onComplete={(task) => void commercial.completeTask(task.id)} />}
          {view === 'activity' && <ActivityView activities={activities} crm={crm} />}
        </>
      )}

      {dialog && <CrmDialog action={dialog} onClose={() => setDialog(null)} />}
    </section>
  );
}

function AccountsView({ accounts, canManage, onContact, onActivity }: { accounts: NonNullable<ReturnType<typeof useCommercial>['crm']>['accounts']; canManage: boolean; onContact: () => void; onActivity: () => void }) {
  if (accounts.length === 0) return <EmptyState title="No CRM accounts yet" detail="Create the first prospect, customer, distributor or retailer account to start the commercial history." action={canManage ? <button className="primary-button" type="button" onClick={onContact}>Add account contact after creating an account</button> : undefined} />;
  return <div className="account-card-grid">{accounts.map((account) => <article className="account-card" key={account.id}><div className="account-card-top"><span className="account-monogram">{initials(account.name)}</span><div><span className="mono-copy">{account.code}</span><h3>{account.name}</h3><small>{account.accountType} · {account.countryCode} · {account.currencyCode}</small></div><span className={`member-state ${account.status}`}>{account.status}</span></div><dl><div><dt>Contacts</dt><dd>{account.contactCount}</dd></div><div><dt>Open opportunities</dt><dd>{account.openOpportunityCount}</dd></div><div><dt>Pipeline</dt><dd>{formatMoney(account.openPipelineMinor, account.currencyCode)}</dd></div><div><dt>Next follow-up</dt><dd>{account.nextTaskDueAt ? formatDateTime(account.nextTaskDueAt) : 'Not scheduled'}</dd></div></dl>{canManage && <div className="card-actions"><button className="ghost-button compact" type="button" onClick={onContact}>Add contact</button><button className="ghost-button compact" type="button" onClick={onActivity}>Log activity</button></div>}</article>)}</div>;
}

function PipelineView({ opportunities, currencyCode, canManage, onStage }: { opportunities: OpportunitySummary[]; currencyCode: string; canManage: boolean; onStage: (opportunity: OpportunitySummary) => void }) {
  const stages: OpportunitySummary['stage'][] = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
  if (opportunities.length === 0) return <EmptyState title="No opportunities in the pipeline" detail="Create an opportunity to track expected value, probability, next action and expected close date." />;
  return <div className="pipeline-board">{stages.map((stage) => { const items = opportunities.filter((item) => item.stage === stage); return <section className="pipeline-column" key={stage}><header><div><span className={`stage-dot ${stage}`} /><strong>{capitalize(stage)}</strong></div><span>{items.length}</span></header><div>{items.map((opportunity) => <article key={opportunity.id}><span className="eyebrow">{opportunity.accountName}</span><h4>{opportunity.name}</h4><strong>{formatMoney(opportunity.expectedValueMinor, opportunity.currencyCode || currencyCode)}</strong><small>{opportunity.probabilityBasisPoints / 100}% · weighted {formatMoney(opportunity.weightedValueMinor, opportunity.currencyCode)}</small><p>{opportunity.nextAction ?? 'No next action recorded'}</p><footer><span>{opportunity.expectedCloseDate ? formatDate(opportunity.expectedCloseDate) : 'No close date'}</span>{canManage && <button type="button" onClick={() => onStage(opportunity)}>Update →</button>}</footer></article>)}</div></section>; })}</div>;
}

function TasksView({ tasks, canManage, onComplete }: { tasks: CrmTaskSummary[]; canManage: boolean; onComplete: (task: CrmTaskSummary) => void }) {
  if (tasks.length === 0) return <EmptyState title="No follow-up tasks" detail="Schedule tasks against accounts or opportunities to maintain commercial discipline." />;
  return <div className="data-panel"><div className="task-list">{tasks.map((task) => <article className={`${task.overdue ? 'overdue' : ''} ${task.dueSoon ? 'due-soon' : ''}`} key={task.id}><span className={`priority-marker ${task.priority}`} /><div><strong>{task.subject}</strong><small>{task.detail ?? 'No additional detail'}</small></div><div><strong>{formatDateTime(task.dueAt)}</strong><small>{task.overdue ? 'Overdue' : task.dueSoon ? 'Due within 7 days' : task.status}</small></div><span className={`commercial-status ${task.status}`}>{task.status}</span>{canManage && task.status === 'open' ? <button className="primary-button compact" type="button" onClick={() => onComplete(task)}>Complete</button> : <span />}</article>)}</div></div>;
}

function ActivityView({ activities, crm }: { activities: NonNullable<ReturnType<typeof useCommercial>['crm']>['recentActivities']; crm: ReturnType<typeof useCommercial>['crm'] }) {
  if (activities.length === 0) return <EmptyState title="No recorded interactions" detail="Log a meeting, call, email or note to establish the account timeline." />;
  const accountNames = new Map((crm?.accounts ?? []).map((account) => [account.id, account.name]));
  const contactNames = new Map((crm?.contacts ?? []).map((contact) => [contact.id, contact.displayName]));
  return <div className="data-panel"><div className="commercial-timeline">{activities.map((activity) => <article key={activity.id}><span className={`timeline-icon ${activity.activityType}`}>{activity.activityType.slice(0, 2).toUpperCase()}</span><div><span className="eyebrow">{accountNames.get(activity.accountId) ?? 'Account'}{activity.contactId ? ` · ${contactNames.get(activity.contactId) ?? 'Contact'}` : ''}</span><h4>{activity.subject}</h4><p>{activity.body ?? 'No notes recorded.'}</p></div><time>{formatDateTime(activity.occurredAt)}</time></article>)}</div></div>;
}

function Tab({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return <button className={active ? 'active' : ''} type="button" role="tab" aria-selected={active} onClick={onClick}>{label}</button>;
}

function exportCrmCsv(crm: ReturnType<typeof useCommercial>['crm']) {
  if (!crm) return;
  const rows = [
    ['Record type', 'Code/ID', 'Name/subject', 'Status/stage', 'Value', 'Due/close date'],
    ...crm.accounts.map((item) => ['Account', item.code, item.name, item.status, String(item.openPipelineMinor), item.nextTaskDueAt ?? '']),
    ...crm.opportunities.map((item) => ['Opportunity', item.id, item.name, item.stage, String(item.expectedValueMinor), item.expectedCloseDate ?? '']),
    ...crm.tasks.map((item) => ['Task', item.id, item.subject, item.status, '', item.dueAt])
  ];
  downloadCsv('crm-commercial-data.csv', rows);
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatMoney(valueMinor: number, currencyCode: string): string { return new Intl.NumberFormat(undefined, { style: 'currency', currency: currencyCode, maximumFractionDigits: 0 }).format(valueMinor / 100); }
function formatDate(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(`${value}T00:00:00`)); }
function formatDateTime(value: string): string { return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function initials(value: string): string { return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join(''); }
function capitalize(value: string): string { return value.charAt(0).toUpperCase() + value.slice(1); }
