import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const ALLOWED_ENVIRONMENTS = new Set(['development', 'staging', 'production']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX32_PATTERN = /^[0-9a-f]{32}$/i;
const PLACEHOLDER_PATTERNS = [
  /^0+$/,
  /^1+$/,
  /placeholder/i,
  /replace[-_ ]?me/i,
  /example/i,
  /invalid/i,
  /changeme/i
];

const environment = required('CF_ENVIRONMENT').toLowerCase();
if (!ALLOWED_ENVIRONMENTS.has(environment)) {
  fail(`CF_ENVIRONMENT must be one of: ${[...ALLOWED_ENVIRONMENTS].join(', ')}.`);
}

const workerName = safeName(required('CF_WORKER_NAME'), 'CF_WORKER_NAME');
const controlD1Name = safeName(required('CF_D1_DATABASE_NAME'), 'CF_D1_DATABASE_NAME');
const controlD1Id = resourceId(required('CF_D1_DATABASE_ID'), 'CF_D1_DATABASE_ID', UUID_PATTERN);
const tenantD1Name = safeName(required('CF_TENANT_D1_DATABASE_NAME'), 'CF_TENANT_D1_DATABASE_NAME');
const tenantD1Id = resourceId(required('CF_TENANT_D1_DATABASE_ID'), 'CF_TENANT_D1_DATABASE_ID', UUID_PATTERN);
if (controlD1Id === tenantD1Id || controlD1Name === tenantD1Name) {
  fail('Control-plane and tenant data-plane D1 resources must be different.');
}
const kvId = resourceId(required('CF_KV_NAMESPACE_ID'), 'CF_KV_NAMESPACE_ID', HEX32_PATTERN);
const r2Bucket = safeName(required('CF_R2_BUCKET_NAME'), 'CF_R2_BUCKET_NAME');
const outboxQueue = safeName(required('CF_OUTBOX_QUEUE_NAME'), 'CF_OUTBOX_QUEUE_NAME');
const outboxDlq = safeName(required('CF_OUTBOX_DLQ_NAME'), 'CF_OUTBOX_DLQ_NAME');
const corsOrigins = parseOrigins(required('CF_CORS_ORIGINS'));
const oidcIssuer = httpsUrl(required('CF_OIDC_ISSUER'), 'CF_OIDC_ISSUER');
const oidcJwks = httpsUrl(required('CF_OIDC_JWKS_URI'), 'CF_OIDC_JWKS_URI');
const oidcAudience = required('CF_OIDC_AUDIENCE');
const appVersion = process.env.CF_APP_VERSION?.trim() || process.env.GITHUB_SHA?.slice(0, 12) || 'unversioned';
const workersDev = booleanValue(process.env.CF_WORKERS_DEV, environment !== 'production');
const routePattern = optional('CF_API_ROUTE_PATTERN');
const routeZone = optional('CF_API_ROUTE_ZONE');

if ((routePattern && !routeZone) || (!routePattern && routeZone)) {
  fail('CF_API_ROUTE_PATTERN and CF_API_ROUTE_ZONE must be supplied together.');
}
if (environment === 'production' && workersDev) {
  fail('Production must set CF_WORKERS_DEV=false.');
}
if (environment === 'production' && (!routePattern || !routeZone)) {
  fail('Production requires CF_API_ROUTE_PATTERN and CF_API_ROUTE_ZONE.');
}

const config = {
  $schema: 'node_modules/wrangler/config-schema.json',
  name: workerName,
  main: 'src/worker.ts',
  compatibility_date: '2026-07-21',
  compatibility_flags: ['nodejs_compat'],
  workers_dev: workersDev,
  upload_source_maps: true,
  vars: {
    ENVIRONMENT: environment,
    APP_VERSION: appVersion,
    AUTH_MODE: 'oidc',
    CORS_ORIGINS: corsOrigins.join(','),
    DEVELOPMENT_IDENTITY_SUBJECT: '',
    OIDC_ISSUER: oidcIssuer,
    OIDC_AUDIENCE: oidcAudience,
    OIDC_JWKS_URI: oidcJwks,
    OIDC_ALGORITHMS: optional('CF_OIDC_ALGORITHMS') || 'RS256,PS256,ES256,EdDSA',
    SELF_SERVICE_ONBOARDING: optional('CF_SELF_SERVICE_ONBOARDING') || 'disabled',
    OUTBOX_DLQ_NAME: outboxDlq
  },
  secrets: {
    required: ['INVITATION_ENCRYPTION_KEY']
  },
  d1_databases: [
    {
      binding: 'CONTROL_DB',
      database_name: controlD1Name,
      database_id: controlD1Id,
      migrations_dir: '../../database/migrations/control'
    },
    {
      binding: 'TENANT_DB',
      database_name: tenantD1Name,
      database_id: tenantD1Id,
      migrations_dir: '../../database/migrations/tenant'
    }
  ],
  kv_namespaces: [{ binding: 'CONFIG', id: kvId }],
  r2_buckets: [{ binding: 'DOCUMENTS', bucket_name: r2Bucket }],
  queues: {
    producers: [{ binding: 'OUTBOX_QUEUE', queue: outboxQueue }]
  },
  observability: {
    enabled: true,
    head_sampling_rate: environment === 'production' ? 0.25 : 1
  }
};

if (routePattern && routeZone) {
  config.routes = [{ pattern: routePattern, zone_name: routeZone }];
}

const output = resolve(process.env.CF_WRANGLER_OUTPUT || 'apps/api/wrangler.generated.json');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log(`Rendered validated ${environment} Wrangler configuration to ${output}.`);

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required.`);
  return value;
}

function optional(name) {
  return process.env[name]?.trim() || undefined;
}

function resourceId(value, name, pattern) {
  if (isPlaceholder(value) || !pattern.test(value)) {
    fail(`${name} is missing, malformed, or still a placeholder.`);
  }
  return value;
}

function safeName(value, name) {
  if (isPlaceholder(value) || !/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/.test(value)) {
    fail(`${name} must be a real lowercase Cloudflare resource name.`);
  }
  return value;
}

function httpsUrl(value, name) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} must be a valid URL.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || isPlaceholder(url.hostname)) {
    fail(`${name} must be a non-placeholder HTTPS URL without credentials or fragments.`);
  }
  return url.toString().replace(/\/$/, '');
}

function parseOrigins(value) {
  const origins = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  if (origins.length === 0) fail('CF_CORS_ORIGINS must contain at least one origin.');
  for (const origin of origins) {
    const parsed = httpsUrl(origin, 'CF_CORS_ORIGINS');
    if (parsed !== origin.replace(/\/$/, '')) fail(`CORS origin ${origin} must not include a path.`);
    const url = new URL(origin);
    if (url.pathname !== '/' || url.search) fail(`CORS origin ${origin} must not include a path or query.`);
  }
  return origins.map((origin) => origin.replace(/\/$/, ''));
}

function booleanValue(value, fallback) {
  if (value === undefined || value.trim() === '') return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  fail('CF_WORKERS_DEV must be true or false.');
}

function isPlaceholder(value) {
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
}

function fail(message) {
  console.error(`Cloudflare configuration error: ${message}`);
  process.exit(1);
}
