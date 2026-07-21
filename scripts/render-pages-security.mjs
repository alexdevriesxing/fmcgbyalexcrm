import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const apiBaseUrl = requiredHttpsUrl('CF_API_BASE_URL');
const webBaseUrl = requiredHttpsUrl('CF_WEB_BASE_URL');
const environment = requiredEnvironment('CF_ENVIRONMENT');
const outputDir = resolve(process.env.CF_WEB_DIST || 'apps/web/dist');
const apiOrigin = new URL(apiBaseUrl).origin;
const webOrigin = new URL(webBaseUrl).origin;

const headers = `/*
  Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ${apiOrigin}; manifest-src 'self'; upgrade-insecure-requests
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-site
  Strict-Transport-Security: max-age=31536000; includeSubDomains

/index.html
  Cache-Control: no-store

/runtime-config.js
  Cache-Control: no-store

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`;

const redirects = '/* /index.html 200\n';
const runtime = `window.__FMCGBYALEX_RUNTIME__ = ${JSON.stringify({
  apiBaseUrl,
  webBaseUrl: webOrigin,
  environment,
  authenticationMode: 'oidc'
})};\n`;

await mkdir(outputDir, { recursive: true });
await Promise.all([
  writeFile(resolve(outputDir, '_headers'), headers),
  writeFile(resolve(outputDir, '_redirects'), redirects),
  writeFile(resolve(outputDir, 'runtime-config.js'), runtime)
]);
console.log(`Rendered Pages security headers and runtime configuration for ${webOrigin}.`);

function requiredHttpsUrl(name) {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required.`);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${name} must be a valid URL.`);
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    fail(`${name} must be an HTTPS URL without credentials or fragments.`);
  }
  return value.replace(/\/$/, '');
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value || !['development', 'staging', 'production'].includes(value)) {
    fail(`${name} must be development, staging or production.`);
  }
  return value;
}

function fail(message) {
  console.error(`Pages security configuration error: ${message}`);
  process.exit(1);
}
