PRAGMA foreign_keys = ON;

CREATE TABLE approval_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_key_snapshot TEXT NOT NULL,
  policy_name_snapshot TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  payload_json TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')),
  execution_status TEXT NOT NULL CHECK (execution_status IN ('pending', 'completed', 'not-required', 'failed')),
  current_step_number INTEGER NOT NULL CHECK (current_step_number > 0),
  total_steps INTEGER NOT NULL CHECK (total_steps > 0),
  expires_at TEXT NOT NULL,
  resolved_at TEXT,
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (policy_id) REFERENCES approval_policies(id),
  FOREIGN KEY (requester_user_id) REFERENCES users(id)
);

CREATE INDEX approval_requests_tenant_status_idx
  ON approval_requests(tenant_id, status, created_at DESC);
CREATE INDEX approval_requests_requester_idx
  ON approval_requests(tenant_id, requester_user_id, created_at DESC);
CREATE INDEX approval_requests_expiry_idx
  ON approval_requests(status, expires_at);

CREATE TABLE approval_request_steps (
  request_id TEXT NOT NULL,
  step_number INTEGER NOT NULL CHECK (step_number > 0),
  required_permission TEXT NOT NULL,
  minimum_approvers INTEGER NOT NULL CHECK (minimum_approvers > 0),
  self_approval_allowed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  approved_count INTEGER NOT NULL DEFAULT 0,
  resolved_at TEXT,
  PRIMARY KEY (request_id, step_number),
  FOREIGN KEY (request_id) REFERENCES approval_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (required_permission) REFERENCES permissions(key)
);

CREATE TABLE approval_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  decider_user_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approve', 'reject')),
  comment TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (request_id, step_number, decider_user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (request_id, step_number)
    REFERENCES approval_request_steps(request_id, step_number) ON DELETE CASCADE,
  FOREIGN KEY (decider_user_id) REFERENCES users(id)
);

CREATE INDEX approval_decisions_request_idx
  ON approval_decisions(request_id, step_number, created_at);

INSERT INTO permissions (key, display_name, description, risk_level, created_at) VALUES
  ('platform.approvals.read', 'Read approvals', 'Read approval policies, requests, steps and decisions for the active tenant.', 'medium', CURRENT_TIMESTAMP),
  ('platform.approvals.request', 'Request approvals', 'Submit tenant actions to an enabled approval policy.', 'high', CURRENT_TIMESTAMP),
  ('platform.approvals.decide', 'Decide approvals', 'Approve or reject requests when the current policy step permits it.', 'critical', CURRENT_TIMESTAMP),
  ('platform.approval-policies.read', 'Read approval policies', 'Read maker-checker policy definitions and step requirements.', 'high', CURRENT_TIMESTAMP),
  ('platform.approval-policies.manage', 'Manage approval policies', 'Create, enable, disable and change maker-checker policy steps.', 'critical', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO NOTHING;

INSERT OR IGNORE INTO role_permissions (tenant_id, role_id, permission_key, created_at)
SELECT r.tenant_id, r.id, p.key, CURRENT_TIMESTAMP
FROM roles r
JOIN permissions p ON p.key IN (
  'platform.approvals.read',
  'platform.approvals.request',
  'platform.approvals.decide',
  'platform.approval-policies.read',
  'platform.approval-policies.manage'
)
WHERE r.key = 'tenant-admin';

INSERT OR IGNORE INTO role_permissions (tenant_id, role_id, permission_key, created_at)
SELECT r.tenant_id, r.id, p.key, CURRENT_TIMESTAMP
FROM roles r
JOIN permissions p ON p.key IN ('platform.approvals.read', 'platform.approval-policies.read')
WHERE r.key IN ('operator', 'viewer');

INSERT OR IGNORE INTO approval_policies (
  id, tenant_id, key, display_name, resource_type, action,
  condition_json, enabled, created_at, updated_at, version
)
SELECT
  'pol_module_' || t.id,
  t.id,
  'module-entitlement-change',
  'Module entitlement change',
  'module-entitlement',
  'platform.module-entitlement.set',
  '{}',
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP,
  1
FROM tenants t;

INSERT OR IGNORE INTO approval_policy_steps (
  policy_id, step_number, required_permission,
  minimum_approvers, self_approval_allowed
)
SELECT
  p.id,
  1,
  'platform.modules.manage',
  1,
  0
FROM approval_policies p
WHERE p.key = 'module-entitlement-change';

CREATE TRIGGER tenant_default_approval_policy_after_insert
AFTER INSERT ON tenants
BEGIN
  INSERT OR IGNORE INTO approval_policies (
    id, tenant_id, key, display_name, resource_type, action,
    condition_json, enabled, created_at, updated_at, version
  ) VALUES (
    'pol_module_' || NEW.id,
    NEW.id,
    'module-entitlement-change',
    'Module entitlement change',
    'module-entitlement',
    'platform.module-entitlement.set',
    '{}',
    1,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP,
    1
  );

  INSERT OR IGNORE INTO approval_policy_steps (
    policy_id, step_number, required_permission,
    minimum_approvers, self_approval_allowed
  )
  SELECT
    p.id,
    1,
    'platform.modules.manage',
    1,
    0
  FROM approval_policies p
  WHERE p.tenant_id = NEW.id
    AND p.key = 'module-entitlement-change';
END;
