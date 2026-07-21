import type {
  DevelopmentBootstrapRequest,
  HealthResponse,
  ProblemDetails,
  SetModuleEntitlementRequest
} from '@fmcgbyalex/contracts';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import {
  PlatformHttpError,
  bootstrapDevelopmentTenant,
  enforceModule,
  enforcePermission,
  isPlatformHttpError,
  resolveSession,
  setModuleEntitlement,
  type ApiVariables
} from './platform';

const app = new Hono<{ Bindings: Env; Variables: ApiVariables }>();

app.use('*', secureHeaders());
app.use('*', async (c, next) => {
  const incoming = c.req.header('X-Correlation-Id');
  const correlationId =
    incoming && /^[A-Za-z0-9._:-]{8,128}$/.test(incoming)
      ? incoming
      : crypto.randomUUID();

  c.set('correlationId', correlationId);
  c.header('X-Correlation-Id', correlationId);
  await next();
});

app.use(
  '/v1/*',
  cors({
    origin: (origin, c) => {
      const allowedOrigins = c.env.CORS_ORIGINS.split(',')
        .map((value: string) => value.trim())
        .filter(Boolean);
      return allowedOrigins.includes(origin) ? origin : undefined;
    },
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Correlation-Id',
      'X-Tenant-Id',
      'X-Dev-Identity-Subject'
    ],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['X-Correlation-Id'],
    credentials: true,
    maxAge: 600
  })
);

app.get('/health', (c) => {
  const response: HealthResponse = {
    service: 'fmcgbyalex-api',
    status: 'ok',
    version: c.env.APP_VERSION,
    timestamp: new Date().toISOString()
  };
  return c.json(response);
});

app.post('/v1/development/bootstrap', async (c) => {
  const input = await readJson<DevelopmentBootstrapRequest>(c.req.raw);
  const response = await bootstrapDevelopmentTenant(
    c.env,
    c.req.raw,
    c.get('correlationId'),
    input
  );
  return c.json(response, 201);
});

app.use('/v1/*', async (c, next) => {
  if (c.req.path === '/v1/development/bootstrap') {
    await next();
    return;
  }

  const session = await resolveSession(
    c.env,
    c.req.raw,
    c.get('correlationId')
  );
  c.set('session', session);
  await next();
});

app.get('/v1/session', async (c) => {
  const session = c.get('session');
  await enforceModule(
    c.env.CONTROL_DB,
    c.req.raw,
    session,
    'platform',
    'platform.session.read'
  );
  await enforcePermission(
    c.env.CONTROL_DB,
    c.req.raw,
    session,
    'platform.session.read',
    'platform.session.read'
  );
  return c.json(session.response);
});

app.get('/v1/modules', async (c) => {
  const session = c.get('session');
  await enforceModule(
    c.env.CONTROL_DB,
    c.req.raw,
    session,
    'platform',
    'platform.modules.read'
  );
  await enforcePermission(
    c.env.CONTROL_DB,
    c.req.raw,
    session,
    'platform.modules.read',
    'platform.modules.read'
  );
  return c.json({ data: session.response.modules });
});

app.patch('/v1/admin/modules/:moduleKey', async (c) => {
  const input = await readJson<SetModuleEntitlementRequest>(c.req.raw);
  if (typeof input.enabled !== 'boolean') {
    throw new PlatformHttpError({
      status: 400,
      type: 'https://fmcgbyalex.com/problems/validation-error',
      title: 'Request validation failed',
      detail: 'enabled must be a boolean.'
    });
  }

  const response = await setModuleEntitlement(
    c.env,
    c.req.raw,
    c.get('session'),
    c.req.param('moduleKey'),
    input.enabled
  );
  return c.json(response);
});

app.notFound((c) => {
  const problem: ProblemDetails = {
    type: 'https://fmcgbyalex.com/problems/not-found',
    title: 'Resource not found',
    status: 404,
    instance: c.req.path,
    correlationId: c.get('correlationId')
  };
  return c.json(problem, 404);
});

app.onError((error, c) => {
  console.error('request_failed', {
    correlationId: c.get('correlationId'),
    path: c.req.path,
    method: c.req.method,
    errorName: error.name
  });

  if (isPlatformHttpError(error)) {
    const problem: ProblemDetails = {
      type: error.type,
      title: error.title,
      status: error.status,
      correlationId: c.get('correlationId')
    };
    if (error.detail !== undefined) {
      problem.detail = error.detail;
    }
    return c.json(
      problem,
      error.status as 400 | 401 | 403 | 404 | 409 | 415 | 503
    );
  }

  const problem: ProblemDetails = {
    type: 'https://fmcgbyalex.com/problems/internal-error',
    title: 'Unexpected server error',
    status: 500,
    correlationId: c.get('correlationId')
  };
  return c.json(problem, 500);
});

async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new PlatformHttpError({
      status: 415,
      type: 'https://fmcgbyalex.com/problems/unsupported-media-type',
      title: 'Content-Type must be application/json'
    });
  }

  try {
    return (await request.json()) as T;
  } catch {
    throw new PlatformHttpError({
      status: 400,
      type: 'https://fmcgbyalex.com/problems/invalid-json',
      title: 'Request body is not valid JSON'
    });
  }
}

export default app;
