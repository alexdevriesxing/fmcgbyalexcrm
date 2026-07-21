import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type {
  AcceptInvitationResponse,
  ApprovalRequestSummary,
  ApprovalWorkspaceResponse,
  CreateApprovalRequestResponse,
  CreateInvitationResponse,
  OnboardTenantResponse,
  ProblemDetails,
  SessionContextResponse,
  UpsertApprovalPolicyResponse
} from '@fmcgbyalex/contracts';

describe('maker-checker approval execution', () => {
  it('blocks direct changes, prevents self-approval and executes an approved module change', async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const maker = identity(`maker-${suffix}`, `maker-${suffix}@example.com`, 'Module Maker');
    const checker = identity(`checker-${suffix}`, `checker-${suffix}@example.com`, 'Module Checker');
    const tenant = await onboardTenant(maker, suffix);
    await inviteAndAcceptAdmin(maker, checker, tenant.tenantId, `checker-${suffix}`);

    const blockedDirectChange = await SELF.fetch(
      'https://api.example/v1/admin/modules/procurement',
      {
        method: 'PATCH',
        headers: headers(maker, {
          'Content-Type': 'application/json',
          'Idempotency-Key': `direct-${suffix}`,
          'X-Tenant-Id': tenant.tenantId
        }),
        body: JSON.stringify({ enabled: true })
      }
    );
    const blockedProblem = await blockedDirectChange.json<ProblemDetails>();
    expect(blockedDirectChange.status).toBe(409);
    expect(blockedProblem.type).toBe(
      'https://fmcgbyalex.com/problems/approval-required'
    );

    const createResponse = await createModuleApproval(
      maker,
      tenant.tenantId,
      'procurement',
      true,
      `approval-${suffix}`
    );
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json<CreateApprovalRequestResponse>();
    expect(created.request.status).toBe('pending');
    expect(created.request.steps[0]?.selfApprovalAllowed).toBe(false);

    const replayResponse = await createModuleApproval(
      maker,
      tenant.tenantId,
      'procurement',
      true,
      `approval-${suffix}`
    );
    expect(replayResponse.status).toBe(200);
    expect((await replayResponse.json<CreateApprovalRequestResponse>()).replayed).toBe(true);

    const selfDecision = await decide(
      maker,
      tenant.tenantId,
      created.request.id,
      'approve',
      'I requested this change.',
      `self-${suffix}`
    );
    const selfProblem = await selfDecision.json<ProblemDetails>();
    expect(selfDecision.status).toBe(403);
    expect(selfProblem.type).toBe(
      'https://fmcgbyalex.com/problems/self-approval-not-allowed'
    );

    const approvedResponse = await decide(
      checker,
      tenant.tenantId,
      created.request.id,
      'approve',
      'Approved for the procurement rollout.',
      `approve-${suffix}`
    );
    expect(approvedResponse.status).toBe(200);
    const approved = await approvedResponse.json<{ request: ApprovalRequestSummary }>();
    expect(approved.request.status).toBe('approved');
    expect(approved.request.executionStatus).toBe('completed');
    expect(approved.request.steps[0]?.approvedCount).toBe(1);

    const makerSessionResponse = await SELF.fetch('https://api.example/v1/session', {
      headers: headers(maker, { 'X-Tenant-Id': tenant.tenantId })
    });
    const makerSession = await makerSessionResponse.json<SessionContextResponse>();
    expect(makerSessionResponse.status).toBe(200);
    expect(
      makerSession.modules.find((module) => module.key === 'procurement')?.enabled
    ).toBe(true);

    const workspaceResponse = await SELF.fetch('https://api.example/v1/approvals', {
      headers: headers(checker, { 'X-Tenant-Id': tenant.tenantId })
    });
    const workspace = await workspaceResponse.json<ApprovalWorkspaceResponse>();
    expect(workspaceResponse.status).toBe(200);
    expect(workspace.policies.map((policy) => policy.key)).toContain(
      'module-entitlement-change'
    );
    expect(workspace.requests.find((request) => request.id === created.request.id)?.status).toBe(
      'approved'
    );

    const rejectionRequestResponse = await createModuleApproval(
      maker,
      tenant.tenantId,
      'procurement',
      false,
      `reject-request-${suffix}`
    );
    const rejectionRequest = await rejectionRequestResponse.json<CreateApprovalRequestResponse>();
    const rejectedResponse = await decide(
      checker,
      tenant.tenantId,
      rejectionRequest.request.id,
      'reject',
      'Procurement must remain enabled during the rollout.',
      `reject-${suffix}`
    );
    const rejected = await rejectedResponse.json<{ request: ApprovalRequestSummary }>();
    expect(rejected.request.status).toBe('rejected');
    expect(rejected.request.executionStatus).toBe('not-required');

    const unchangedSessionResponse = await SELF.fetch('https://api.example/v1/session', {
      headers: headers(maker, { 'X-Tenant-Id': tenant.tenantId })
    });
    const unchangedSession = await unchangedSessionResponse.json<SessionContextResponse>();
    expect(
      unchangedSession.modules.find((module) => module.key === 'procurement')?.enabled
    ).toBe(true);
  });

  it('supports configurable multi-approver thresholds and sequential execution', async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const maker = identity(`policy-maker-${suffix}`, `policy-maker-${suffix}@example.com`, 'Policy Maker');
    const checkerOne = identity(`checker-one-${suffix}`, `checker-one-${suffix}@example.com`, 'Checker One');
    const checkerTwo = identity(`checker-two-${suffix}`, `checker-two-${suffix}@example.com`, 'Checker Two');
    const tenant = await onboardTenant(maker, `policy-${suffix}`);
    await inviteAndAcceptAdmin(maker, checkerOne, tenant.tenantId, `checker-one-${suffix}`);
    await inviteAndAcceptAdmin(maker, checkerTwo, tenant.tenantId, `checker-two-${suffix}`);

    const policyResponse = await SELF.fetch(
      'https://api.example/v1/admin/approval-policies/module-entitlement-change',
      {
        method: 'PUT',
        headers: headers(maker, {
          'Content-Type': 'application/json',
          'Idempotency-Key': `policy-${suffix}`,
          'X-Tenant-Id': tenant.tenantId
        }),
        body: JSON.stringify({
          displayName: 'Two-person module control',
          resourceType: 'module-entitlement',
          action: 'platform.module-entitlement.set',
          condition: {},
          enabled: true,
          steps: [
            {
              requiredPermission: 'platform.modules.manage',
              minimumApprovers: 2,
              selfApprovalAllowed: false
            }
          ]
        })
      }
    );
    expect(policyResponse.status).toBe(200);
    const policy = await policyResponse.json<UpsertApprovalPolicyResponse>();
    expect(policy.policy.steps[0]?.minimumApprovers).toBe(2);

    const requestResponse = await createModuleApproval(
      maker,
      tenant.tenantId,
      'finance',
      true,
      `finance-${suffix}`
    );
    const approvalRequest = await requestResponse.json<CreateApprovalRequestResponse>();

    const firstDecisionResponse = await decide(
      checkerOne,
      tenant.tenantId,
      approvalRequest.request.id,
      'approve',
      'Finance control review completed.',
      `first-${suffix}`
    );
    const firstDecision = await firstDecisionResponse.json<{ request: ApprovalRequestSummary }>();
    expect(firstDecision.request.status).toBe('pending');
    expect(firstDecision.request.steps[0]?.approvedCount).toBe(1);
    expect(firstDecision.request.executionStatus).toBe('pending');

    const midSessionResponse = await SELF.fetch('https://api.example/v1/session', {
      headers: headers(maker, { 'X-Tenant-Id': tenant.tenantId })
    });
    const midSession = await midSessionResponse.json<SessionContextResponse>();
    expect(midSession.modules.find((module) => module.key === 'finance')?.enabled).toBe(false);

    const secondDecisionResponse = await decide(
      checkerTwo,
      tenant.tenantId,
      approvalRequest.request.id,
      'approve',
      'Second independent review completed.',
      `second-${suffix}`
    );
    const secondDecision = await secondDecisionResponse.json<{ request: ApprovalRequestSummary }>();
    expect(secondDecision.request.status).toBe('approved');
    expect(secondDecision.request.steps[0]?.approvedCount).toBe(2);
    expect(secondDecision.request.executionStatus).toBe('completed');

    const finalSessionResponse = await SELF.fetch('https://api.example/v1/session', {
      headers: headers(maker, { 'X-Tenant-Id': tenant.tenantId })
    });
    const finalSession = await finalSessionResponse.json<SessionContextResponse>();
    expect(finalSession.modules.find((module) => module.key === 'finance')?.enabled).toBe(true);
  });
});

