PRAGMA foreign_keys = ON;

INSERT INTO permissions (key, display_name, description, risk_level, created_at) VALUES
  ('crm.accounts.read', 'Read CRM accounts', 'Read CRM accounts, contacts and account summaries.', 'low', CURRENT_TIMESTAMP),
  ('crm.accounts.manage', 'Manage CRM accounts', 'Create and maintain CRM accounts and contacts.', 'high', CURRENT_TIMESTAMP),
  ('crm.activities.read', 'Read CRM activity', 'Read account activity history and follow-up tasks.', 'low', CURRENT_TIMESTAMP),
  ('crm.activities.manage', 'Manage CRM activity', 'Create activities, tasks and complete follow-ups.', 'high', CURRENT_TIMESTAMP),
  ('crm.pipeline.read', 'Read CRM pipeline', 'Read opportunities, stages and weighted pipeline.', 'low', CURRENT_TIMESTAMP),
  ('crm.pipeline.manage', 'Manage CRM pipeline', 'Create opportunities and change commercial stages.', 'high', CURRENT_TIMESTAMP),
  ('sales.pricing.read', 'Read sales pricing', 'Read price lists and customer pricing.', 'low', CURRENT_TIMESTAMP),
  ('sales.pricing.manage', 'Manage sales pricing', 'Create and maintain price lists and price items.', 'critical', CURRENT_TIMESTAMP),
  ('sales.quotes.read', 'Read quotations', 'Read commercial quotations and quote versions.', 'low', CURRENT_TIMESTAMP),
  ('sales.quotes.manage', 'Manage quotations', 'Create, send and accept commercial quotations.', 'high', CURRENT_TIMESTAMP),
  ('sales.orders.read', 'Read sales orders', 'Read sales orders, lines, reservations and availability.', 'low', CURRENT_TIMESTAMP),
  ('sales.orders.manage', 'Manage sales orders', 'Convert quotations, manage orders and cancel commitments.', 'critical', CURRENT_TIMESTAMP),
  ('sales.orders.reserve', 'Reserve inventory for orders', 'Create and release inventory reservations for confirmed orders.', 'critical', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO NOTHING;

INSERT OR IGNORE INTO role_permissions (tenant_id, role_id, permission_key, created_at)
SELECT r.tenant_id, r.id, p.key, CURRENT_TIMESTAMP
FROM roles r
JOIN permissions p ON p.key IN (
  'crm.accounts.read', 'crm.accounts.manage',
  'crm.activities.read', 'crm.activities.manage',
  'crm.pipeline.read', 'crm.pipeline.manage',
  'sales.pricing.read', 'sales.pricing.manage',
  'sales.quotes.read', 'sales.quotes.manage',
  'sales.orders.read', 'sales.orders.manage', 'sales.orders.reserve'
)
WHERE r.key = 'tenant-admin';

INSERT OR IGNORE INTO role_permissions (tenant_id, role_id, permission_key, created_at)
SELECT r.tenant_id, r.id, p.key, CURRENT_TIMESTAMP
FROM roles r
JOIN permissions p ON p.key IN (
  'crm.accounts.read', 'crm.accounts.manage',
  'crm.activities.read', 'crm.activities.manage',
  'crm.pipeline.read', 'crm.pipeline.manage',
  'sales.pricing.read',
  'sales.quotes.read', 'sales.quotes.manage',
  'sales.orders.read', 'sales.orders.manage', 'sales.orders.reserve'
)
WHERE r.key = 'operator';

INSERT OR IGNORE INTO role_permissions (tenant_id, role_id, permission_key, created_at)
SELECT r.tenant_id, r.id, p.key, CURRENT_TIMESTAMP
FROM roles r
JOIN permissions p ON p.key IN (
  'crm.accounts.read', 'crm.activities.read', 'crm.pipeline.read',
  'sales.pricing.read', 'sales.quotes.read', 'sales.orders.read'
)
WHERE r.key = 'viewer';

CREATE TRIGGER roles_grant_tenant_admin_commercial_permissions
AFTER INSERT ON roles
WHEN NEW.key = 'tenant-admin'
BEGIN
  INSERT OR IGNORE INTO role_permissions (tenant_id, role_id, permission_key, created_at)
  SELECT NEW.tenant_id, NEW.id, p.key, CURRENT_TIMESTAMP
  FROM permissions p
  WHERE p.key IN (
    'crm.accounts.read', 'crm.accounts.manage',
    'crm.activities.read', 'crm.activities.manage',
    'crm.pipeline.read', 'crm.pipeline.manage',
    'sales.pricing.read', 'sales.pricing.manage',
    'sales.quotes.read', 'sales.quotes.manage',
    'sales.orders.read', 'sales.orders.manage', 'sales.orders.reserve'
  );
END;

CREATE TRIGGER roles_grant_operator_commercial_permissions
AFTER INSERT ON roles
WHEN NEW.key = 'operator'
BEGIN
  INSERT OR IGNORE INTO role_permissions (tenant_id, role_id, permission_key, created_at)
  SELECT NEW.tenant_id, NEW.id, p.key, CURRENT_TIMESTAMP
  FROM permissions p
  WHERE p.key IN (
    'crm.accounts.read', 'crm.accounts.manage',
    'crm.activities.read', 'crm.activities.manage',
    'crm.pipeline.read', 'crm.pipeline.manage',
    'sales.pricing.read',
    'sales.quotes.read', 'sales.quotes.manage',
    'sales.orders.read', 'sales.orders.manage', 'sales.orders.reserve'
  );
END;

CREATE TRIGGER roles_grant_viewer_commercial_permissions
AFTER INSERT ON roles
WHEN NEW.key = 'viewer'
BEGIN
  INSERT OR IGNORE INTO role_permissions (tenant_id, role_id, permission_key, created_at)
  SELECT NEW.tenant_id, NEW.id, p.key, CURRENT_TIMESTAMP
  FROM permissions p
  WHERE p.key IN (
    'crm.accounts.read', 'crm.activities.read', 'crm.pipeline.read',
    'sales.pricing.read', 'sales.quotes.read', 'sales.orders.read'
  );
END;

UPDATE tenant_modules
SET enabled = 1,
    enabled_at = COALESCE(enabled_at, CURRENT_TIMESTAMP),
    disabled_at = NULL,
    updated_at = CURRENT_TIMESTAMP,
    version = version + 1
WHERE module_key IN ('crm', 'sales') AND enabled = 0;
