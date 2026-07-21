import type { ApprovalRequestSummary, InvitationSummary, MembershipSummary } from '@fmcgbyalex/contracts';
import { useEffect, useMemo, useState } from 'react';
import { useApplication } from '../state/ApplicationProvider';
import { EmptyState } from './Modal';
import { GovernanceDialog, type GovernanceAction } from './forms/GovernanceDialog';

export function GovernanceWorkspace({
  requestedAction,
  onActionConsumed
}: {
  requestedAction: 'invite' | null;
  onActionConsumed: () => void;
}) {
  const application = useApplication();
  const [tab, setTab] = useState<'approvals' | 'people'>('approvals');
  const [dialog, setDialog] = useState<GovernanceAction | null>(null);
  const approvals = application.data.approvals?.requests ?? [];
  const policies = application.data.approvals?.policies ?? [];
  const memberships = application.data.administration?.memberships ?? [];
  const invitations = application.data.administration?.invitations ?? [];
  const roles = application.data.administration?.roles ?? [];
  const canDecide = application.hasPermission('platform.approvals.decide');
  const canInvite = application.hasPermission('platform.invitations.manage');
  const canManageMembers = application.hasPermission('platform.memberships.manage');

  useEffect(() => {
    if (requestedAction !== 'invite') return;
    setTab('people');
    setDialog({ type: 'invite' });
    onActionConsumed();
  }, [onActionConsumed, requestedAction]);

  const sortedApprovals = useMemo(
    () => [...approvals].sort((left, right) => approvalRank(left) - approvalRank(right) || Date.parse(right.createdAt) - Date.parse(left.createdAt)),
    [approvals]
  );
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending');
  const activeMembers = memberships.filter((member) => member.status === 'active');
  const pendingInvitations = invitations.filter((invitation) => invitation.status === 'pending');
  const primaryPolicy = policies.find((policy) => policy.enabled) ?? policies[0] ?? null;

  async function revoke(invitation: InvitationSummary) {
    if (!window.confirm(`Revoke the invitation for ${invitation.email}?`)) return;
    try {
      await application.revokeInvitation(invitation.id);
    } catch {
      // The provider renders the structured error notice.
    }
  }

  return (
    <section className="workspace-stack" aria-labelledby="governance-title">
      <div className="workspace-heading">
        <div><span className="eyebrow">Platform governance</span><h2 id="governance-title">Approvals, people and access</h2><p>Live maker-checker requests, tenant memberships, role assignments and invitation controls.</p></div>
        <div className="action-cluster"><button className="ghost-button" type="button" onClick={() => void application.refreshAll()} disabled={application.refreshing}>{application.refreshing ? 'Refreshing…' : 'Refresh governance'}</button><button className="primary-button" type="button" onClick={() => { setTab('people'); setDialog({ type: 'invite' }); }} disabled={!canInvite}>Invite team member</button></div>
      </div>

      <div className="metric-strip governance-metrics">
        <article><span>Waiting for decision</span><strong>{pendingApprovals.length}</strong><small>{pendingApprovals.filter((approval) => approval.requesterUserId === application.session?.user.id).length} requested by you</small></article>
        <article><span>Active members</span><strong>{activeMembers.length}</strong><small>{roles.length} configured roles</small></article>
        <article><span>Pending invitations</span><strong>{pendingInvitations.length}</strong><small>Email-bound acceptance tokens</small></article>
        <article><span>Active policies</span><strong>{policies.filter((policy) => policy.enabled).length}</strong><small>Immutable snapshots on submission</small></article>
      </div>

      <div className="segmented-control" role="tablist" aria-label="Governance views">
        <button className={tab === 'approvals' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'approvals'} onClick={() => setTab('approvals')}>Approval inbox</button>
        <button className={tab === 'people' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'people'} onClick={() => setTab('people')}>People & roles</button>
      </div>

      {tab === 'approvals' ? (
        <div className="governance-layout">
          <article className="data-panel">
            <div className="panel-heading"><div><span className="eyebrow">Maker-checker queue</span><h3>Tenant approval requests</h3></div><span className="result-count">{approvals.length} requests</span></div>
            {sortedApprovals.length === 0 ? <EmptyState title="No approval requests" detail="Policy-protected changes will appear here when a maker submits them." /> : (
              <div className="approval-table">{sortedApprovals.map((approval) => {
                const currentStep = approval.steps.find((step) => step.stepNumber === approval.currentStepNumber);
                const selfApprovalBlocked = approval.requesterUserId === application.session?.user.id && currentStep?.selfApprovalAllowed === false;
                return <article key={approval.id}><div className="approval-main"><span className="mono-tag">{shortId(approval.id)}</span><h4>{approval.title}</h4><small>Requested by {approval.requesterDisplayName} · {relativeTime(approval.createdAt)}</small></div><div><span className="eyebrow">Resource</span><strong>{approval.resourceType} · {approval.resourceId}</strong><small>{approval.currentStepNumber} of {approval.totalSteps} steps</small></div><span className={`risk-chip ${riskLevel(approval).toLowerCase()}`}>{riskLevel(approval)}</span><span className={`approval-state ${approval.status}`}>{approval.status}</span><div className="approval-row-actions">{approval.status === 'pending' ? <button className="primary-button compact" type="button" disabled={!canDecide || selfApprovalBlocked} title={selfApprovalBlocked ? 'This policy blocks self-approval.' : !canDecide ? 'Your role cannot decide approvals.' : undefined} onClick={() => setDialog({ type: 'decision', request: approval })}>{selfApprovalBlocked ? 'Independent checker required' : 'Review'}</button> : <button className="ghost-button compact" type="button" onClick={() => setDialog({ type: 'decision', request: approval })}>Open</button>}</div></article>;
              })}</div>
            )}
          </article>

          <aside className="policy-card">
            <span className="eyebrow">{primaryPolicy ? 'Selected active policy' : 'Approval policy'}</span>
            <h3>{primaryPolicy?.displayName ?? 'No policy configured'}</h3>
            <p>{primaryPolicy ? `Protects ${primaryPolicy.resourceType} changes for action ${primaryPolicy.action}.` : 'Enable a policy to require independent decisions before critical actions execute.'}</p>
            {primaryPolicy && <dl><div><dt>Policy key</dt><dd>{primaryPolicy.key}</dd></div><div><dt>Decision stages</dt><dd>{primaryPolicy.steps.length}</dd></div><div><dt>Total approvers</dt><dd>{primaryPolicy.steps.reduce((total, step) => total + step.minimumApprovers, 0)}</dd></div><div><dt>Self-approval</dt><dd>{primaryPolicy.steps.every((step) => step.selfApprovalAllowed) ? 'Allowed by all steps' : 'Blocked by at least one step'}</dd></div><div><dt>Version</dt><dd>{primaryPolicy.version}</dd></div></dl>}
            <div className="policy-list">{policies.slice(0, 5).map((policy) => <span key={policy.id}><i className={policy.enabled ? 'enabled' : ''} />{policy.displayName}</span>)}</div>
          </aside>
        </div>
      ) : (
        <div className="governance-people-stack">
          <div className="data-panel">
            <div className="panel-heading"><div><span className="eyebrow">Company access</span><h3>Members and assigned roles</h3></div><span className="result-count">{memberships.length} members</span></div>
            {memberships.length === 0 ? <EmptyState title="No members returned" detail="The selected identity needs platform.memberships.read to view tenant access." /> : (
              <div className="people-list">{memberships.map((member) => <MemberRow member={member} canManage={canManageMembers} onManage={() => setDialog({ type: 'member', member })} key={member.userId} />)}</div>
            )}
          </div>

          <div className="data-panel invitation-panel">
            <div className="panel-heading"><div><span className="eyebrow">Pending access</span><h3>Invitations</h3></div><button className="ghost-button compact" type="button" onClick={() => setDialog({ type: 'invite' })} disabled={!canInvite}>New invitation</button></div>
            {invitations.length === 0 ? <EmptyState title="No invitations" detail="Invite a colleague and assign one or more tenant roles." /> : (
              <div className="invitation-list">{invitations.map((invitation) => <article key={invitation.id}><div><strong>{invitation.displayName ?? invitation.email}</strong><small>{invitation.email} · {invitation.roles.join(', ')}</small></div><div><span className={`approval-state ${invitation.status}`}>{invitation.status}</span><small>{invitation.status === 'pending' ? `Expires ${formatDate(invitation.expiresAt)}` : invitation.acceptedAt ? `Accepted ${formatDate(invitation.acceptedAt)}` : 'No longer active'}</small></div>{invitation.status === 'pending' && canInvite ? <button className="text-button danger" type="button" onClick={() => void revoke(invitation)}>Revoke</button> : <span />}</article>)}</div>
            )}
          </div>

          <div className="role-overview-grid">{roles.map((role) => <article key={role.id}><div><span className="role-badge">{role.system ? 'System' : 'Custom'}</span><strong>{role.displayName}</strong><small>{role.key}</small></div><strong>{role.permissions.length}</strong><small>permissions</small></article>)}</div>
        </div>
      )}

      {dialog && <GovernanceDialog action={dialog} onClose={() => setDialog(null)} />}
    </section>
  );
}

