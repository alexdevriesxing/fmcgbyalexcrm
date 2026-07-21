import {
  MODULE_KEYS,
  PLATFORM_PERMISSIONS,
  type AcceptInvitationRequest,
  type AcceptInvitationResponse,
  type CreateInvitationRequest,
  type CreateInvitationResponse,
  type InvitationSummary,
  type MembershipSummary,
  type OnboardTenantRequest,
  type OnboardTenantResponse,
  type RevokeInvitationResponse,
  type RoleSummary,
  type TenantAdministrationResponse,
  type TenantOptionsResponse,
  type TenantSummary,
  type UpdateMembershipRequest,
  type UpdateMembershipResponse
} from '@fmcgbyalex/contracts';
import { resolveAuthenticatedIdentity } from './identity';
import {
  PlatformHttpError,
  enforceModule,
  enforcePermission,
  type ResolvedSession
} from './platform';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TENANT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const ROLE_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_MODULES = new Set(['platform', 'master-data', 'inventory', 'sales', 'crm']);
const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const STANDARD_ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  'tenant-admin': PLATFORM_PERMISSIONS,
  operator: [
    'platform.session.read',
    'platform.modules.read',
    'platform.memberships.read',
    'platform.roles.read'
  ],
  viewer: [
    'platform.session.read',
    'platform.modules.read',
    'platform.memberships.read',
    'platform.roles.read'
  ]
};

const STANDARD_ROLE_NAMES: Readonly<Record<string, string>> = {
  'tenant-admin': 'Tenant Administrator',
  operator: 'Business Operator',
  viewer: 'Read-only Viewer'
};

type UserIdentityRow = {
  id: string;
  identity_provider_subject: string;
  email_normalized: string;
  display_name: string;
};

type TenantOptionRow = {
  user_id: string;
  user_display_name: string;
  tenant_id: string;
  tenant_slug: string;
  tenant_display_name: string;
  default_currency: string;
  default_locale: string;
  default_timezone: string;
};

type RoleRow = {
  id: string;
  key: string;
  display_name: string;
  is_system: number;
};

type RolePermissionRow = {
  role_id: string;
  permission_key: string;
};

type MembershipRow = {
  user_id: string;
  email_normalized: string;
  display_name: string;
  status: 'invited' | 'active' | 'suspended';
  created_at: string;
  updated_at: string;
  role_keys: string | null;
};

type InvitationRow = {
  id: string;
  tenant_id: string;
  email_normalized: string;
  display_name: string | null;
  token_ciphertext: string;
  token_iv: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: string;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  role_keys: string | null;
};

type InvitationAcceptanceRow = InvitationRow & {
  tenant_slug: string;
  tenant_display_name: string;
  default_currency: string;
  default_locale: string;
  default_timezone: string;
};

type IdempotencyRow = {
  request_hash: string;
  response_body: string | null;
};

type OnboardingRow = {
  request_hash: string;
  response_body: string | null;
};

type CountRow = { count: number };

