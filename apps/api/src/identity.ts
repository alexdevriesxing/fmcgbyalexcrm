import {
  createRemoteJWKSet,
  errors as joseErrors,
  jwtVerify,
  type JWTVerifyGetKey
} from 'jose';
import {
  PlatformHttpError,
  resolveSession,
  type ResolvedSession
} from './platform';

const BEARER_PATTERN = /^Bearer ([A-Za-z0-9._~-]+)$/;
const SUBJECT_MAX_LENGTH = 200;
const EMAIL_MAX_LENGTH = 254;
const DISPLAY_NAME_MAX_LENGTH = 120;
const MAX_JWKS_CACHES = 4;
const SAFE_ALGORITHMS = new Set(['RS256', 'PS256', 'ES256', 'EdDSA']);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const remoteJwksCaches = new Map<string, JWTVerifyGetKey>();

export type AuthenticatedIdentity = Readonly<{
  subject: string;
  mode: 'development' | 'oidc';
  email?: string;
  displayName?: string;
}>;

export async function resolveAuthenticatedIdentity(
  request: Request,
  env: Env
): Promise<AuthenticatedIdentity> {
  if (env.ENVIRONMENT === 'development' && env.AUTH_MODE === 'development') {
    const subject =
      request.headers.get('X-Dev-Identity-Subject')?.trim() ||
      env.DEVELOPMENT_IDENTITY_SUBJECT.trim();
    validateSubject(subject);

    const email = normalizeEmail(request.headers.get('X-Dev-Identity-Email'));
    const displayName = normalizeDisplayName(
      request.headers.get('X-Dev-Identity-Name')
    );

    return withOptionalClaims({ subject, mode: 'development' }, email, displayName);
  }

  if (env.AUTH_MODE !== 'oidc') {
    throw identityUnavailable();
  }

  const issuer = normalizeIssuer(env.OIDC_ISSUER);
  const jwksUri = validateHttpsUrl(env.OIDC_JWKS_URI, 'OIDC_JWKS_URI');
  const audiences = parseRequiredList(env.OIDC_AUDIENCE, 'OIDC_AUDIENCE');
  const algorithms = parseAlgorithms(env.OIDC_ALGORITHMS);
  const token = readBearerToken(request);

  try {
    const { payload } = await jwtVerify(token, getRemoteJwks(jwksUri), {
      issuer,
      audience: audiences,
      algorithms,
      requiredClaims: ['sub', 'exp', 'iat'],
      clockTolerance: 5
    });
    validateSubject(payload.sub);

    const email =
      payload.email_verified === true && typeof payload.email === 'string'
        ? normalizeEmail(payload.email)
        : undefined;
    const displayName = normalizeDisplayName(
      typeof payload.name === 'string'
        ? payload.name
        : typeof payload.preferred_username === 'string'
          ? payload.preferred_username
          : undefined
    );

    return withOptionalClaims({ subject: payload.sub, mode: 'oidc' }, email, displayName);
  } catch (error) {
    if (
      error instanceof PlatformHttpError ||
      error instanceof joseErrors.JOSEError ||
      error instanceof TypeError ||
      error instanceof RangeError
    ) {
      if (error instanceof PlatformHttpError) {
        throw error;
      }
      throw authenticationRequired('The bearer token is invalid or expired.');
    }
    throw error;
  }
}

export async function resolveAuthenticatedSession(
  env: Env,
  request: Request,
  correlationId: string
): Promise<ResolvedSession> {
  const identity = await resolveAuthenticatedIdentity(request, env);

  if (identity.mode === 'development') {
    return resolveSession(env, request, correlationId);
  }

  // Membership resolution accepts only an already-verified subject. The bound
  // request overwrites all client-controlled development identity input and
  // removes the bearer credential before entering the platform layer.
  const headers = new Headers(request.headers);
  headers.delete('Authorization');
  headers.set('X-Dev-Identity-Subject', identity.subject);
  const identityBoundRequest = new Request(request.url, {
    method: request.method,
    headers
  });
  const identityBoundEnv: Env = {
    ...env,
    ENVIRONMENT: 'development',
    AUTH_MODE: 'development',
    DEVELOPMENT_IDENTITY_SUBJECT: identity.subject
  };

  return resolveSession(identityBoundEnv, identityBoundRequest, correlationId);
}