function MemberRow({ member, canManage, onManage }: { member: MembershipSummary; canManage: boolean; onManage: () => void }) {
  return <article><span className="avatar">{initials(member.displayName)}</span><div><strong>{member.displayName}</strong><small>{member.email}</small></div><div><strong>{member.roles.join(', ') || 'No roles'}</strong><small>Updated {formatDate(member.updatedAt)}</small></div><span className={`member-state ${member.status === 'suspended' ? 'suspended' : ''}`}>{member.status}</span><button className="row-menu" type="button" aria-label={`Manage ${member.displayName}`} onClick={onManage} disabled={!canManage}>•••</button></article>;
}

function approvalRank(approval: ApprovalRequestSummary): number {
  return approval.status === 'pending' ? 0 : approval.status === 'approved' ? 1 : 2;
}

function riskLevel(approval: ApprovalRequestSummary): 'Critical' | 'High' | 'Medium' {
  if (approval.action.includes('module') || approval.steps.length > 1) return 'Critical';
  if (approval.steps.some((step) => step.minimumApprovers > 1) || approval.action.includes('inventory')) return 'High';
  return 'Medium';
}

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
}

function shortId(value: string): string {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function relativeTime(value: string): string {
  const differenceMinutes = Math.round((Date.now() - Date.parse(value)) / 60_000);
  if (differenceMinutes < 1) return 'just now';
  if (differenceMinutes < 60) return `${differenceMinutes} min ago`;
  const hours = Math.round(differenceMinutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}
