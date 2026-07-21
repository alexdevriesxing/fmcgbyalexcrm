import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type {
  DevelopmentBootstrapResponse,
  ProblemDetails,
  SessionContextResponse
} from '@fmcgbyalex/contracts';

describe('tenant isolation', () => {
  it('denies a valid identity selecting another tenant', async () => {
    const alpha = await bootstrapTenant(
      'identity-alpha',
      'Alpha Foods',
      'alpha-foods',
      'alpha@example.com'
    );
    const beta = await bootstrapTenant(
      'identity-beta',
      'Beta Consumer',
      'beta-consumer',
      'beta@example.com'
    );

    const denied = await SELF.fetch('https://api.example/v1/session', {
      headers: {
        'X-Dev-Identity-Subject': 'identity-alpha',
        'X-Tenant-Id': beta.tenantId
      }
    });
    const deniedProblem = await denied.json<ProblemDetails>();

    expect(denied.status).toBe(403);
    expect(deniedProblem.type).toBe(
      'https://fmcgbyalex.com/problems/tenant-selection-required'
    );

    const allowed = await SELF.fetch('https://api.example/v1/session', {
      headers: {
        'X-Dev-Identity-Subject': 'identity-alpha',
        'X-Tenant-Id': alpha.tenantId
      }
    });
    const session = await allowed.json<SessionContextResponse>();

    expect(allowed.status).toBe(200);
    expect(session.tenant.id).toBe(alpha.tenantId);
    expect(session.tenant.id).not.toBe(beta.tenantId);
    expect(session.roles).toContain('tenant-admin');
  });

  it('requires explicit tenant selection for a multi-company identity', async () => {
    await bootstrapTenant(
      'identity-multi',
      'Multi Foods NL',
      'multi-foods-nl',
      'multi@example.com'
    );
    await bootstrapTenant(
      'identity-multi',
      'Multi Foods DE',
      'multi-foods-de',
      'multi@example.com'
    );

    const response = await SELF.fetch('https://api.example/v1/session', {
      headers: { 'X-Dev-Identity-Subject': 'identity-multi' }
    });
    const problem = await response.json<ProblemDetails>();

    expect(response.status).toBe(409);
    expect(problem.type).toBe(
      'https://fmcgbyalex.com/problems/tenant-selection-required'
    );
  });
});

async function bootstrapTenant(
  subject: string,
  tenantName: string,
  tenantSlug: string,
  adminEmail: string
): Promise<DevelopmentBootstrapResponse> {
  const response = await SELF.fetch(
    'https://api.example/v1/development/bootstrap',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Dev-Identity-Subject': subject
      },
      body: JSON.stringify({
        tenantName,
        tenantSlug,
        adminEmail,
        adminDisplayName: tenantName
      })
    }
  );

  expect(response.status).toBe(201);
  return response.json<DevelopmentBootstrapResponse>();
}