type TestIdentity = {
  subject: string;
  email: string;
  displayName: string;
};

function identity(subject: string, email: string, displayName: string): TestIdentity {
  return { subject, email, displayName };
}

async function onboardTenant(
  admin: TestIdentity,
  suffix: string
): Promise<OnboardTenantResponse> {
  const response = await SELF.fetch('https://api.example/v1/onboarding/tenant', {
    method: 'POST',
    headers: headers(admin, {
      'Content-Type': 'application/json',
      'Idempotency-Key': `onboard-${suffix}`
    }),
    body: JSON.stringify({
      tenantName: `Approval Test ${suffix}`,
      tenantSlug: `approval-test-${suffix}`,
      adminDisplayName: admin.displayName,
      defaultCurrency: 'EUR',
      defaultLocale: 'en-NL',
      defaultTimezone: 'Europe/Amsterdam'
    })
  });
  expect(response.status).toBe(201);
  return response.json<OnboardTenantResponse>();
}

async function inviteAndAcceptAdmin(
  inviter: TestIdentity,
  invitee: TestIdentity,
  tenantId: string,
  key: string
): Promise<AcceptInvitationResponse> {
  const invitationResponse = await SELF.fetch(
    'https://api.example/v1/admin/invitations',
    {
      method: 'POST',
      headers: headers(inviter, {
        'Content-Type': 'application/json',
        'Idempotency-Key': `invite-${key}`,
        'X-Tenant-Id': tenantId
      }),
      body: JSON.stringify({
        email: invitee.email,
        displayName: invitee.displayName,
        roleKeys: ['tenant-admin']
      })
    }
  );
  expect(invitationResponse.status).toBe(201);
  const invitation = await invitationResponse.json<CreateInvitationResponse>();

  const acceptanceResponse = await SELF.fetch(
    'https://api.example/v1/invitations/accept',
    {
      method: 'POST',
      headers: headers(invitee, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ token: invitation.acceptanceToken })
    }
  );
  expect(acceptanceResponse.status).toBe(200);
  return acceptanceResponse.json<AcceptInvitationResponse>();
}

