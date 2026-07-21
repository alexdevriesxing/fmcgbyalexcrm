const apiUrl = requiredUrl('CF_API_BASE_URL');
const webUrl = requiredUrl('CF_WEB_BASE_URL');
const bearerToken = process.env.CF_SMOKE_BEARER_TOKEN?.trim();
const tenantId = process.env.CF_SMOKE_TENANT_ID?.trim();

await checkHealth();
await checkModules();
await checkWeb();
console.log('Cloudflare smoke tests passed.');

async function checkHealth() {
  const response = await fetchWithTimeout(`${apiUrl}/health`);
  if (!response.ok) fail(`/health returned ${response.status}.`);
  const body = await response.json();
  if (body?.status !== 'ok' || body?.service !== 'fmcgbyalex-api') {
    fail('/health returned an unexpected payload.');
  }
}

async function checkModules() {
  const headers = new Headers();
  if (bearerToken) headers.set('Authorization', `Bearer ${bearerToken}`);
  if (tenantId) headers.set('X-Tenant-Id', tenantId);
  const response = await fetchWithTimeout(`${apiUrl}/v1/modules`, { headers });
  if (!bearerToken) {
    if (response.status !== 401) fail(`/v1/modules should reject anonymous access with 401, received ${response.status}.`);
    return;
  }
  if (!response.ok) fail(`/v1/modules authenticated smoke check returned ${response.status}.`);
  const body = await response.json();
  if (!Array.isArray(body?.data)) fail('/v1/modules returned an unexpected payload.');
}

async function checkWeb() {
  const response = await fetchWithTimeout(webUrl, { redirect: 'follow' });
  if (!response.ok) fail(`Web root returned ${response.status}.`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) fail('Web root did not return HTML.');
  const html = await response.text();
  if (!html.includes('FMCG') || !html.includes('root')) fail('Web root did not contain the expected application shell.');
}

async function fetchWithTimeout(url, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    fail(`${url} could not be reached: ${error instanceof Error ? error.message : 'unknown error'}.`);
  } finally {
    clearTimeout(timeout);
  }
}

function requiredUrl(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} must be a valid URL.`);
  }
  if (url.protocol !== 'https:') fail(`${name} must use HTTPS.`);
  return value.replace(/\/$/, '');
}

function fail(message) {
  console.error(`Smoke test failed: ${message}`);
  process.exit(1);
}
