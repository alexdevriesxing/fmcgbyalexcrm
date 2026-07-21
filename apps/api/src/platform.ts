import {
  MODULE_KEYS,
  PLATFORM_PERMISSIONS,
  type DevelopmentBootstrapRequest,
  type DevelopmentBootstrapResponse,
  type ModuleEntitlement,
  type ModuleKey,
  type SessionContextResponse,
  type SetModuleEntitlementResponse
} from '@fmcgbyalex/contracts';
import {
  AccessDeniedError,
  ModuleDisabledError,
  requireModule,
  requirePermission,
  type CorrelationId,
  type TenantContext,
  type TenantId,
  type UserId
} from '@fmcgbyalex/domain';

const DEVELOPMENT_MODULES = new Set<ModuleKey>([
  'platform',
  'master-data',
  'inventory',
  'sales',
  'crm'
]);

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const TENANT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const TENANT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type Identity = Readonly<{
  subject: string;
}>;

export type ResolvedSession = Readonly<{
  identity: Identity;
  context: TenantContext;
  response: SessionContextResponse;
}>;

export type ApiVariables = {
  correlationId: string;
  session: ResolvedSession;
};

type MembershipRow = {
  user_id: string;
  user_display_name: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_display_name: string;
  default_currency: string;
  default_locale: string;
  default_timezone: string;
};

type AccessRow = {
  role_key: string | null;
  permission_key: string | null;
};

type ModuleRow = {
  module_key: string;
  display_name: string;
  description: string;
  delivery_status: 'available' | 'foundation' | 'planned';
  enabled: number;
  version: number;
};

type IdempotencyRow = {
  request_hash: string;
  response_status: number | null;
  response_body: string | null;
};

type ExistingUserRow = {
  id: string;
};

export class PlatformHttpError extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly detail?: string;

  constructor(input: {
    status: number;
    type: string;
    title: string;
    detail?: string;
  }) {
    super(input.detail ?? input.title);
    this.name = 'PlatformHttpError';
    this.status = input.status;
    this.type = input.type;
    this.title = input.title;
    if (input.detail !== undefined) {
      this.detail = input.detail;
    }
  }
}

export function isPlatformHttpError(error: unknown): error is PlatformHttpError {
  return error instanceof PlatformHttpError;
}

export function isModuleKey(value: string): value is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(value);
}

export function resolveIdentity(request: Request, env: Env): Identity {
  if (env.ENVIRONMENT !== 'development' || env.AUTH_MODE !== 'development') {
    throw new PlatformHttpError({
      status: 503,
      type: 'https://fmcgbyalex.com/problems/identity-provider-unavailable',
      title: 'Identity provider is not configured',
      detail: 'Production and staging fail closed until the OIDC adapter is configured.'
    });
  }

  const subject =
    request.headers.get('X-Dev-Identity-Subject')?.trim() ||
    env.DEVELOPMENT_IDENTITY_SUBJECT.trim();

  if (!subject || subject.length > 200) {
    throw new PlatformHttpError({
      status: 401,
      type: 'https://fmcgbyalex.com/problems/authentication-required',
      title: 'Authentication required',
      detail: 'Provide a development identity subject.'
    });
  }

  return { subject };
}