export async function listTenantOptions(
  env: Env,
  request: Request
): Promise<TenantOptionsResponse> {
  const identity = await resolveAuthenticatedIdentity(request, env);
  const result = await env.CONTROL_DB.prepare(
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
    .all<TenantOptionRow>();

  const first = result.results[0];
  return {
    user: first
      ? { id: first.user_id, displayName: first.user_display_name }
      : null,
    tenants: result.results.map((row) => ({
      id: row.tenant_id,
      slug: row.tenant_slug,
      displayName: row.tenant_display_name,
      defaultCurrency: row.default_currency,
      defaultLocale: row.default_locale,
      defaultTimezone: row.default_timezone,
      membershipStatus: 'active'
    }))
  };
}

export async function onboardTenant(
  env: Env,
  request: Request,
  correlationId: string,
  input: OnboardTenantRequest
): Promise<OnboardTenantResponse> {
  if (env.SELF_SERVICE_ONBOARDING !== 'enabled') {
    throw new PlatformHttpError({
      status: 403,
      type: 'https://fmcgbyalex.com/problems/onboarding-disabled',
      title: 'Self-service onboarding is disabled'
    });
  }

  const identity = await resolveAuthenticatedIdentity(request, env);
  if (!identity.email) {
    throw new PlatformHttpError({
      status: 403,
      type: 'https://fmcgbyalex.com/problems/verified-email-required',
      title: 'A verified email address is required'
    });
  }

  const tenantName = requiredText(input.tenantName, 'tenantName', 2, 120);
  const tenantSlug = input.tenantSlug.trim().toLowerCase();
  const adminDisplayName = requiredText(
    input.adminDisplayName || identity.displayName || identity.email,
    'adminDisplayName',
    2,
    120
  );
  const defaultCurrency = input.defaultCurrency.trim().toUpperCase();
  const defaultLocale = requiredText(input.defaultLocale, 'defaultLocale', 2, 35);
  const defaultTimezone = requiredText(input.defaultTimezone, 'defaultTimezone', 3, 80);

  if (!TENANT_SLUG_PATTERN.test(tenantSlug) || tenantSlug.length > 80) {
    throw validationError('tenantSlug must be a lowercase URL-safe slug.');
  }
  if (!/^[A-Z]{3}$/.test(defaultCurrency)) {
    throw validationError('defaultCurrency must be a three-letter ISO currency code.');
  }
  validateTimezone(defaultTimezone);

  const idempotencyKey = requireIdempotency(request);
  const requestHash = await sha256(
    JSON.stringify({
      subject: identity.subject,
      email: identity.email,
      tenantName,
      tenantSlug,
      adminDisplayName,
      defaultCurrency,
      defaultLocale,
      defaultTimezone
    })
  );

  const replay = await readOnboardingReplay(
    env.CONTROL_DB,
    identity.subject,
    idempotencyKey,
    requestHash
  );
  if (replay) {
    return replay;
  }

  const conflict = await env.CONTROL_DB.prepare(
    'SELECT id FROM tenants WHERE slug = ?1'
  )
    .bind(tenantSlug)
    .first<{ id: string }>();
  if (conflict) {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/tenant-slug-conflict',
      title: 'Tenant slug already exists'
    });
  }

  const users = await env.CONTROL_DB.prepare(
    `SELECT id, identity_provider_subject, email_normalized, display_name
     FROM users
     WHERE identity_provider_subject = ?1 OR email_normalized = ?2`
  )
    .bind(identity.subject, identity.email)
    .all<UserIdentityRow>();
  const userBySubject = users.results.find(
    (candidate) => candidate.identity_provider_subject === identity.subject
  );
  const emailConflict = users.results.find(
    (candidate) =>
      candidate.email_normalized === identity.email &&
      candidate.identity_provider_subject !== identity.subject
  );
  if (emailConflict) {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/identity-email-conflict',
      title: 'Email address is already linked to another identity'
    });
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();
  const tenantId = `ten_${crypto.randomUUID()}`;
  const userId = userBySubject?.id ?? `usr_${crypto.randomUUID()}`;
  const roleIds = {
    'tenant-admin': `rol_${crypto.randomUUID()}`,
    operator: `rol_${crypto.randomUUID()}`,
    viewer: `rol_${crypto.randomUUID()}`
  };
  const response: OnboardTenantResponse = { tenantId, userId, replayed: false };

  const statements: D1PreparedStatement[] = [
    env.CONTROL_DB.prepare(
      `INSERT INTO onboarding_requests (
         identity_provider_subject, idempotency_key, request_hash,
         response_body, created_at, expires_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
    ).bind(
      identity.subject,
      idempotencyKey,
      requestHash,
      JSON.stringify(response),
      now,
      expiresAt
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO tenants (
         id, slug, display_name, status, data_adapter, data_locator,
         default_currency, default_locale, default_timezone,
         created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, 'active', 'd1', ?1, ?4, ?5, ?6, ?7, ?7, 1)`
    ).bind(
      tenantId,
      tenantSlug,
      tenantName,
      defaultCurrency,
      defaultLocale,
      defaultTimezone,
      now
    ),
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
    ).bind(userId, identity.subject, identity.email, adminDisplayName, now),
    env.CONTROL_DB.prepare(
      `INSERT INTO memberships (tenant_id, user_id, status, created_at, updated_at)
       VALUES (?1, ?2, 'active', ?3, ?3)`
    ).bind(tenantId, userId, now)
  ];

  for (const roleKey of Object.keys(roleIds)) {
    const roleId = roleIds[roleKey as keyof typeof roleIds];
    statements.push(
      env.CONTROL_DB.prepare(
        `INSERT INTO roles (
           id, tenant_id, key, display_name, is_system, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)`
      ).bind(roleId, tenantId, roleKey, STANDARD_ROLE_NAMES[roleKey], now)
    );
    for (const permission of STANDARD_ROLE_PERMISSIONS[roleKey] ?? []) {
      statements.push(
        env.CONTROL_DB.prepare(
          `INSERT INTO role_permissions (
             tenant_id, role_id, permission_key, created_at
           ) VALUES (?1, ?2, ?3, ?4)`
        ).bind(tenantId, roleId, permission, now)
      );
    }
  }

  statements.push(
    env.CONTROL_DB.prepare(
      `INSERT INTO membership_roles (tenant_id, user_id, role_id, created_at)
       VALUES (?1, ?2, ?3, ?4)`
    ).bind(tenantId, userId, roleIds['tenant-admin'], now)
  );

  for (const moduleKey of MODULE_KEYS) {
    const enabled = DEFAULT_MODULES.has(moduleKey);
    statements.push(
      env.CONTROL_DB.prepare(
        `INSERT INTO tenant_modules (
           tenant_id, module_key, enabled, configuration_json,
           enabled_at, disabled_at, updated_at, version
         ) VALUES (?1, ?2, ?3, '{}', ?4, ?5, ?6, 1)`
      ).bind(tenantId, moduleKey, enabled ? 1 : 0, enabled ? now : null, enabled ? null : now, now)
    );
  }

  statements.push(
    env.CONTROL_DB.prepare(
      `INSERT INTO audit_events (
         id, tenant_id, actor_type, actor_id, action, resource_type,
         resource_id, outcome, correlation_id, metadata_json, occurred_at
       ) VALUES (?1, ?2, 'user', ?3, 'tenant.onboard', 'tenant', ?2,
         'success', ?4, ?5, ?6)`
    ).bind(
      crypto.randomUUID(),
      tenantId,
      userId,
      correlationId,
      JSON.stringify({ source: 'self-service-onboarding' }),
      now
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO outbox_events (
         id, tenant_id, event_type, aggregate_type, aggregate_id,
         aggregate_version, payload_json, correlation_id, occurred_at
       ) VALUES (?1, ?2, 'platform.tenant.onboarded.v1', 'tenant', ?2, 1,
         ?3, ?4, ?5)`
    ).bind(
      crypto.randomUUID(),
      tenantId,
      JSON.stringify({ tenantId, tenantSlug, displayName: tenantName }),
      correlationId,
      now
    )
  );

  try {
    await env.CONTROL_DB.batch(statements);
  } catch (error) {
    const concurrentReplay = await readOnboardingReplay(
      env.CONTROL_DB,
      identity.subject,
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

export async function getTenantAdministration(
  env: Env,
  request: Request,
  session: ResolvedSession
): Promise<TenantAdministrationResponse> {
  await requireAdministrationAccess(env, request, session, [
    'platform.memberships.read',
    'platform.roles.read'
  ]);
  await ensureStandardRoles(env.CONTROL_DB, session.response.tenant.id);
  await expireInvitations(env.CONTROL_DB, session.response.tenant.id);

  const [roleResult, permissionResult, membershipResult, invitationResult] =
    await Promise.all([
      env.CONTROL_DB.prepare(
        `SELECT id, key, display_name, is_system
         FROM roles WHERE tenant_id = ?1 ORDER BY is_system DESC, display_name`
      )
        .bind(session.response.tenant.id)
        .all<RoleRow>(),
      env.CONTROL_DB.prepare(
        `SELECT role_id, permission_key
         FROM role_permissions WHERE tenant_id = ?1 ORDER BY permission_key`
      )
        .bind(session.response.tenant.id)
        .all<RolePermissionRow>(),
      env.CONTROL_DB.prepare(
        `SELECT
           u.id AS user_id, u.email_normalized, u.display_name,
           m.status, m.created_at, m.updated_at,
           GROUP_CONCAT(DISTINCT r.key) AS role_keys
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         LEFT JOIN membership_roles mr
           ON mr.tenant_id = m.tenant_id AND mr.user_id = m.user_id
         LEFT JOIN roles r ON r.id = mr.role_id
         WHERE m.tenant_id = ?1
         GROUP BY u.id, u.email_normalized, u.display_name,
                  m.status, m.created_at, m.updated_at
         ORDER BY u.display_name, u.id`
      )
        .bind(session.response.tenant.id)
        .all<MembershipRow>(),
      env.CONTROL_DB.prepare(
        `SELECT
           i.id, i.tenant_id, i.email_normalized, i.display_name,
           i.token_ciphertext, i.token_iv, i.status, i.expires_at,
           i.created_at, i.updated_at, i.accepted_at,
           GROUP_CONCAT(DISTINCT r.key) AS role_keys
         FROM tenant_invitations i
         LEFT JOIN tenant_invitation_roles ir ON ir.invitation_id = i.id
         LEFT JOIN roles r ON r.id = ir.role_id
         WHERE i.tenant_id = ?1
         GROUP BY i.id
         ORDER BY i.created_at DESC`
      )
        .bind(session.response.tenant.id)
        .all<InvitationRow>()
    ]);

  const permissionMap = new Map<string, string[]>();
  for (const permission of permissionResult.results) {
    const values = permissionMap.get(permission.role_id) ?? [];
    values.push(permission.permission_key);
    permissionMap.set(permission.role_id, values);
  }

  return {
    roles: roleResult.results.map((role) => ({
      id: role.id,
      key: role.key,
      displayName: role.display_name,
      system: role.is_system === 1,
      permissions: permissionMap.get(role.id) ?? []
    })),
    memberships: membershipResult.results.map(toMembershipSummary),
    invitations: invitationResult.results.map(toInvitationSummary)
  };
}

export async function createInvitation(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: CreateInvitationRequest
): Promise<CreateInvitationResponse> {
  await requireAdministrationAccess(env, request, session, [
    'platform.invitations.manage'
  ]);
  await ensureStandardRoles(env.CONTROL_DB, session.response.tenant.id);

  const email = normalizeEmail(input.email);
  const displayName = optionalText(input.displayName, 120);
  const roleKeys = normalizeRoleKeys(input.roleKeys);
  const roles = await resolveRoles(
    env.CONTROL_DB,
    session.response.tenant.id,
    roleKeys
  );
  const idempotencyKey = requireIdempotency(request);
  const requestHash = await sha256(
    JSON.stringify({
      tenantId: session.response.tenant.id,
      email,
      displayName: displayName ?? null,
      roleKeys
    })
  );
  const scope = `platform.invitations.create:${email}`;

  const replayId = await readTenantReplay<{ invitationId: string }>(
    env.CONTROL_DB,
    session.response.tenant.id,
    scope,
    idempotencyKey,
    requestHash
  );
  if (replayId) {
    const replayInvitation = await loadInvitation(
      env.CONTROL_DB,
      session.response.tenant.id,
      replayId.invitationId
    );
    return {
      invitation: toInvitationSummary(replayInvitation),
      acceptanceToken: await decryptToken(
        env.INVITATION_ENCRYPTION_KEY,
        replayInvitation.token_ciphertext,
        replayInvitation.token_iv
      ),
      replayed: true
    };
  }

  const existingMember = await env.CONTROL_DB.prepare(
    `SELECT u.id FROM users u
     JOIN memberships m ON m.user_id = u.id
     WHERE m.tenant_id = ?1 AND u.email_normalized = ?2`
  )
    .bind(session.response.tenant.id, email)
    .first<{ id: string }>();
  if (existingMember) {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/member-already-exists',
      title: 'This email already belongs to a company member'
    });
  }

  const existingInvite = await env.CONTROL_DB.prepare(
    `SELECT id FROM tenant_invitations
     WHERE tenant_id = ?1 AND email_normalized = ?2 AND status = 'pending'`
  )
    .bind(session.response.tenant.id, email)
    .first<{ id: string }>();
  if (existingInvite) {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/invitation-already-pending',
      title: 'A pending invitation already exists for this email'
    });
  }

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS).toISOString();
  const invitationId = `inv_${crypto.randomUUID()}`;
  const token = randomToken();
  const encrypted = await encryptToken(env.INVITATION_ENCRYPTION_KEY, token);
  const invitationRow: InvitationRow = {
    id: invitationId,
    tenant_id: session.response.tenant.id,
    email_normalized: email,
    display_name: displayName ?? null,
    token_ciphertext: encrypted.ciphertext,
    token_iv: encrypted.iv,
    status: 'pending',
    expires_at: expiresAt,
    created_at: now,
    updated_at: now,
    accepted_at: null,
    role_keys: roleKeys.join(',')
  };
  const response: CreateInvitationResponse = {
    invitation: toInvitationSummary(invitationRow),
    acceptanceToken: token,
    replayed: false
  };
  const idemExpiry = new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString();

  const statements: D1PreparedStatement[] = [
    env.CONTROL_DB.prepare(
      `INSERT INTO idempotency_keys (
         tenant_id, scope, idempotency_key, request_hash,
         response_status, response_body, created_at, expires_at
       ) VALUES (?1, ?2, ?3, ?4, 201, ?5, ?6, ?7)`
    ).bind(
      session.response.tenant.id,
      scope,
      idempotencyKey,
      requestHash,
      JSON.stringify({ invitationId }),
      now,
      idemExpiry
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO tenant_invitations (
         id, tenant_id, email_normalized, display_name, token_hash,
         token_ciphertext, token_iv, status, invited_by_user_id,
         expires_at, created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?9, ?10, ?10, 1)`
    ).bind(
      invitationId,
      session.response.tenant.id,
      email,
      displayName ?? null,
      await sha256(token),
      encrypted.ciphertext,
      encrypted.iv,
      session.response.user.id,
      expiresAt,
      now
    )
  ];

  for (const role of roles) {
    statements.push(
      env.CONTROL_DB.prepare(
        `INSERT INTO tenant_invitation_roles (invitation_id, role_id)
         VALUES (?1, ?2)`
      ).bind(invitationId, role.id)
    );
  }

  statements.push(
    env.CONTROL_DB.prepare(
      `INSERT INTO audit_events (
         id, tenant_id, actor_type, actor_id, action, resource_type,
         resource_id, outcome, correlation_id, metadata_json, occurred_at
       ) VALUES (?1, ?2, 'user', ?3, 'platform.invitation.create',
         'tenant-invitation', ?4, 'success', ?5, ?6, ?7)`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      session.response.user.id,
      invitationId,
      session.context.correlationId,
      JSON.stringify({ emailHash: await sha256(email), roleKeys }),
      now
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO outbox_events (
         id, tenant_id, event_type, aggregate_type, aggregate_id,
         aggregate_version, payload_json, correlation_id, occurred_at
       ) VALUES (?1, ?2, 'platform.invitation.created.v1',
         'tenant-invitation', ?3, 1, ?4, ?5, ?6)`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      invitationId,
      JSON.stringify({ invitationId, email, roleKeys, expiresAt }),
      session.context.correlationId,
      now
    )
  );

  try {
    await env.CONTROL_DB.batch(statements);
  } catch (error) {
    const concurrentReplay = await readTenantReplay<{ invitationId: string }>(
      env.CONTROL_DB,
      session.response.tenant.id,
      scope,
      idempotencyKey,
      requestHash
    );
    if (concurrentReplay) {
      const invitation = await loadInvitation(
        env.CONTROL_DB,
        session.response.tenant.id,
        concurrentReplay.invitationId
      );
      return {
        invitation: toInvitationSummary(invitation),
        acceptanceToken: await decryptToken(
          env.INVITATION_ENCRYPTION_KEY,
          invitation.token_ciphertext,
          invitation.token_iv
        ),
        replayed: true
      };
    }
    throw error;
  }

  return response;
}

export async function acceptInvitation(
  env: Env,
  request: Request,
  correlationId: string,
  input: AcceptInvitationRequest
): Promise<AcceptInvitationResponse> {
  const identity = await resolveAuthenticatedIdentity(request, env);
  if (!identity.email) {
    throw new PlatformHttpError({
      status: 403,
      type: 'https://fmcgbyalex.com/problems/verified-email-required',
      title: 'A verified email address is required'
    });
  }

  const token = requiredText(input.token, 'token', 20, 512);
  const tokenHash = await sha256(token);
  const invitation = await env.CONTROL_DB.prepare(
    `SELECT
       i.id, i.tenant_id, i.email_normalized, i.display_name,
       i.token_ciphertext, i.token_iv, i.status, i.expires_at,
       i.created_at, i.updated_at, i.accepted_at,
       t.slug AS tenant_slug, t.display_name AS tenant_display_name,
       t.default_currency, t.default_locale, t.default_timezone,
       GROUP_CONCAT(DISTINCT r.key) AS role_keys
     FROM tenant_invitations i
     JOIN tenants t ON t.id = i.tenant_id
     LEFT JOIN tenant_invitation_roles ir ON ir.invitation_id = i.id
     LEFT JOIN roles r ON r.id = ir.role_id
     WHERE i.token_hash = ?1
     GROUP BY i.id`
  )
    .bind(tokenHash)
    .first<InvitationAcceptanceRow>();

  if (!invitation || invitation.status !== 'pending') {
    throw new PlatformHttpError({
      status: 404,
      type: 'https://fmcgbyalex.com/problems/invitation-not-found',
      title: 'Invitation is invalid or no longer available'
    });
  }
  if (invitation.expires_at <= new Date().toISOString()) {
    await env.CONTROL_DB.prepare(
      `UPDATE tenant_invitations
       SET status = 'expired', updated_at = ?1, version = version + 1
       WHERE id = ?2 AND status = 'pending'`
    )
      .bind(new Date().toISOString(), invitation.id)
      .run();
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/invitation-expired',
      title: 'Invitation has expired'
    });
  }
  if (invitation.email_normalized !== identity.email) {
    throw new PlatformHttpError({
      status: 403,
      type: 'https://fmcgbyalex.com/problems/invitation-email-mismatch',
      title: 'Invitation email does not match the authenticated identity'
    });
  }

  const users = await env.CONTROL_DB.prepare(
    `SELECT id, identity_provider_subject, email_normalized, display_name
     FROM users
     WHERE identity_provider_subject = ?1 OR email_normalized = ?2`
  )
    .bind(identity.subject, identity.email)
    .all<UserIdentityRow>();
  const bySubject = users.results.find(
    (candidate) => candidate.identity_provider_subject === identity.subject
  );
  const conflictingEmail = users.results.find(
    (candidate) =>
      candidate.email_normalized === identity.email &&
      candidate.identity_provider_subject !== identity.subject
  );
  if (conflictingEmail) {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/identity-email-conflict',
      title: 'Email address is already linked to another identity'
    });
  }

  const roleKeys = splitKeys(invitation.role_keys);
  const roles = await resolveRoles(env.CONTROL_DB, invitation.tenant_id, roleKeys);
  const userId = bySubject?.id ?? `usr_${crypto.randomUUID()}`;
  const displayName =
    identity.displayName ?? invitation.display_name ?? identity.email;
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    env.CONTROL_DB.prepare(
      `INSERT INTO users (
         id, identity_provider_subject, email_normalized, display_name,
         status, created_at, updated_at
       ) VALUES (?1, ?2, ?3, ?4, 'active', ?5, ?5)
       ON CONFLICT(identity_provider_subject) DO UPDATE SET
         email_normalized = excluded.email_normalized,
         display_name = excluded.display_name,
         status = 'active', updated_at = excluded.updated_at`
    ).bind(userId, identity.subject, identity.email, displayName, now),
    env.CONTROL_DB.prepare(
      `INSERT INTO memberships (tenant_id, user_id, status, created_at, updated_at)
       VALUES (?1, ?2, 'active', ?3, ?3)
       ON CONFLICT(tenant_id, user_id) DO UPDATE SET
         status = 'active', updated_at = excluded.updated_at`
    ).bind(invitation.tenant_id, userId, now),
    env.CONTROL_DB.prepare(
      'DELETE FROM membership_roles WHERE tenant_id = ?1 AND user_id = ?2'
    ).bind(invitation.tenant_id, userId),
    env.CONTROL_DB.prepare(
      `UPDATE tenant_invitations
       SET status = 'accepted', accepted_at = ?1, updated_at = ?1,
           version = version + 1
       WHERE id = ?2 AND status = 'pending'`
    ).bind(now, invitation.id)
  ];

  for (const role of roles) {
    statements.push(
      env.CONTROL_DB.prepare(
        `INSERT INTO membership_roles (tenant_id, user_id, role_id, created_at)
         VALUES (?1, ?2, ?3, ?4)`
      ).bind(invitation.tenant_id, userId, role.id, now)
    );
  }

  statements.push(
    env.CONTROL_DB.prepare(
      `INSERT INTO audit_events (
         id, tenant_id, actor_type, actor_id, action, resource_type,
         resource_id, outcome, correlation_id, metadata_json, occurred_at
       ) VALUES (?1, ?2, 'user', ?3, 'platform.invitation.accept',
         'tenant-invitation', ?4, 'success', ?5, ?6, ?7)`
    ).bind(
      crypto.randomUUID(),
      invitation.tenant_id,
      userId,
      invitation.id,
      correlationId,
      JSON.stringify({ roleKeys }),
      now
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO outbox_events (
         id, tenant_id, event_type, aggregate_type, aggregate_id,
         aggregate_version, payload_json, correlation_id, occurred_at
       ) VALUES (?1, ?2, 'platform.invitation.accepted.v1',
         'tenant-invitation', ?3, 2, ?4, ?5, ?6)`
    ).bind(
      crypto.randomUUID(),
      invitation.tenant_id,
      invitation.id,
      JSON.stringify({ invitationId: invitation.id, userId, roleKeys }),
      correlationId,
      now
    )
  );

  await env.CONTROL_DB.batch(statements);
  return {
    tenant: tenantFromInvitation(invitation),
    userId,
    roles: roleKeys
  };
}

