import type { ModuleKey } from '@fmcgbyalex/contracts';
import {
  PlatformHttpError,
  enforceModule,
  enforcePermission,
  type ResolvedSession
} from './platform';

const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,160}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export type DomainReplayRow = {
  request_hash: string;
  response_body: string | null;
};

export async function requireDomainAccess(
  env: Env,
  request: Request,
  session: ResolvedSession,
  moduleKey: ModuleKey,
  permission: string,
  action: string
): Promise<void> {
  await enforceModule(env.CONTROL_DB, request, session, moduleKey, action);
  await enforcePermission(env.CONTROL_DB, request, session, permission, action);
}

export function requireIdempotencyKey(request: Request): string {
  const value = request.headers.get('Idempotency-Key')?.trim() ?? '';
  if (!IDEMPOTENCY_PATTERN.test(value)) {
    throw validationError(
      'Idempotency-Key is required and must contain 8 to 128 letters, numbers, dots, underscores, colons or hyphens.'
    );
  }
  return value;
}

export async function requestHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function readDomainReplay<T>(
  db: D1Database,
  tenantId: string,
  scope: string,
  idempotencyKey: string,
  expectedHash: string
): Promise<T | null> {
  const row = await db.prepare(
    `SELECT request_hash, response_body
     FROM domain_idempotency
     WHERE tenant_id = ?1 AND scope = ?2 AND idempotency_key = ?3
       AND expires_at > ?4`
  )
    .bind(tenantId, scope, idempotencyKey, new Date().toISOString())
    .first<DomainReplayRow>();

  if (!row) return null;
  if (row.request_hash !== expectedHash) {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/idempotency-conflict',
      title: 'Idempotency key was already used with a different request'
    });
  }
  if (!row.response_body) {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/idempotency-in-progress',
      title: 'An equivalent command is already being processed'
    });
  }
  return JSON.parse(row.response_body) as T;
}

export function idempotencyStatement(
  db: D1Database,
  input: {
    tenantId: string;
    scope: string;
    idempotencyKey: string;
    requestHash: string;
    responseStatus: number;
    responseBody: unknown;
    now: string;
  }
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO domain_idempotency (
       tenant_id, scope, idempotency_key, request_hash,
       response_status, response_body, created_at, expires_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
  ).bind(
    input.tenantId,
    input.scope,
    input.idempotencyKey,
    input.requestHash,
    input.responseStatus,
    JSON.stringify(input.responseBody),
    input.now,
    new Date(new Date(input.now).getTime() + IDEMPOTENCY_TTL_MS).toISOString()
  );
}

export function domainAuditStatement(
  db: D1Database,
  session: ResolvedSession,
  input: {
    action: string;
    resourceType: string;
    resourceId?: string;
    metadata?: Record<string, unknown>;
    now: string;
  }
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO domain_audit_events (
       id, tenant_id, actor_user_id, action, resource_type,
       resource_id, outcome, correlation_id, metadata_json, occurred_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'success', ?7, ?8, ?9)`
  ).bind(
    crypto.randomUUID(),
    session.response.tenant.id,
    session.response.user.id,
    input.action,
    input.resourceType,
    input.resourceId ?? null,
    session.context.correlationId,
    JSON.stringify(input.metadata ?? {}),
    input.now
  );
}

export function domainOutboxStatement(
  db: D1Database,
  session: ResolvedSession,
  input: {
    eventType: string;
    aggregateType: string;
    aggregateId: string;
    aggregateVersion: number;
    payload: Record<string, unknown>;
    now: string;
    causationId?: string;
  }
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO domain_outbox_events (
       id, tenant_id, event_type, aggregate_type, aggregate_id,
       aggregate_version, payload_json, correlation_id, causation_id, occurred_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(
    crypto.randomUUID(),
    session.response.tenant.id,
    input.eventType,
    input.aggregateType,
    input.aggregateId,
    input.aggregateVersion,
    JSON.stringify(input.payload),
    session.context.correlationId,
    input.causationId ?? null,
    input.now
  );
}

export function requiredText(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number
): string {
  if (typeof value !== 'string') throw validationError(`${field} must be text.`);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw validationError(`${field} must contain ${minimum} to ${maximum} characters.`);
  }
  return normalized;
}

export function optionalText(value: unknown, field: string, maximum: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') throw validationError(`${field} must be text.`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum) {
    throw validationError(`${field} must contain at most ${maximum} characters.`);
  }
  return normalized;
}

export function normalizedCode(value: unknown, field: string): string {
  const normalized = requiredText(value, field, 1, 64).toUpperCase();
  if (!CODE_PATTERN.test(normalized)) {
    throw validationError(`${field} must be an uppercase business code using letters, numbers, dots, underscores or hyphens.`);
  }
  return normalized;
}

export function requiredId(value: unknown, field: string): string {
  const normalized = requiredText(value, field, 8, 160);
  if (!ID_PATTERN.test(normalized)) throw validationError(`${field} is invalid.`);
  return normalized;
}

export function requiredPositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw validationError(`${field} must be a positive safe integer in base units.`);
  }
  return Number(value);
}

export function requiredNonZeroInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) === 0) {
    throw validationError(`${field} must be a non-zero safe integer in base units.`);
  }
  return Number(value);
}

export function optionalNonNegativeInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw validationError(`${field} must be a non-negative safe integer.`);
  }
  return Number(value);
}

export function optionalDate(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw validationError(`${field} must use YYYY-MM-DD.`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw validationError(`${field} is not a valid calendar date.`);
  }
  return value;
}

export function optionalEmail(value: unknown, field: string): string | null {
  const normalized = optionalText(value, field, 254)?.toLowerCase() ?? null;
  if (normalized && !EMAIL_PATTERN.test(normalized)) {
    throw validationError(`${field} must be a valid email address.`);
  }
  return normalized;
}

export function countryCode(value: unknown, field = 'countryCode'): string {
  const normalized = requiredText(value, field, 2, 2).toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) throw validationError(`${field} must be a two-letter country code.`);
  return normalized;
}

export function validateTimezone(value: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date());
    return value;
  } catch {
    throw validationError('timezone must be a valid IANA time zone.');
  }
}

export function validationError(detail: string): PlatformHttpError {
  return new PlatformHttpError({
    status: 400,
    type: 'https://fmcgbyalex.com/problems/validation-error',
    title: 'Request validation failed',
    detail
  });
}

export function conflictError(type: string, title: string, detail?: string): PlatformHttpError {
  return new PlatformHttpError({
    status: 409,
    type: `https://fmcgbyalex.com/problems/${type}`,
    title,
    ...(detail === undefined ? {} : { detail })
  });
}

export function notFoundError(type: string, title: string): PlatformHttpError {
  return new PlatformHttpError({
    status: 404,
    type: `https://fmcgbyalex.com/problems/${type}`,
    title
  });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}