export async function resolveSession(
  env: Env,
  request: Request,
  correlationId: string
): Promise<ResolvedSession> {
  const identity = resolveIdentity(request, env);
  const membershipResult = await env.CONTROL_DB.prepare(
    `SELECT
       u.id AS user_id,
       u.display_name AS user_display_name,
       t.id AS tenant_id,
       t.slug AS tenant_slug,
       t.display_name AS tenant_display_name,
       t.default_currency,
       t.default_locale,
       t.default_timezone
     FROM users u
     JOIN memberships m ON m.user_id = u.id
     JOIN tenants t ON t.id = m.tenant_id
     WHERE u.identity_provider_subject = ?1
       AND u.status = 'active'
       AND m.status = 'active'
       AND t.status = 'active'
     ORDER BY t.display_name, t.id`
  )
    .bind(identity.subject)
    .all<MembershipRow>();

  const memberships = membershipResult.results;
  if (memberships.length === 0) {
    throw new PlatformHttpError({
      status: 403,
      type: 'https://fmcgbyalex.com/problems/no-active-membership',
      title: 'No active company membership',
      detail: 'The authenticated identity is not assigned to an active tenant.'
    });
  }

  const requestedTenantId = request.headers.get('X-Tenant-Id')?.trim();
  if (requestedTenantId && !TENANT_ID_PATTERN.test(requestedTenantId)) {
    throw new PlatformHttpError({
      status: 400,
      type: 'https://fmcgbyalex.com/problems/invalid-tenant-selector',
      title: 'Invalid tenant selector'
    });
  }

  const membership = requestedTenantId
    ? memberships.find((candidate) => candidate.tenant_id === requestedTenantId)
    : memberships.length === 1
      ? memberships[0]
      : undefined;

  if (!membership) {
    throw new PlatformHttpError({
      status: requestedTenantId ? 403 : 409,
      type: 'https://fmcgbyalex.com/problems/tenant-selection-required',
      title: requestedTenantId ? 'Tenant access denied' : 'Tenant selection required',
      detail: requestedTenantId
        ? 'The selected tenant is not an active membership for this identity.'
        : 'Provide X-Tenant-Id because this identity belongs to multiple companies.'
    });
  }

  const accessResult = await env.CONTROL_DB.prepare(
    `SELECT DISTINCT r.key AS role_key, p.key AS permission_key
     FROM membership_roles mr
     JOIN roles r ON r.id = mr.role_id AND r.tenant_id = mr.tenant_id
     LEFT JOIN role_permissions rp ON rp.role_id = r.id AND rp.tenant_id = r.tenant_id
     LEFT JOIN permissions p ON p.key = rp.permission_key
     WHERE mr.tenant_id = ?1 AND mr.user_id = ?2`
  )
    .bind(membership.tenant_id, membership.user_id)
    .all<AccessRow>();

  const moduleResult = await env.CONTROL_DB.prepare(
    `SELECT
       mc.key AS module_key,
       mc.display_name,
       mc.description,
       mc.delivery_status,
       COALESCE(tm.enabled, 0) AS enabled,
       COALESCE(tm.version, 0) AS version
     FROM module_catalog mc
     LEFT JOIN tenant_modules tm
       ON tm.module_key = mc.key AND tm.tenant_id = ?1
     WHERE mc.lifecycle_status <> 'retired'
     ORDER BY mc.display_name, mc.key`
  )
    .bind(membership.tenant_id)
    .all<ModuleRow>();

  const roles = uniqueSorted(
    accessResult.results.flatMap((row) => (row.role_key ? [row.role_key] : []))
  );
  const permissions = uniqueSorted(
    accessResult.results.flatMap((row) =>
      row.permission_key ? [row.permission_key] : []
    )
  );
  const modules = moduleResult.results.flatMap(toModuleEntitlement);
  const moduleMap = new Map<ModuleKey, boolean>(
    modules.map((module) => [module.key, module.enabled])
  );

  const response: SessionContextResponse = {
    user: {
      id: membership.user_id,
      displayName: membership.user_display_name
    },
    tenant: {
      id: membership.tenant_id,
      slug: membership.tenant_slug,
      displayName: membership.tenant_display_name,
      defaultCurrency: membership.default_currency,
      defaultLocale: membership.default_locale,
      defaultTimezone: membership.default_timezone
    },
    roles,
    permissions,
    modules
  };

  const context: TenantContext = {
    tenantId: membership.tenant_id as TenantId,
    userId: membership.user_id as UserId,
    correlationId: correlationId as CorrelationId,
    roles,
    permissions: new Set(permissions),
    modules: moduleMap
  };

  return { identity, context, response };
}

export async function enforcePermission(
  db: D1Database,
  request: Request,
  session: ResolvedSession,
  permission: string,
  action: string
): Promise<void> {
  try {
    requirePermission(session.context, permission);
  } catch (error) {
    if (error instanceof AccessDeniedError) {
      await recordAudit(db, request, session, {
        action,
        resourceType: 'permission',
        resourceId: permission,
        outcome: 'denied',
        metadata: { permission }
      });
      throw new PlatformHttpError({
        status: 403,
        type: 'https://fmcgbyalex.com/problems/permission-denied',
        title: 'Permission denied'
      });
    }
    throw error;
  }
}

export async function enforceModule(
  db: D1Database,
  request: Request,
  session: ResolvedSession,
  moduleKey: ModuleKey,
  action: string
): Promise<void> {
  try {
    requireModule(session.context, moduleKey);
  } catch (error) {
    if (error instanceof ModuleDisabledError) {
      await recordAudit(db, request, session, {
        action,
        resourceType: 'module',
        resourceId: moduleKey,
        outcome: 'denied',
        metadata: { moduleKey }
      });
      throw new PlatformHttpError({
        status: 403,
        type: 'https://fmcgbyalex.com/problems/module-disabled',
        title: 'Module is disabled'
      });
    }
    throw error;
  }
}