export async function updateMembership(
  env: Env,
  request: Request,
  session: ResolvedSession,
  userId: string,
  input: UpdateMembershipRequest
): Promise<UpdateMembershipResponse> {
  await requireAdministrationAccess(env, request, session, [
    'platform.memberships.manage'
  ]);
  if (!['active', 'suspended'].includes(input.status)) {
    throw validationError('status must be active or suspended.');
  }
  const roleKeys = normalizeRoleKeys(input.roleKeys);
  const roles = await resolveRoles(
    env.CONTROL_DB,
    session.response.tenant.id,
    roleKeys
  );
  if (userId === session.response.user.id && input.status === 'suspended') {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/self-suspension-denied',
      title: 'You cannot suspend your own membership'
    });
  }

  const member = await env.CONTROL_DB.prepare(
    `SELECT
       u.id AS user_id, u.email_normalized, u.display_name,
       m.status, m.created_at, m.updated_at,
       GROUP_CONCAT(DISTINCT r.key) AS role_keys
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     LEFT JOIN membership_roles mr
       ON mr.tenant_id = m.tenant_id AND mr.user_id = m.user_id
     LEFT JOIN roles r ON r.id = mr.role_id
     WHERE m.tenant_id = ?1 AND m.user_id = ?2
     GROUP BY u.id, u.email_normalized, u.display_name,
              m.status, m.created_at, m.updated_at`
  )
    .bind(session.response.tenant.id, userId)
    .first<MembershipRow>();
  if (!member) {
    throw new PlatformHttpError({
      status: 404,
      type: 'https://fmcgbyalex.com/problems/member-not-found',
      title: 'Company member not found'
    });
  }

  const currentRoles = splitKeys(member.role_keys);
  const removesAdmin =
    currentRoles.includes('tenant-admin') &&
    (input.status !== 'active' || !roleKeys.includes('tenant-admin'));
  if (removesAdmin) {
    const activeAdmins = await env.CONTROL_DB.prepare(
      `SELECT COUNT(DISTINCT m.user_id) AS count
       FROM memberships m
       JOIN membership_roles mr
         ON mr.tenant_id = m.tenant_id AND mr.user_id = m.user_id
       JOIN roles r ON r.id = mr.role_id
       WHERE m.tenant_id = ?1 AND m.status = 'active'
         AND r.key = 'tenant-admin'`
    )
      .bind(session.response.tenant.id)
      .first<CountRow>();
    if ((activeAdmins?.count ?? 0) <= 1) {
      throw new PlatformHttpError({
        status: 409,
        type: 'https://fmcgbyalex.com/problems/last-administrator-protected',
        title: 'The final active tenant administrator cannot be removed'
      });
    }
  }

  const idempotencyKey = requireIdempotency(request);
  const requestHash = await sha256(
    JSON.stringify({
      tenantId: session.response.tenant.id,
      userId,
      status: input.status,
      roleKeys
    })
  );
  const scope = `platform.memberships.update:${userId}`;
  const replay = await readTenantReplay<UpdateMembershipResponse>(
    env.CONTROL_DB,
    session.response.tenant.id,
    scope,
    idempotencyKey,
    requestHash
  );
  if (replay) {
    return { ...replay, replayed: true };
  }

  const now = new Date().toISOString();
  const response: UpdateMembershipResponse = {
    membership: {
      userId,
      email: member.email_normalized,
      displayName: member.display_name,
      status: input.status,
      roles: roleKeys,
      createdAt: member.created_at,
      updatedAt: now
    },
    replayed: false
  };
  const statements: D1PreparedStatement[] = [
    env.CONTROL_DB.prepare(
      `INSERT INTO idempotency_keys (
         tenant_id, scope, idempotency_key, request_hash,
         response_status, response_body, created_at, expires_at
       ) VALUES (?1, ?2, ?3, ?4, 200, ?5, ?6, ?7)`
    ).bind(
      session.response.tenant.id,
      scope,
      idempotencyKey,
      requestHash,
      JSON.stringify(response),
      now,
      new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString()
    ),
    env.CONTROL_DB.prepare(
      `UPDATE memberships SET status = ?1, updated_at = ?2
       WHERE tenant_id = ?3 AND user_id = ?4`
    ).bind(input.status, now, session.response.tenant.id, userId),
    env.CONTROL_DB.prepare(
      'DELETE FROM membership_roles WHERE tenant_id = ?1 AND user_id = ?2'
    ).bind(session.response.tenant.id, userId)
  ];
  for (const role of roles) {
    statements.push(
      env.CONTROL_DB.prepare(
        `INSERT INTO membership_roles (tenant_id, user_id, role_id, created_at)
         VALUES (?1, ?2, ?3, ?4)`
      ).bind(session.response.tenant.id, userId, role.id, now)
    );
  }
  statements.push(
    env.CONTROL_DB.prepare(
      `INSERT INTO audit_events (
         id, tenant_id, actor_type, actor_id, action, resource_type,
         resource_id, outcome, correlation_id, metadata_json, occurred_at
       ) VALUES (?1, ?2, 'user', ?3, 'platform.membership.update',
         'membership', ?4, 'success', ?5, ?6, ?7)`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      session.response.user.id,
      userId,
      session.context.correlationId,
      JSON.stringify({ previousStatus: member.status, status: input.status, previousRoles: currentRoles, roleKeys }),
      now
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO outbox_events (
         id, tenant_id, event_type, aggregate_type, aggregate_id,
         aggregate_version, payload_json, correlation_id, occurred_at
       ) VALUES (?1, ?2, 'platform.membership.changed.v1',
         'membership', ?3, 1, ?4, ?5, ?6)`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      userId,
      JSON.stringify({ userId, status: input.status, roleKeys }),
      session.context.correlationId,
      now
    )
  );

  await env.CONTROL_DB.batch(statements);
  return response;
}

export async function revokeInvitation(
  env: Env,
  request: Request,
  session: ResolvedSession,
  invitationId: string
): Promise<RevokeInvitationResponse> {
  await requireAdministrationAccess(env, request, session, [
    'platform.invitations.manage'
  ]);
  const idempotencyKey = requireIdempotency(request);
  const requestHash = await sha256(
    JSON.stringify({ tenantId: session.response.tenant.id, invitationId })
  );
  const scope = `platform.invitations.revoke:${invitationId}`;
  const replay = await readTenantReplay<RevokeInvitationResponse>(
    env.CONTROL_DB,
    session.response.tenant.id,
    scope,
    idempotencyKey,
    requestHash
  );
  if (replay) {
    return { ...replay, replayed: true };
  }

  const invitation = await loadInvitation(
    env.CONTROL_DB,
    session.response.tenant.id,
    invitationId
  );
  if (invitation.status !== 'pending') {
    throw new PlatformHttpError({
      status: 409,
      type: 'https://fmcgbyalex.com/problems/invitation-not-pending',
      title: 'Only pending invitations can be revoked'
    });
  }

  const now = new Date().toISOString();
  const revoked: InvitationSummary = {
    ...toInvitationSummary(invitation),
    status: 'revoked'
  };
  const response: RevokeInvitationResponse = { invitation: revoked, replayed: false };
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare(
      `INSERT INTO idempotency_keys (
         tenant_id, scope, idempotency_key, request_hash,
         response_status, response_body, created_at, expires_at
       ) VALUES (?1, ?2, ?3, ?4, 200, ?5, ?6, ?7)`
    ).bind(
      session.response.tenant.id,
      scope,
      idempotencyKey,
      requestHash,
      JSON.stringify(response),
      now,
      new Date(Date.now() + IDEMPOTENCY_TTL_MS).toISOString()
    ),
    env.CONTROL_DB.prepare(
      `UPDATE tenant_invitations
       SET status = 'revoked', revoked_at = ?1, updated_at = ?1,
           version = version + 1
       WHERE id = ?2 AND tenant_id = ?3 AND status = 'pending'`
    ).bind(now, invitationId, session.response.tenant.id),
    env.CONTROL_DB.prepare(
      `INSERT INTO audit_events (
         id, tenant_id, actor_type, actor_id, action, resource_type,
         resource_id, outcome, correlation_id, metadata_json, occurred_at
       ) VALUES (?1, ?2, 'user', ?3, 'platform.invitation.revoke',
         'tenant-invitation', ?4, 'success', ?5, '{}', ?6)`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      session.response.user.id,
      invitationId,
      session.context.correlationId,
      now
    ),
    env.CONTROL_DB.prepare(
      `INSERT INTO outbox_events (
         id, tenant_id, event_type, aggregate_type, aggregate_id,
         aggregate_version, payload_json, correlation_id, occurred_at
       ) VALUES (?1, ?2, 'platform.invitation.revoked.v1',
         'tenant-invitation', ?3, 2, ?4, ?5, ?6)`
    ).bind(
      crypto.randomUUID(),
      session.response.tenant.id,
      invitationId,
      JSON.stringify({ invitationId }),
      session.context.correlationId,
      now
    )
  ]);
  return response;
}

async function requireAdministrationAccess(
  env: Env,
  request: Request,
  session: ResolvedSession,
  permissions: readonly string[]
): Promise<void> {
  await enforceModule(
    env.CONTROL_DB,
    request,
    session,
    'platform',
    permissions[0] ?? 'platform.administration'
  );
  for (const permission of permissions) {
    await enforcePermission(
      env.CONTROL_DB,
      request,
      session,
      permission,
      permission
    );
  }
}

async function ensureStandardRoles(db: D1Database, tenantId: string): Promise<void> {
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  for (const roleKey of Object.keys(STANDARD_ROLE_NAMES)) {
    const roleId = `rol_${roleKey.replaceAll('-', '_')}_${tenantId}`;
    statements.push(
      db.prepare(
        `INSERT INTO roles (
           id, tenant_id, key, display_name, is_system, created_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5)
         ON CONFLICT(tenant_id, key) DO NOTHING`
      ).bind(roleId, tenantId, roleKey, STANDARD_ROLE_NAMES[roleKey], now)
    );
  }
  await db.batch(statements);

  const roles = await db
    .prepare(
      `SELECT id, key, display_name, is_system
       FROM roles WHERE tenant_id = ?1 AND key IN ('tenant-admin', 'operator', 'viewer')`
    )
    .bind(tenantId)
    .all<RoleRow>();
  const permissionStatements: D1PreparedStatement[] = [];
  for (const role of roles.results) {
    for (const permission of STANDARD_ROLE_PERMISSIONS[role.key] ?? []) {
      permissionStatements.push(
        db.prepare(
          `INSERT INTO role_permissions (
             tenant_id, role_id, permission_key, created_at
           ) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(tenant_id, role_id, permission_key) DO NOTHING`
        ).bind(tenantId, role.id, permission, now)
      );
    }
  }
  if (permissionStatements.length > 0) {
    await db.batch(permissionStatements);
  }
}

async function resolveRoles(
  db: D1Database,
  tenantId: string,
  roleKeys: readonly string[]
): Promise<RoleRow[]> {
  const placeholders = roleKeys.map((_, index) => `?${index + 2}`).join(', ');
  const result = await db
    .prepare(
      `SELECT id, key, display_name, is_system
       FROM roles WHERE tenant_id = ?1 AND key IN (${placeholders})`
    )
    .bind(tenantId, ...roleKeys)
    .all<RoleRow>();
  const found = new Set(result.results.map((role) => role.key));
  const missing = roleKeys.filter((roleKey) => !found.has(roleKey));
  if (missing.length > 0) {
    throw validationError(`Unknown roleKeys: ${missing.join(', ')}.`);
  }
  return result.results;
}

async function loadInvitation(
  db: D1Database,
  tenantId: string,
  invitationId: string
): Promise<InvitationRow> {
  const invitation = await db
    .prepare(
      `SELECT
         i.id, i.tenant_id, i.email_normalized, i.display_name,
         i.token_ciphertext, i.token_iv, i.status, i.expires_at,
         i.created_at, i.updated_at, i.accepted_at,
         GROUP_CONCAT(DISTINCT r.key) AS role_keys
       FROM tenant_invitations i
       LEFT JOIN tenant_invitation_roles ir ON ir.invitation_id = i.id
       LEFT JOIN roles r ON r.id = ir.role_id
       WHERE i.tenant_id = ?1 AND i.id = ?2
       GROUP BY i.id`
    )
    .bind(tenantId, invitationId)
    .first<InvitationRow>();
  if (!invitation) {
    throw new PlatformHttpError({
      status: 404,
      type: 'https://fmcgbyalex.com/problems/invitation-not-found',
      title: 'Invitation not found'
    });
  }
  return invitation;
}

async function expireInvitations(db: D1Database, tenantId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE tenant_invitations
       SET status = 'expired', updated_at = ?1, version = version + 1
       WHERE tenant_id = ?2 AND status = 'pending' AND expires_at <= ?1`
    )
    .bind(now, tenantId)
    .run();
}

