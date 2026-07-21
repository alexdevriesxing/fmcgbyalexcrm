import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve('scripts/render-cloudflare-config.mjs');
const baseEnvironment = {
  ...process.env,
  CF_ENVIRONMENT: 'staging',
  CF_WORKER_NAME: 'fmcgbyalex-api-staging',
  CF_D1_DATABASE_NAME: 'fmcgbyalex-control-staging',
  CF_D1_DATABASE_ID: '11111111-1111-4111-8111-111111111111',
  CF_TENANT_D1_DATABASE_NAME: 'fmcgbyalex-tenant-staging',
  CF_TENANT_D1_DATABASE_ID: '22222222-2222-4222-8222-222222222222',
  CF_KV_NAMESPACE_ID: '1a2b3c4d5e6f708192a3b4c5d6e7f809',
  CF_R2_BUCKET_NAME: 'fmcgbyalex-documents-staging',
  CF_OUTBOX_QUEUE_NAME: 'fmcgbyalex-outbox-staging',
  CF_OUTBOX_DLQ_NAME: 'fmcgbyalex-outbox-dlq-staging',
  CF_CORS_ORIGINS: 'https://staging.fmcgbyalex.com',
  CF_OIDC_ISSUER: 'https://identity.fmcgbyalex.com',
  CF_OIDC_JWKS_URI: 'https://identity.fmcgbyalex.com/.well-known/jwks.json',
  CF_OIDC_AUDIENCE: 'fmcgbyalex-api-staging'
};

test('renders isolated control and tenant Wrangler bindings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fmcg-cloudflare-'));
  const output = join(directory, 'wrangler.json');
  try {
    const result = spawnSync(process.execPath, [script], {
      cwd: resolve('.'),
      env: { ...baseEnvironment, CF_WRANGLER_OUTPUT: output },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(config.name, 'fmcgbyalex-api-staging');
    assert.equal(config.main, 'src/worker.ts');
    assert.equal(config.vars.ENVIRONMENT, 'staging');
    assert.equal(config.vars.AUTH_MODE, 'oidc');
    assert.equal(config.d1_databases[0].binding, 'CONTROL_DB');
    assert.equal(config.d1_databases[1].binding, 'TENANT_DB');
    assert.notEqual(config.d1_databases[0].database_id, config.d1_databases[1].database_id);
    assert.equal(config.queues.producers[0].binding, 'OUTBOX_QUEUE');
    assert.deepEqual(config.secrets.required, ['INVITATION_ENCRYPTION_KEY']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects placeholder production resources', () => {
  const result = spawnSync(process.execPath, [script], {
    cwd: resolve('.'),
    env: {
      ...baseEnvironment,
      CF_ENVIRONMENT: 'production',
      CF_D1_DATABASE_ID: '00000000-0000-0000-0000-000000000000',
      CF_WORKERS_DEV: 'false',
      CF_API_ROUTE_PATTERN: 'api.fmcgbyalex.com/*',
      CF_API_ROUTE_ZONE: 'fmcgbyalex.com'
    },
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /placeholder/i);
});

test('rejects reusing the control database as tenant storage', () => {
  const result = spawnSync(process.execPath, [script], {
    cwd: resolve('.'),
    env: {
      ...baseEnvironment,
      CF_TENANT_D1_DATABASE_ID: baseEnvironment.CF_D1_DATABASE_ID
    },
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be different/i);
});

test('requires explicit production routing posture', () => {
  const result = spawnSync(process.execPath, [script], {
    cwd: resolve('.'),
    env: {
      ...baseEnvironment,
      CF_ENVIRONMENT: 'production',
      CF_WORKERS_DEV: 'true'
    },
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Production must set CF_WORKERS_DEV=false/i);
});