function createModuleApproval(
  actor: TestIdentity,
  tenantId: string,
  moduleKey: string,
  enabled: boolean,
  idempotencyKey: string
): Promise<Response> {
  return SELF.fetch('https://api.example/v1/approvals', {
    method: 'POST',
    headers: headers(actor, {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'X-Tenant-Id': tenantId
    }),
    body: JSON.stringify({
      policyKey: 'module-entitlement-change',
      resourceType: 'module-entitlement',
      resourceId: moduleKey,
      action: 'platform.module-entitlement.set',
      title: `${enabled ? 'Enable' : 'Disable'} ${moduleKey}`,
      description: `Maker-checker request for ${moduleKey}.`,
      payload: { enabled }
    })
  });
}

function decide(
  actor: TestIdentity,
  tenantId: string,
  requestId: string,
  decision: 'approve' | 'reject',
  comment: string,
  idempotencyKey: string
): Promise<Response> {
  return SELF.fetch(`https://api.example/v1/approvals/${requestId}/decisions`, {
    method: 'POST',
    headers: headers(actor, {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'X-Tenant-Id': tenantId
    }),
    body: JSON.stringify({ decision, comment })
  });
}

function headers(
  actor: TestIdentity,
  extra: Record<string, string> = {}
): HeadersInit {
  return {
    'X-Dev-Identity-Subject': actor.subject,
    'X-Dev-Identity-Email': actor.email,
    'X-Dev-Identity-Name': actor.displayName,
    ...extra
  };
}