async function readOnboardingReplay(
  db: D1Database,
  subject: string,
  key: string,
  requestHash: string
): Promise<OnboardTenantResponse | null> {
  const row = await db
    .prepare(
      `SELECT request_hash, response_body FROM onboarding_requests
       WHERE identity_provider_subject = ?1 AND idempotency_key = ?2
         AND expires_at > ?3`
    )
    .bind(subject, key, new Date().toISOString())
    .first<OnboardingRow>();
  if (!row) {
    return null;
  }
  if (row.request_hash !== requestHash) {
    throw idempotencyConflict();
  }
  if (!row.response_body) {
    throw requestInProgress();
  }
  const parsed = JSON.parse(row.response_body) as OnboardTenantResponse;
  return { ...parsed, replayed: true };
}

async function readTenantReplay<T>(
  db: D1Database,
  tenantId: string,
  scope: string,
  key: string,
  requestHash: string
): Promise<T | null> {
  const row = await db
    .prepare(
      `SELECT request_hash, response_body FROM idempotency_keys
       WHERE tenant_id = ?1 AND scope = ?2 AND idempotency_key = ?3
         AND expires_at > ?4`
    )
    .bind(tenantId, scope, key, new Date().toISOString())
    .first<IdempotencyRow>();
  if (!row) {
    return null;
  }
  if (row.request_hash !== requestHash) {
    throw idempotencyConflict();
  }
  if (!row.response_body) {
    throw requestInProgress();
  }
  return JSON.parse(row.response_body) as T;
}

