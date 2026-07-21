import type {
  ApprovalDecisionValue,
  ApprovalRequestSummary,
  CreateInvitationResponse,
  MembershipSummary
} from '@fmcgbyalex/contracts';
import { useState, type FormEvent } from 'react';
import { useApplication } from '../../state/ApplicationProvider';
import { Modal } from '../Modal';

export type GovernanceAction =
  | { type: 'invite' }
  | { type: 'decision'; request: ApprovalRequestSummary }
  | { type: 'member'; member: MembershipSummary };

export function GovernanceDialog({ action, onClose }: { action: GovernanceAction; onClose: () => void }) {
  if (action.type === 'invite') return <InviteDialog onClose={onClose} />;
  if (action.type === 'decision') return <DecisionDialog request={action.request} onClose={onClose} />;
  return <MemberDialog member={action.member} onClose={onClose} />;
}

function DecisionDialog({ request, onClose }: { request: ApprovalRequestSummary; onClose: () => void }) {
  const application = useApplication();
  const [decision, setDecision] = useState<ApprovalDecisionValue>('approve');
  const [comment, setComment] = useState('');
  const currentStep = request.steps.find((step) => step.stepNumber === request.currentStepNumber);
  const pending = request.status === 'pending';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pending || (decision === 'reject' && !comment.trim())) return;
    try {
      await application.decideApproval(request.id, {
        decision,
        ...(comment.trim() ? { comment: comment.trim() } : {})
      });
      onClose();
    } catch {
      // The provider renders the structured error notice.
    }
  }

  return (
    <Modal
      eyebrow={pending ? 'Maker-checker decision' : 'Approval audit record'}
      title={request.title}
      description={request.description ?? 'Review the immutable request snapshot and decision history.'}
      onClose={onClose}
      width="wide"
    >
      <div className="approval-review-grid">
        <dl>
          <div><dt>Status</dt><dd><span className={`approval-state ${request.status}`}>{request.status}</span></dd></div>
          <div><dt>Execution</dt><dd>{request.executionStatus}</dd></div>
          <div><dt>Requester</dt><dd>{request.requesterDisplayName}</dd></div>
          <div><dt>Resource</dt><dd>{request.resourceType} · {request.resourceId}</dd></div>
          <div><dt>Action</dt><dd>{request.action}</dd></div>
          <div><dt>Current step</dt><dd>{request.currentStepNumber} of {request.totalSteps}</dd></div>
          <div><dt>Required permission</dt><dd>{currentStep?.requiredPermission ?? 'Policy snapshot'}</dd></div>
          <div><dt>Minimum approvers</dt><dd>{currentStep?.minimumApprovers ?? 1}</dd></div>
          <div><dt>Created</dt><dd>{formatDateTime(request.createdAt)}</dd></div>
          <div><dt>Resolved</dt><dd>{request.resolvedAt ? formatDateTime(request.resolvedAt) : 'Pending'}</dd></div>
        </dl>
        <div className="payload-panel"><span className="eyebrow">Requested payload</span><pre>{JSON.stringify(request.payload, null, 2)}</pre></div>
      </div>

      <div className="approval-history">
        <div className="form-section-heading"><div><span className="eyebrow">Immutable history</span><h3>Policy steps and decisions</h3></div></div>
        {request.steps.map((step) => (
          <article key={step.stepNumber}>
            <div><span className={`approval-state ${step.status}`}>{step.status}</span><strong>Step {step.stepNumber}</strong><small>{step.requiredPermission} · {step.approvedCount}/{step.minimumApprovers} approvals</small></div>
            {step.decisions.length === 0 ? <span className="history-empty">No decision recorded</span> : step.decisions.map((record) => <div className="decision-record" key={record.id}><strong>{record.deciderDisplayName}</strong><span className={`approval-state ${record.decision === 'approve' ? 'approved' : 'rejected'}`}>{record.decision}</span><small>{formatDateTime(record.createdAt)}{record.comment ? ` · ${record.comment}` : ''}</small></div>)}
          </article>
        ))}
      </div>

      {pending ? (
        <form className="operational-form approval-decision-form" onSubmit={(event) => void submit(event)}>
          <div className="decision-toggle" role="radiogroup" aria-label="Approval decision">
            <button className={decision === 'approve' ? 'active approve' : ''} type="button" role="radio" aria-checked={decision === 'approve'} onClick={() => setDecision('approve')}>Approve</button>
            <button className={decision === 'reject' ? 'active reject' : ''} type="button" role="radio" aria-checked={decision === 'reject'} onClick={() => setDecision('reject')}>Reject</button>
          </div>
          <label><span>Decision comment {decision === 'reject' ? '(required)' : '(optional)'}</span><textarea required={decision === 'reject'} rows={4} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Record the business rationale for the immutable audit trail" /></label>
          <div className="form-actions"><button className="ghost-button" type="button" onClick={onClose}>Cancel</button><button className={`primary-button ${decision === 'reject' ? 'danger-button' : ''}`} type="submit" disabled={application.busyAction !== null || (decision === 'reject' && !comment.trim())}>{application.busyAction ?? (decision === 'approve' ? 'Approve request' : 'Reject request')}</button></div>
        </form>
      ) : (
        <div className="form-actions"><button className="primary-button" type="button" onClick={onClose}>Close audit record</button></div>
      )}
    </Modal>
  );
}