export async function bootstrapDevelopmentTenant(
  env: Env,
  request: Request,
  correlationId: string,
  input: DevelopmentBootstrapRequest
): Promise<DevelopmentBootstrapResponse> {
  const identity = resolveIdentity(request, env);
  const tenantName = input.tenantName.trim();
  const tenantSlug = input.tenantSlug.trim().toLowerCase();
  const adminEmail = input.adminEmail.trim().toLowerCase();
  const adminDisplayName = input.adminDisplayName.trim();

  if (tenantName.length < 2 || tenantName.length > 120) {
    throw validationError('tenantName must contain 2 to 120 characters.');
  }
  if (!TENANT_SLUG_PATTERN.test(tenantSlug) || tenantSlug.length > 80) {
    throw validationError('tenantSlug must be a lowercase URL-safe slug.');
  }
  if (!EMAIL_PATTERN.test(adminEmail) || adminEmail.length > 254) {
    throw validationError('adminEmail must be a valid email address.');
  }
  if (adminDisplayName.length < 2 || adminDisplayName.length > 120) {
    throw validationError('adminDisplayName must contain 2 to 120 characters.');
  }

  const existingTenant = await env.CONTROL_DB.prepare(
    'SELECT id FROM tenants WHERE slug = ?1'
  )
    .bind(tenantSlug)
    .first<{ id: string }>();
  if (existingTenant) {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/tenant-slug-conflict',
      title: 'Tenant slug already exists'
    });
  }

  const existingUser = await env.CONTROL_DB.prepare(
    'SELECT id FROM users WHERE identity_provider_subject = ?1'
  )
    .bind(identity.subject)
    .first<ExistingUserRow>();

  const now = new Date().toISOString();
  const tenantId = `ten_${crypto.randomUUID()}`;
  const userId = existingUser?.id ?? `usr_${crypto.randomUUID()}`;
  const roleId = `rol_${crypto.randomUUID()}`;
  const auditId = crypto.randomUUID();
  const outboxId = crypto.randomUUID();

  const statements: D1PreparedStatement[] = [
    env.CONTROL_DB.prepare(
      `INSERT INTO tenants (
         id, slug, display_name, status, data_adapter, data_locator,
         default_currency, default_locale, default_timezone,
         created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, 'active', 'd1', ?1, 'EUR', 'en-NL',
         'Europe/Amsterdam', ?4, ?4, 1)`
    ).bind(tenantId, tenantSlug, tenantName, now),
    env.CONTROL_DB.prepare(
      `INSERT INTO users (
         id, identity_provider_subject, email_normalized, display_name,
         status, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)
       ON CONFLICT(identity_provider_subject) DO UPDATE SET
         email_normalized = excluded.email_normalized,
         display_name = excluded.display_name,
         status = 'active',
         updated_at = excluded.updated_at`
    ).bind(userId, identity.subject, adminEmail, adminDisplayName, now),
    env.CONTROL_DB.prepare(
      `INSERT INTO memberships (
         tenant_id, user_id, status, created_at, updated_at
       ) VALUES (?1, ?2, 'active', ?3, ?3)`
    ).bind(tenantId, userId, now),
    env.CONTROL_DB.prepare(
      `INSERT INTO roles (
         id, tenant_id, key, display_name, is_system, created_at, updated_at
       ) VALUES (?1, ?2, 'tenant-admin', 'Tenant Administrator', 1, ?3, ?3)`
    ).bind(roleId, tenantId, now),
    env.CONTROL_DB.prepare(
      `INSERT INTO membership_roles (tenant_id, user_id, role_id, created_at)
       VALUES (?1, ?2, ?3, ?4)`
    ).bind(tenantId, userId, roleId, now)
  ];

  for (const permission of PLATFORM_PERMISSIONS) {
    statements.push(
      env.CONTROL_DB.prepare(
        `INSERT INTO role_permissions (
           tenant_id, role_id, permission_key, created_at
         ) VALUES (?1, ?2, ?3, ?4)`
      ).bind(tenantId, roleId, permission, now)
    );
  }

  for (const moduleKey of MODULE_KEYS) {
    statements.push(
      env.CONTROL_DB.prepare(
        `INSERT INTO tenant_modules (
           tenant_id, module_key, enabled, configuration_json,
           enabled_at, disabled_at, updated_at, version
         ) VALUES (?1, ?2, ?3, '{}', ?4, ?5, ?6, 1)`
      ).bind(
        tenantId,
        moduleKey,
        DEVELOPMENT_MODULES.has(moduleKey) ? 1 : 0,
        DEVELOPMENT_MODULES.has(moduleKey) ? now : null,
        DEVELOPMENT_MODULES.has(moduleKey) ? null : now,
        now
      )
    );
  }

  statements.push(
    env.CONTROL_DB.prepare(
      `INSERT INTO audit_events (
         id, tenant_id, actor_type, actor_id, action, resource_type,
         resource_id, outcome, correlation_id, metadata_json, occurred_at
       ) VALUES (?1, ?2, 'user', ?3, 'tenant.bootstrap', 'tenant', ?2,
         'success', ?4, ?5, ?6)`
    ).bind(
      auditId,
      tenantId,
      userId,
      correlationId,
      JSON.stringify({ source: 'development-bootstrap' }),
      now
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO outbox_events (
         id, tenant_id, event_type, aggregate_type, aggregate_id,
         aggregate_version, payload_json, correlation_id, occurred_at
       ) VALUES (?1, ?2, 'platform.tenant.created.v1', 'tenant', ?2, 1,
         ?3, ?4, ?5)`
    ).bind(
      outboxId,
      tenantId,
      JSON.stringify({ tenantId, tenantSlug, displayName: tenantName }),
      correlationId,
      now
    )
  );

  await env.CONTROL_DB.batch(statements);
  return { tenantId, userId, created: true };
}

export async function setModuleEntitlement(
  env: Env,
  request: Request,
  session: ResolvedSession,
  moduleKeyValue: string,
  enabled: boolean
): Promise<SetModuleEntitlementResponse> {
  if (!isModuleKey(moduleKeyValue)) {
    throw new PlatformHttpError({
      status: 404,
      type: 'https://fmcgbyalex.com/problems/module-not-found',
      title: 'Module not found'
    });
  }

  await enforceModule(
    env.CONTROL_DB,
    request,
    session,
    'platform',
    'platform.modules.update'
  );
  await enforcePermission(
    env.CONTROL_DB,
    request,
    session,
    'platform.modules.manage',
    'platform.modules.update'
  );

  const idempotencyKey = request.headers.get('Idempotency-Key')?.trim();
  if (!idempotencyKey || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new PlatformHttpError({
      status: 400,
      type: 'https://fmcgbyalex.com/problems/idempotency-key-required',
      title: 'A valid Idempotency-Key header is required'
    });
  }

  const currentModule = session.response.modules.find(
    (module) => module.key === moduleKeyValue
  );
  if (!currentModule) {
    throw new PlatformHttpError({
      status: 404,
      type: 'https://fmcgbyalex.com/problems/module-not-found',
      title: 'Module not found'
    });
  }

  const requestHash = await sha256(
    JSON.stringify({
      tenantId: session.response.tenant.id,
      moduleKey: moduleKeyValue,
      enabled
    })
  );
  const scope = `platform.modules.set:${moduleKeyValue}`;
  const replay = await readIdempotency(
    env.CONTROL_DB,
    session.response.tenant.id,
    scope,
    idempotencyKey,
    requestHash
  );
  if (replay) {
    return replay;
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const nextModule: ModuleEntitlement = {
    ...currentModule,
    enabled,
    version: currentModule.version + 1
  };
  const response: SetModuleEntitlementResponse = {
    module: nextModule,
    replayed: false
  };
  const responseBody = JSON.stringify(response);
  const auditMetadata = JSON.stringify({
    moduleKey: moduleKeyValue,
    previousEnabled: currentModule.enabled,
    enabled,
    previousVersion: currentModule.version,
    version: nextModule.version
  });

  const statements = [
    env.CONTROL_DB.prepare(
      `INSERT INTO idempotency_keys (
         tenant_id, scope, idempotency_key, request_hash,
         created_at, expires_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(
      session.response.tenant.id,
      scope,
      idempotencyKey,
      requestHash,
      now,
      expiresAt
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO tenant_modules (
         tenant_id, module_key, enabled, configuration_json,
         enabled_at, disabled_at, updated_at, version
       ) VALUES (?1, ?2, ?3, '{}', ?4, ?5, ?6, 1)
       ON CONFLICT(tenant_id, module_key) DO UPDATE SET
         enabled = excluded.enabled,
         enabled_at = CASE WHEN excluded.enabled = 1 THEN excluded.updated_at ELSE tenant_modules.enabled_at END,
         disabled_at = CASE WHEN excluded.enabled = 0 THEN excluded.updated_at ELSE NULL END,
         updated_at = excluded.updated_at,
         version = tenant_modules.version + 1`
    ).bind(
      session.response.tenant.id,
      moduleKeyValue,
      enabled ? 1 : 0,
      enabled ? now : null,
      enabled ? null : now,
      now
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO audit_events (
         id, tenant_id, actor_type, actor_id, action, resource_type,
         resource_id, outcome, correlation_id, metadata_json, occurred_at
       ) VALUES (?1, ?2, 'user', ?3, 'platform.modules.update', 'module',
         ?4, 'success', ?5, ?6, ?7)`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      session.response.user.id,
      moduleKeyValue,
      session.context.correlationId,
      auditMetadata,
      now
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO outbox_events (
         id, tenant_id, event_type, aggregate_type, aggregate_id,
         aggregate_version, payload_json, correlation_id, occurred_at
       ) VALUES (?1, ?2, 'platform.module-entitlement.changed.v1', 'module-entitlement',
         ?3, ?4, ?5, ?6, ?7)`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      moduleKeyValue,
      nextModule.version,
      JSON.stringify({ moduleKey: moduleKeyValue, enabled, version: nextModule.version }),
      session.context.correlationId,
      now
    ),
    env.CONTROL_DB.prepare(
      `UPDATE idempotency_keys
       SET response_status = 200, response_body = ?1
       WHERE tenant_id = ?2 AND scope = ?3 AND idempotency_key = ?4`
    ).bind(
      responseBody,
      session.response.tenant.id,
      scope,
      idempotencyKey
    )
  ];

  try {
    await env.CONTROL_DB.batch(statements);
  } catch (error) {
    const concurrentReplay = await readIdempotency(
      env.CONTROL_DB,
      session.response.tenant.id,
      scope,
      idempotencyKey,
      requestHash
    );
    if (concurrentReplay) {
      return concurrentReplay;
    }
    throw error;
  }

  return response;
}

async function readIdempotency(
  db: D1Database,
  tenantId: string,
  scope: string,
  idempotencyKey: string,
  requestHash: string
): Promise<SetModuleEntitlementResponse | null> {
  const existing = await db
    .prepare(
      `SELECT request_hash, response_status, response_body
       FROM idempotency_keys
       WHERE tenant_id = ?1 AND scope = ?2 AND idempotency_key = ?3
         AND expires_at > ?4`
    )
    .bind(tenantId, scope, idempotencyKey, new Date().toISOString())
    .first<IdempotencyRow>();

  if (!existing) {
    return null;
  }
  if (existing.request_hash !== requestHash) {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/idempotency-key-conflict',
      title: 'Idempotency key conflict',
      detail: 'The key was already used for a different request.'
    });
  }
  if (existing.response_status === null || existing.response_body === null) {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/request-in-progress',
      title: 'An identical request is already in progress'
    });
  }

  const parsed = JSON.parse(existing.response_body) as SetModuleEntitlementResponse;
  return { ...parsed, replayed: true };
}

async function recordAudit(
  db: D1Database,
  request: Request,
  session: ResolvedSession,
  input: {
    action: string;
    resourceType: string;
    resourceId: string;
    outcome: 'success' | 'denied' | 'failure';
    metadata: Record<string, unknown>;
  }
): Promise<void> {
  const sourceIp = request.headers.get('CF-Connecting-IP') ?? '';
  const userAgent = request.headers.get('User-Agent') ?? '';
  const sourceIpHash = sourceIp ? await sha256(sourceIp) : null;
  const userAgentHash = userAgent ? await sha256(userAgent) : null;

  await db
    .prepare(
      `INSERT INTO audit_events (
         id, tenant_id, actor_type, actor_id, action, resource_type,
         resource_id, outcome, correlation_id, source_ip_hash,
         user_agent_hash, metadata_json, occurred_at
       ) VALUES (?1, ?2, 'user', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
    )
    .bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      session.response.user.id,
      input.action,
      input.resourceType,
      input.resourceId,
      input.outcome,
      session.context.correlationId,
      sourceIpHash,
      userAgentHash,
      JSON.stringify(input.metadata),
      new Date().toISOString()
    )
    .run();
}

function toModuleEntitlement(row: ModuleRow): ModuleEntitlement[] {
  if (!isModuleKey(row.module_key)) {
    return [];
  }
  return [
    {
      key: row.module_key,
      enabled: row.enabled === 1,
      status: row.delivery_status,
      label: row.display_name,
      description: row.description,
      version: row.version
    }
  ];
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function validationError(detail: string): PlatformHttpError {
  return new PlatformHttpError({
    status: 400,
    type: 'https://fmcgbyalex.com/problems/validation-error',
    title: 'Request validation failed',
    detail
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
