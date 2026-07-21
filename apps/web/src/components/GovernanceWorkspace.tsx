import { useState } from 'react';

const approvals = [
  { id: 'APR-2026-041', title: 'Release quarantined Botanical Sparkling lot', requester: 'Sophie van Dijk', resource: 'QA-00631 · 240 EA', age: '18 min', risk: 'High', status: 'Pending' },
  { id: 'APR-2026-040', title: 'Enable Finance module for NL entity', requester: 'Alex de Vries', resource: 'Module entitlement', age: '1 h', risk: 'Critical', status: 'Pending' },
  { id: 'APR-2026-039', title: 'Inventory count adjustment above threshold', requester: 'Warehouse Manager', resource: 'COUNT-260721-04', age: '3 h', risk: 'High', status: 'Pending' },
  { id: 'APR-2026-038', title: 'Create distributor credit exception', requester: 'Commercial Manager', resource: 'DIST-IND-0142', age: 'Yesterday', risk: 'Medium', status: 'Approved' }
];

const members = [
  { id: 'usr-alex', initials: 'AD', name: 'Alex de Vries', email: 'alex@fmcgbyalex.com', role: 'Tenant Administrator', scope: 'All entities', status: 'Active' },
  { id: 'usr-sophie', initials: 'SV', name: 'Sophie van Dijk', email: 'sophie@example.com', role: 'Business Operator', scope: 'Netherlands', status: 'Active' },
  { id: 'usr-warehouse', initials: 'WM', name: 'Warehouse Manager', email: 'warehouse@example.com', role: 'Business Operator', scope: 'NL warehouses', status: 'Active' },
  { id: 'usr-finance', initials: 'FC', name: 'Finance Controller', email: 'finance@example.com', role: 'Read-only Viewer', scope: 'Netherlands', status: 'Active' }
];

export function GovernanceWorkspace() {
  const [tab, setTab] = useState<'approvals' | 'people'>('approvals');

  return (
    <section className="workspace-stack" aria-labelledby="governance-title">
      <div className="workspace-heading">
        <div><span className="eyebrow">Platform governance</span><h2 id="governance-title">Approvals, people and access</h2><p>Enforce separation of duties, tenant membership, role permissions and immutable administrative audit.</p></div>
        <div className="action-cluster"><button className="ghost-button" type="button">Audit trail</button><button className="primary-button" type="button">Invite team member</button></div>
      </div>

      <div className="metric-strip governance-metrics">
        <article><span>Waiting for decision</span><strong>3</strong><small>Self-approval blocked</small></article>
        <article><span>Active members</span><strong>4</strong><small>Across 3 system roles</small></article>
        <article><span>Authentication</span><strong>OIDC</strong><small>MFA and passkey ready</small></article>
        <article><span>Tenant isolation</span><strong>Enforced</strong><small>Membership checked per request</small></article>
      </div>

      <div className="segmented-control" role="tablist" aria-label="Governance views">
        <button className={tab === 'approvals' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'approvals'} onClick={() => setTab('approvals')}>Approval inbox</button>
        <button className={tab === 'people' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'people'} onClick={() => setTab('people')}>People & roles</button>
      </div>

      {tab === 'approvals' ? (
        <div className="governance-layout">
          <article className="data-panel">
            <div className="panel-heading"><div><span className="eyebrow">Maker-checker queue</span><h3>Requests requiring action</h3></div><button className="ghost-button compact" type="button">Filter queue</button></div>
            <div className="approval-table">
              {approvals.map((approval) => (
                <article key={approval.id}>
                  <div className="approval-main"><span className="mono-tag">{approval.id}</span><h4>{approval.title}</h4><small>Requested by {approval.requester} · {approval.age}</small></div>
                  <div><span className="eyebrow">Resource</span><strong>{approval.resource}</strong></div>
                  <span className={`risk-chip ${approval.risk.toLowerCase()}`}>{approval.risk}</span>
                  <span className={`approval-state ${approval.status.toLowerCase()}`}>{approval.status}</span>
                  <div className="approval-row-actions">{approval.status === 'Pending' ? <><button className="ghost-button compact" type="button">Reject</button><button className="primary-button compact" type="button">Review</button></> : <button className="ghost-button compact" type="button">Open</button>}</div>
                </article>
              ))}
            </div>
          </article>

          <aside className="policy-card">
            <span className="eyebrow">Active policy</span>
            <h3>Inventory status release</h3>
            <p>Quarantined inventory can return to available status only after an independent checker approves the request.</p>
            <dl>
              <div><dt>Required permission</dt><dd>inventory.stock.quarantine</dd></div>
              <div><dt>Approvers</dt><dd>1 independent checker</dd></div>
              <div><dt>Self-approval</dt><dd>Not permitted</dd></div>
              <div><dt>Expiry</dt><dd>7 days</dd></div>
            </dl>
            <button className="ghost-button" type="button">Configure policies</button>
          </aside>
        </div>
      ) : (
        <div className="data-panel">
          <div className="panel-heading"><div><span className="eyebrow">Company access</span><h3>Members and assigned roles</h3></div><button className="ghost-button compact" type="button">Manage roles</button></div>
          <div className="people-list">
            {members.map((member) => (
              <article key={member.id}>
                <span className="avatar">{member.initials}</span>
                <div><strong>{member.name}</strong><small>{member.email}</small></div>
                <div><strong>{member.role}</strong><small>{member.scope}</small></div>
                <span className="member-state">{member.status}</span>
                <button className="row-menu" type="button" aria-label={`Manage ${member.name}`}>•••</button>
              </article>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