function InviteDialog({ onClose }: { onClose: () => void }) {
  const application = useApplication();
  const roles = application.data.administration?.roles ?? [];
  const defaultRole = roles.find((role) => role.key === 'operator')?.key ?? roles[0]?.key ?? '';
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roleKeys, setRoleKeys] = useState<string[]>(defaultRole ? [defaultRole] : []);
  const [created, setCreated] = useState<CreateInvitationResponse | null>(null);
  const [copied, setCopied] = useState(false);

  function toggleRole(roleKey: string) {
    setRoleKeys((current) => current.includes(roleKey) ? current.filter((key) => key !== roleKey) : [...current, roleKey]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const response = await application.inviteMember({
        email: email.trim().toLowerCase(),
        roleKeys,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {})
      });
      setCreated(response);
    } catch {
      // The provider renders the structured error notice.
    }
  }

  async function copyToken() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.acceptanceToken);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal eyebrow="Tenant administration" title={created ? 'Invitation ready' : 'Invite team member'} description={created ? 'The raw acceptance token is shown once. Deliver it through a secure channel.' : 'The invitation is bound to the normalized email address and selected tenant roles.'} onClose={onClose}>
      {created ? (
        <div className="invitation-result">
          <dl><div><dt>Email</dt><dd>{created.invitation.email}</dd></div><div><dt>Roles</dt><dd>{created.invitation.roles.join(', ')}</dd></div><div><dt>Expires</dt><dd>{formatDateTime(created.invitation.expiresAt)}</dd></div></dl>
          <label><span>One-time acceptance token</span><textarea readOnly rows={5} value={created.acceptanceToken} /></label>
          <div className="form-actions"><button className="ghost-button" type="button" onClick={() => void copyToken()}>{copied ? 'Copied' : 'Copy token'}</button><button className="primary-button" type="button" onClick={onClose}>Done</button></div>
        </div>
      ) : (
        <form className="operational-form" onSubmit={(event) => void submit(event)}>
          <div className="form-grid two-column">
            <label><span>Email address</span><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label><span>Display name</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
          </div>
          <fieldset className="role-selector"><legend>Assigned roles</legend>{roles.map((role) => <label key={role.id}><input type="checkbox" checked={roleKeys.includes(role.key)} onChange={() => toggleRole(role.key)} /><span><strong>{role.displayName}</strong><small>{role.permissions.length} permissions · {role.system ? 'System role' : 'Custom role'}</small></span></label>)}</fieldset>
          <div className="form-actions"><button className="ghost-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={application.busyAction !== null || roleKeys.length === 0}>{application.busyAction ?? 'Create invitation'}</button></div>
        </form>
      )}
    </Modal>
  );
}

function MemberDialog({ member, onClose }: { member: MembershipSummary; onClose: () => void }) {
  const application = useApplication();
  const roles = application.data.administration?.roles ?? [];
  const [status, setStatus] = useState<'active' | 'suspended'>(member.status === 'suspended' ? 'suspended' : 'active');
  const [roleKeys, setRoleKeys] = useState<string[]>(member.roles);

  function toggleRole(roleKey: string) {
    setRoleKeys((current) => current.includes(roleKey) ? current.filter((key) => key !== roleKey) : [...current, roleKey]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await application.updateMember(member.userId, { status, roleKeys });
      onClose();
    } catch {
      // The provider renders the structured error notice.
    }
  }

  return (
    <Modal eyebrow="Tenant access" title={`Manage ${member.displayName}`} description="Updates are tenant scoped. The API prevents removal or suspension of the final active administrator." onClose={onClose}>
      <form className="operational-form" onSubmit={(event) => void submit(event)}>
        <div className="member-identity-card"><span className="avatar">{initials(member.displayName)}</span><div><strong>{member.displayName}</strong><small>{member.email}</small></div></div>
        <label><span>Membership status</span><select value={status} onChange={(event) => setStatus(event.target.value as 'active' | 'suspended')}><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
        <fieldset className="role-selector"><legend>Assigned roles</legend>{roles.map((role) => <label key={role.id}><input type="checkbox" checked={roleKeys.includes(role.key)} onChange={() => toggleRole(role.key)} /><span><strong>{role.displayName}</strong><small>{role.permissions.length} permissions</small></span></label>)}</fieldset>
        <div className="form-actions"><button className="ghost-button" type="button" onClick={onClose}>Cancel</button><button className="primary-button" type="submit" disabled={application.busyAction !== null || roleKeys.length === 0}>{application.busyAction ?? 'Save member access'}</button></div>
      </form>
    </Modal>
  );
}

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('');
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}
