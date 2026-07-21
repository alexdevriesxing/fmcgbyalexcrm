import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type {
  AcceptInvitationResponse,
  CreateInvitationResponse,
  OnboardTenantResponse,
  ProblemDetails,
  SessionContextResponse,
  TenantAdministrationResponse,
  TenantOptionsResponse,
  UpdateMembershipResponse
} from '@fmcgbyalex/contracts';

describe('tenant administration', () => {
  it('onboards a company, invites a user and applies role-based access', async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const adminSubject = `admin-${suffix}`;
    const adminEmail = `admin-${suffix}@example.com`;
    const invitedSubject = `operator-${suffix}`;
    const invitedEmail = `operator-${suffix}@example.com`;

    const onboarding = await SELF.fetch(
      'https://api.example/v1/onboarding/tenant',
      {
        method: 'POST',
        headers: identityHeaders(adminSubject, adminEmail, 'Alex Admin', {
          'Content-Type': 'application/json',
          'Idempotency-Key': `onboard-${suffix}`
        }),
        body: JSON.stringify({
          tenantName: `FMCG Test ${suffix}`,
          tenantSlug: `fmcg-test-${suffix}`,
          adminDisplayName: 'Alex Admin',
          defaultCurrency: 'EUR',
          defaultLocale: 'en-NL',
          defaultTimezone: 'Europe/Amsterdam'
        })
      }
    );
    expect(onboarding.status).toBe(201);
    const onboarded = await onboarding.json<OnboardTenantResponse>();

    const replay = await SELF.fetch(
      'https://api.example/v1/onboarding/tenant',
      {
        method: 'POST',
        headers: identityHeaders(adminSubject, adminEmail, 'Alex Admin', {
          'Content-Type': 'application/json',
          'Idempotency-Key': `onboard-${suffix}`
        }),
        body: JSON.stringify({
          tenantName: `FMCG Test ${suffix}`,
          tenantSlug: `fmcg-test-${suffix}`,
          adminDisplayName: 'Alex Admin',
          defaultCurrency: 'EUR',
          defaultLocale: 'en-NL',
          defaultTimezone: 'Europe/Amsterdam'
        })
      }
    );
    expect(replay.status).toBe(200);
    expect((await replay.json<OnboardTenantResponse>()).replayed).toBe(true);

    const options = await SELF.fetch('https://api.example/v1/tenant-options', {
      headers: identityHeaders(adminSubject, adminEmail, 'Alex Admin')
    });
    const optionBody = await options.json<TenantOptionsResponse>();
    expect(options.status).toBe(200);
    expect(optionBody.tenants).toHaveLength(1);
    expect(optionBody.tenants[0]?.id).toBe(onboarded.tenantId);

    const initialAccess = await SELF.fetch('https://api.example/v1/admin/access', {
      headers: identityHeaders(adminSubject, adminEmail, 'Alex Admin', {
        'X-Tenant-Id': onboarded.tenantId
      })
    });
    const initialAccessBody = await initialAccess.json<TenantAdministrationResponse>();
    expect(initialAccess.status).toBe(200);
    expect(initialAccessBody.roles.map((role) => role.key)).toEqual(
      expect.arrayContaining(['tenant-admin', 'operator', 'viewer'])
    );
    expect(initialAccessBody.memberships).toHaveLength(1);

    const invitationResponse = await SELF.fetch(
      'https://api.example/v1/admin/invitations',
      {
        method: 'POST',
        headers: identityHeaders(adminSubject, adminEmail, 'Alex Admin', {
          'Content-Type': 'application/json',
          'Idempotency-Key': `invite-${suffix}`,
          'X-Tenant-Id': onboarded.tenantId
        }),
        body: JSON.stringify({
          email: invitedEmail,
          displayName: 'Field Operator',
          roleKeys: ['operator']
        })
      }
    );
    expect(invitationResponse.status).toBe(201);
    const invitation = await invitationResponse.json<CreateInvitationResponse>();
    expect(invitation.invitation.roles).toEqual(['operator']);
    expect(invitation.acceptanceToken.length).toBeGreaterThan(30);

    const wrongEmailAcceptance = await SELF.fetch(
      'https://api.example/v1/invitations/accept',
      {
        method: 'POST',
        headers: identityHeaders(invitedSubject, `wrong-${invitedEmail}`, 'Field Operator', {
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({ token: invitation.acceptanceToken })
      }
    );
    expect(wrongEmailAcceptance.status).toBe(403);

    const acceptanceResponse = await SELF.fetch(
      'https://api.example/v1/invitations/accept',
      {
        method: 'POST',
        headers: identityHeaders(invitedSubject, invitedEmail, 'Field Operator', {
          'Content-Type': 'application/json'
        }),
        body: JSON.stringify({ token: invitation.acceptanceToken })
      }
    );
    expect(acceptanceResponse.status).toBe(200);
    const acceptance = await acceptanceResponse.json<AcceptInvitationResponse>();
    expect(acceptance.tenant.id).toBe(onboarded.tenantId);
    expect(acceptance.roles).toEqual(['operator']);

    const operatorSessionResponse = await SELF.fetch(
      'https://api.example/v1/session',
      {
        headers: identityHeaders(invitedSubject, invitedEmail, 'Field Operator', {
          'X-Tenant-Id': onboarded.tenantId
        })
      }
    );
    const operatorSession = await operatorSessionResponse.json<SessionContextResponse>();
    expect(operatorSessionResponse.status).toBe(200);
    expect(operatorSession.roles).toEqual(['operator']);
    expect(operatorSession.permissions).toContain('platform.memberships.read');
    expect(operatorSession.permissions).not.toContain('platform.memberships.manage');

    const deniedInvite = await SELF.fetch(
      'https://api.example/v1/admin/invitations',
      {
        method: 'POST',
        headers: identityHeaders(invitedSubject, invitedEmail, 'Field Operator', {
          'Content-Type': 'application/json',
          'Idempotency-Key': `denied-${suffix}`,
          'X-Tenant-Id': onboarded.tenantId
        }),
        body: JSON.stringify({
          email: `another-${suffix}@example.com`,
          roleKeys: ['viewer']
        })
      }
    );
    expect(deniedInvite.status).toBe(403);

    const refreshedAccess = await SELF.fetch('https://api.example/v1/admin/access', {
      headers: identityHeaders(adminSubject, adminEmail, 'Alex Admin', {
        'X-Tenant-Id': onboarded.tenantId
      })
    });
    const refreshed = await refreshedAccess.json<TenantAdministrationResponse>();
    expect(refreshed.memberships).toHaveLength(2);
    expect(refreshed.invitations[0]?.status).toBe('accepted');

    const updatedResponse = await SELF.fetch(
      `https://api.example/v1/admin/members/${acceptance.userId}`,
      {
        method: 'PATCH',
        headers: identityHeaders(adminSubject, adminEmail, 'Alex Admin', {
          'Content-Type': 'application/json',
          'Idempotency-Key': `member-${suffix}`,
          'X-Tenant-Id': onboarded.tenantId
        }),
        body: JSON.stringify({ status: 'active', roleKeys: ['viewer'] })
      }
    );
    expect(updatedResponse.status).toBe(200);
    const updated = await updatedResponse.json<UpdateMembershipResponse>();
    expect(updated.membership.roles).toEqual(['viewer']);

    const protectLastAdmin = await SELF.fetch(
      `https://api.example/v1/admin/members/${onboarded.userId}`,
      {
        method: 'PATCH',
        headers: identityHeaders(adminSubject, adminEmail, 'Alex Admin', {
          'Content-Type': 'application/json',
          'Idempotency-Key': `protect-${suffix}`,
          'X-Tenant-Id': onboarded.tenantId
        }),
        body: JSON.stringify({ status: 'active', roleKeys: ['viewer'] })
      }
    );
    const protectionProblem = await protectLastAdmin.json<ProblemDetails>();
    expect(protectLastAdmin.status).toBe(409);
    expect(protectionProblem.type).toBe(
      'https://fmcgbyalex.com/problems/last-administrator-protected'
    );
  });
});

function identityHeaders(
  subject: string,
  email: string,
  displayName: string,
  extra: Record<string, string> = {}
): HeadersInit {
  return {
    'X-Dev-Identity-Subject': subject,
    'X-Dev-Identity-Email': email,
    'X-Dev-Identity-Name': displayName,
    ...extra
  };
}
