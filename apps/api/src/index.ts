import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import type {
  HealthResponse,
  ModuleEntitlement,
  ProblemDetails
} from '@fmcgbyalex/contracts';

type Variables = {
  correlationId: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use('*', secureHeaders());

app.use(
  '/v1/*',
  cors({
    origin: 'http://localhost:5173',
    allowHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposeHeaders: ['X-Correlation-Id'],
    credentials: true,
    maxAge: 600
  })
);

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

app.get('/health', (c) => {
  const response: HealthResponse = {
    service: 'fmcgbyalex-api',
    status: 'ok',
    version: c.env.APP_VERSION,
    timestamp: new Date().toISOString()
  };

  return c.json(response);
});

const modules: ModuleEntitlement[] = [
  {
    key: 'platform',
    enabled: true,
    status: 'foundation',
    label: 'Platform',
    description: 'Tenants, security, workflow, audit and integrations'
  },
  {
    key: 'inventory',
    enabled: true,
    status: 'foundation',
    label: 'Inventory & WMS',
    description: 'Lots, expiry, aging, stock ledger and warehouse execution'
  },
  {
    key: 'sales',
    enabled: true,
    status: 'foundation',
    label: 'Sales',
    description: 'Quotes, orders, pricing, allocation and returns'
  },
  {
    key: 'finance',
    enabled: true,
    status: 'planned',
    label: 'Finance',
    description: 'Accounting, invoicing, AR, AP and reconciliation'
  },
  {
    key: 'crm',
    enabled: true,
    status: 'foundation',
    label: 'CRM',
    description: 'Accounts, contacts, pipeline, activity and service'
  },
  {
    key: 'ecommerce',
    enabled: true,
    status: 'planned',
    label: 'E-commerce',
    description: 'B2B portal, D2C and marketplace orchestration'
  },
  {
    key: 'marketing',
    enabled: true,
    status: 'planned',
    label: 'Marketing',
    description: 'Campaigns, segments, journeys, attribution and ROI'
  }
];

app.get('/v1/modules', (c) => c.json({ data: modules }));

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

  const problem: ProblemDetails = {
    type: 'https://fmcgbyalex.com/problems/internal-error',
    title: 'Unexpected server error',
    status: 500,
    correlationId: c.get('correlationId')
  };

  return c.json(problem, 500);
});

export default app;
