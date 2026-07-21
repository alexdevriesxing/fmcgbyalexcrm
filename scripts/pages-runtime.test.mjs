import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve('scripts/render-pages-security.mjs');

test('renders OIDC-only runtime metadata and no-store configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fmcg-pages-runtime-'));
  try {
    const result = spawnSync(process.execPath, [script], {
      cwd: resolve('.'),
      env: {
        ...process.env,
        CF_ENVIRONMENT: 'staging',
        CF_API_BASE_URL: 'https://api-staging.fmcgbyalex.com',
        CF_WEB_BASE_URL: 'https://staging.fmcgbyalex.com',
        CF_WEB_DIST: directory
      },
      encoding: 'utf8'
    });
    assert.equal(result.status, 0, result.stderr);
    const runtime = await readFile(join(directory, 'runtime-config.js'), 'utf8');
    const headers = await readFile(join(directory, '_headers'), 'utf8');
    assert.match(runtime, /"environment":"staging"/);
    assert.match(runtime, /"authenticationMode":"oidc"/);
    assert.match(runtime, /https:\/\/api-staging\.fmcgbyalex\.com/);
    assert.match(headers, /\/runtime-config\.js[\s\S]*Cache-Control: no-store/);
    assert.match(headers, /connect-src 'self' https:\/\/api-staging\.fmcgbyalex\.com/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a missing or invalid environment', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fmcg-pages-runtime-'));
  try {
    const result = spawnSync(process.execPath, [script], {
      cwd: resolve('.'),
      env: {
        ...process.env,
        CF_ENVIRONMENT: 'preview',
        CF_API_BASE_URL: 'https://api-staging.fmcgbyalex.com',
        CF_WEB_BASE_URL: 'https://staging.fmcgbyalex.com',
        CF_WEB_DIST: directory
      },
      encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /CF_ENVIRONMENT must be development, staging or production/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