function toMembershipSummary(row: MembershipRow): MembershipSummary {
  return {
    userId: row.user_id,
    email: row.email_normalized,
    displayName: row.display_name,
    status: row.status,
    roles: splitKeys(row.role_keys),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toInvitationSummary(row: InvitationRow): InvitationSummary {
  return {
    id: row.id,
    email: row.email_normalized,
    displayName: row.display_name,
    status: row.status,
    roles: splitKeys(row.role_keys),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at
  };
}

function tenantFromInvitation(row: InvitationAcceptanceRow): TenantSummary {
  return {
    id: row.tenant_id,
    slug: row.tenant_slug,
    displayName: row.tenant_display_name,
    defaultCurrency: row.default_currency,
    defaultLocale: row.default_locale,
    defaultTimezone: row.default_timezone
  };
}

function splitKeys(value: string | null): string[] {
  return value
    ? [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))].sort()
    : [];
}

function normalizeRoleKeys(values: string[]): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > 20) {
    throw validationError('roleKeys must contain 1 to 20 roles.');
  }
  const normalized = [...new Set(values.map((value) => value.trim().toLowerCase()))].sort();
  if (normalized.some((value) => !ROLE_KEY_PATTERN.test(value) || value.length > 80)) {
    throw validationError('roleKeys contain an invalid role key.');
  }
  return normalized;
}

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    throw validationError('email must be a valid email address.');
  }
  return email;
}

