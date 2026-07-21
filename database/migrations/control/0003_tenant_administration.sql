PRAGMA foreign_keys = ON;

CREATE TABLE tenant_invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  display_name TEXT,
  token_hash TEXT NOT NULL UNIQUE,
  token_ciphertext TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by_user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (invited_by_user_id) REFERENCES users(id)
);

CREATE UNIQUE INDEX tenant_invitations_pending_email_uq
  ON tenant_invitations(tenant_id, email_normalized)
  WHERE status = 'pending';

CREATE INDEX tenant_invitations_tenant_status_idx
  ON tenant_invitations(tenant_id, status, created_at DESC);

CREATE INDEX tenant_invitations_expiry_idx
  ON tenant_invitations(status, expires_at);

CREATE TABLE tenant_invitation_roles (
  invitation_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  PRIMARY KEY (invitation_id, role_id),
  FOREIGN KEY (invitation_id) REFERENCES tenant_invitations(id) ON DELETE CASCADE,
  FOREIGN KEY (role_id) REFERENCES roles(id)
);

CREATE TABLE onboarding_requests (
  identity_provider_subject TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_body TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (identity_provider_subject, idempotency_key)
);

CREATE INDEX onboarding_requests_expiry_idx ON onboarding_requests(expires_at);

INSERT INTO permissions (key, display_name, description, risk_level, created_at) VALUES
  ('platform.memberships.read', 'Read memberships', 'Read company users, membership status and assigned roles.', 'medium', CURRENT_TIMESTAMP),
  ('platform.memberships.manage', 'Manage memberships', 'Activate or suspend members and assign tenant roles.', 'critical', CURRENT_TIMESTAMP),
  ('platform.roles.read', 'Read roles', 'Read available tenant roles and their permission grants.', 'medium', CURRENT_TIMESTAMP),
  ('platform.roles.manage', 'Manage roles', 'Create and change custom roles and permission grants.', 'critical', CURRENT_TIMESTAMP),
  ('platform.invitations.manage', 'Manage invitations', 'Invite users, assign initial roles and revoke pending invitations.', 'high', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_key, created_at)
SELECT r.tenant_id, r.id, p.key, CURRENT_TIMESTAMP
FROM roles r
JOIN permissions p ON p.key IN (
  'platform.memberships.read',
  'platform.memberships.manage',
  'platform.roles.read',
  'platform.roles.manage',
  'platform.invitations.manage'
)
WHERE r.key = 'tenant-admin'
ON CONFLICT(tenant_id, role_id, permission_key) DO NOTHING;

INSERT INTO roles (id, tenant_id, key, display_name, is_system, created_at, updated_at)
SELECT 'rol_operator_' || t.id, t.id, 'operator', 'Business Operator', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM tenants t
ON CONFLICT(tenant_id, key) DO NOTHING;

INSERT INTO roles (id, tenant_id, key, display_name, is_system, created_at, updated_at)
SELECT 'rol_viewer_' || t.id, t.id, 'viewer', 'Read-only Viewer', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM tenants t
ON CONFLICT(tenant_id, key) DO NOTHING;

INSERT INTO role_permissions (tenant_id, role_id, permission_key, created_at)
SELECT r.tenant_id, r.id, p.key, CURRENT_TIMESTAMP
FROM roles r
JOIN permissions p ON p.key IN (
  'platform.session.read',
  'platform.modules.read',
  'platform.memberships.read',
  'platform.roles.read'
)
WHERE r.key IN ('operator', 'viewer')
ON CONFLICT(tenant_id, role_id, permission_key) DO NOTHING;
