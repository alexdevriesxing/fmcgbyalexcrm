import { fetchMock } from 'cloudflare:test';
import {
  SignJWT,
  exportJWK,
  generateKeyPair
} from 'jose';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  clearIdentityCachesForTests,
  resolveAuthenticatedIdentity
} from '../src/identity';
import { PlatformHttpError } from '../src/platform';

const issuer = 'https://identity.example';
const audience = 'fmcgbyalex-api';
const jwksUri = `${issuer}/.well-known/jwks.json`;

beforeAll(() => {
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
  clearIdentityCachesForTests();
});

afterAll(() => fetchMock.deactivate());

describe('OIDC identity verification', () => {
  it('accepts a signed token and rejects the same token for another audience', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const publicJwk = await exportJWK(publicKey);
    Object.assign(publicJwk, { kid: 'test-key', alg: 'RS256', use: 'sig' });

    fetchMock
      .get(issuer)
      .intercept({ path: '/.well-known/jwks.json', method: 'GET' })
      .reply(200, JSON.stringify({ keys: [publicJwk] }), {
        headers: { 'Content-Type': 'application/json' }
      });

    const token = await new SignJWT({ scope: 'platform.session.read' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setSubject('oidc|alex')
      .setIssuer(issuer)
      .setAudience(audience)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);

    const identity = await resolveAuthenticatedIdentity(
      new Request('https://api.example/v1/session', {
        headers: { Authorization: `Bearer ${token}` }
      }),
      oidcEnv()
    );

    expect(identity).toEqual({ subject: 'oidc|alex', mode: 'oidc' });

    await expect(
      resolveAuthenticatedIdentity(
        new Request('https://api.example/v1/session', {
          headers: { Authorization: `Bearer ${token}` }
        }),
        oidcEnv({ OIDC_AUDIENCE: 'another-api' })
      )
    ).rejects.toMatchObject<Partial<PlatformHttpError>>({ status: 401 });
  });

  it('requires an exact bearer authorization header', async () => {
    await expect(
      resolveAuthenticatedIdentity(
        new Request('https://api.example/v1/session'),
        oidcEnv()
      )
    ).rejects.toMatchObject<Partial<PlatformHttpError>>({ status: 401 });
  });

  it('rejects symmetric or unknown signing algorithms in configuration', async () => {
    await expect(
      resolveAuthenticatedIdentity(
        new Request('https://api.example/v1/session', {
          headers: { Authorization: 'Bearer header.payload.signature' }
        }),
        oidcEnv({ OIDC_ALGORITHMS: 'HS256' })
      )
    ).rejects.toMatchObject<Partial<PlatformHttpError>>({ status: 503 });
  });
});

function oidcEnv(overrides: Partial<Env> = {}): Env {
  return {
    ENVIRONMENT: 'production',
    APP_VERSION: 'test',
    AUTH_MODE: 'oidc',
    CORS_ORIGINS: 'https://app.example',
    DEVELOPMENT_IDENTITY_SUBJECT: '',
    OIDC_ISSUER: issuer,
    OIDC_AUDIENCE: audience,
    OIDC_JWKS_URI: jwksUri,
    OIDC_ALGORITHMS: 'RS256',
    ...overrides
  } as Env;
}