function requiredText(
  value: string,
  field: string,
  minimum: number,
  maximum: number
): string {
  const normalized = value?.trim() ?? '';
  if (normalized.length < minimum || normalized.length > maximum) {
    throw validationError(`${field} must contain ${minimum} to ${maximum} characters.`);
  }
  return normalized;
}

function optionalText(value: string | undefined, maximum: number): string | undefined {
  const normalized = value?.trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.length > maximum) {
    throw validationError(`displayName must contain at most ${maximum} characters.`);
  }
  return normalized;
}

function validateTimezone(value: string): void {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format();
  } catch {
    throw validationError('defaultTimezone must be a valid IANA timezone.');
  }
}

function requireIdempotency(request: Request): string {
  const key = request.headers.get('Idempotency-Key')?.trim() ?? '';
  if (!IDEMPOTENCY_PATTERN.test(key)) {
    throw new PlatformHttpError({
      status: 400,
      type: 'https://fmcgbyalex.com/problems/idempotency-key-required',
      title: 'A valid Idempotency-Key header is required'
    });
  }
  return key;
}

function validationError(detail: string): PlatformHttpError {
  return new PlatformHttpError({
    status: 400,
    type: 'https://fmcgbyalex.com/problems/validation-error',
    title: 'Request validation failed',
    detail
  });
}