export function clearIdentityCachesForTests(): void {
  remoteJwksCaches.clear();
}

function getRemoteJwks(uri: URL): JWTVerifyGetKey {
  const key = uri.toString();
  const cached = remoteJwksCaches.get(key);
  if (cached) {
    return cached;
  }

  if (remoteJwksCaches.size >= MAX_JWKS_CACHES) {
    const oldest = remoteJwksCaches.keys().next().value;
    if (typeof oldest === 'string') {
      remoteJwksCaches.delete(oldest);
    }
  }

  const jwks = createRemoteJWKSet(uri, {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000
  });
  remoteJwksCaches.set(key, jwks);
  return jwks;
}

function readBearerToken(request: Request): string {
  const authorization = request.headers.get('Authorization')?.trim() ?? '';
  const match = BEARER_PATTERN.exec(authorization);
  if (!match?.[1]) {
    throw authenticationRequired('Provide an Authorization: Bearer token header.');
  }
  return match[1];
}

function parseAlgorithms(value: string): string[] {
  const configured = parseRequiredList(value, 'OIDC_ALGORITHMS');
  if (configured.some((algorithm) => !SAFE_ALGORITHMS.has(algorithm))) {
    throw identityUnavailable();
  }
  return configured;
}

function parseRequiredList(value: string, name: string): string[] {
  const values = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  if (values.length === 0) {
    throw new PlatformHttpError({
      status: 503,
      type: 'https://fmcgbyalex.com/problems/identity-provider-unavailable',
      title: 'Identity provider is not configured',
      detail: `${name} is required when AUTH_MODE is oidc.`
    });
  }
  return values;
}

function normalizeIssuer(value: string): string {
  const issuer = validateHttpsUrl(value, 'OIDC_ISSUER');
  return issuer.toString().replace(/\/$/, '');
}

function validateHttpsUrl(value: string, name: string): URL {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
      throw new Error('unsafe URL');
    }
    return url;
  } catch {
    throw new PlatformHttpError({
      status: 503,
      type: 'https://fmcgbyalex.com/problems/identity-provider-unavailable',
      title: 'Identity provider is not configured',
      detail: `${name} must be a valid HTTPS URL.`
    });
  }
}

function validateSubject(subject: string | undefined): asserts subject is string {
  if (!subject || subject.length > SUBJECT_MAX_LENGTH) {
    throw authenticationRequired('The authenticated subject is missing or invalid.');
  }
}

function normalizeEmail(value: string | null | undefined): string | undefined {
  const email = value?.trim().toLowerCase();
  if (!email) {
    return undefined;
  }
  if (email.length > EMAIL_MAX_LENGTH || !EMAIL_PATTERN.test(email)) {
    throw authenticationRequired('The authenticated email claim is invalid.');
  }
  return email;
}

function normalizeDisplayName(value: string | null | undefined): string | undefined {
  const displayName = value?.trim();
  if (!displayName) {
    return undefined;
  }
  return displayName.slice(0, DISPLAY_NAME_MAX_LENGTH);
}

function withOptionalClaims(
  identity: { subject: string; mode: 'development' | 'oidc' },
  email: string | undefined,
  displayName: string | undefined
): AuthenticatedIdentity {
  return {
    ...identity,
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {})
  };
}

function authenticationRequired(detail: string): PlatformHttpError {
  return new PlatformHttpError({
    status: 401,
    type: 'https://fmcgbyalex.com/problems/authentication-required',
    title: 'Authentication required',
    detail
  });
}

function identityUnavailable(): PlatformHttpError {
  return new PlatformHttpError({
    status: 503,
    type: 'https://fmcgbyalex.com/problems/identity-provider-unavailable',
    title: 'Identity provider is not configured',
    detail: 'OIDC issuer, audience, JWKS URI and signing algorithms must be configured.'
  });
}