function idempotencyConflict(): PlatformHttpError {
  return new PlatformHttpError({
    status: 409,
    type: 'https://fmcgbyalex.com/problems/idempotency-key-conflict',
    title: 'Idempotency key conflict'
  });
}

function requestInProgress(): PlatformHttpError {
  return new PlatformHttpError({
    status: 409,
    type: 'https://fmcgbyalex.com/problems/request-in-progress',
    title: 'An identical request is already in progress'
  });
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

async function encryptToken(
  configuredKey: string,
  token: string
): Promise<{ ciphertext: string; iv: string }> {
  const key = await invitationKey(configuredKey);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(token)
  );
  return {
    ciphertext: base64Encode(new Uint8Array(encrypted)),
    iv: base64Encode(iv)
  };
}

async function decryptToken(
  configuredKey: string,
  ciphertext: string,
  iv: string
): Promise<string> {
  const key = await invitationKey(configuredKey);
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64Decode(iv) },
    key,
    base64Decode(ciphertext)
  );
  return new TextDecoder().decode(decrypted);
}

async function invitationKey(value: string): Promise<CryptoKey> {
  let bytes: Uint8Array;
  try {
    bytes = base64Decode(value.trim());
  } catch {
    throw invitationConfigurationError();
  }
  if (bytes.byteLength !== 32) {
    throw invitationConfigurationError();
  }
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function invitationConfigurationError(): PlatformHttpError {
  return new PlatformHttpError({
    status: 503,
    type: 'https://fmcgbyalex.com/problems/invitation-service-unavailable',
    title: 'Invitation service is not configured',
    detail: 'INVITATION_ENCRYPTION_KEY must contain a base64-encoded 256-bit key.'
  });
}

function base64Encode(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64Decode(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function base64UrlEncode(value: Uint8Array): string {
  return base64Encode(value)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
