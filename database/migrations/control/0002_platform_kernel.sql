PRAGMA foreign_keys = ON;

ALTER TABLE module_catalog
  ADD COLUMN delivery_status TEXT NOT NULL DEFAULT 'planned'
  CHECK (delivery_status IN ('planned', 'foundation', 'available'));

CREATE TABLE permissions (
  key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  created_at TEXT NOT NULL
);

CREATE TABLE role_permissions (
  tenant_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, role_id, permission_key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (role_id) REFERENCES roles(id),
  FOREIGN KEY (permission_key) REFERENCES permissions(key)
);

CREATE INDEX role_permissions_lookup_idx
  ON role_permissions(tenant_id, role_id, permission_key);

CREATE TABLE approval_policies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  action TEXT NOT NULL,
  condition_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, key),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE TABLE approval_policy_steps (
  policy_id TEXT NOT NULL,
  step_number INTEGER NOT NULL CHECK (step_number > 0),
  required_permission TEXT NOT NULL,
  minimum_approvers INTEGER NOT NULL DEFAULT 1 CHECK (minimum_approvers > 0),
  self_approval_allowed INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (policy_id, step_number),
  FOREIGN KEY (policy_id) REFERENCES approval_policies(id),
  FOREIGN KEY (required_permission) REFERENCES permissions(key)
);

CREATE INDEX idempotency_keys_expiry_idx
  ON idempotency_keys(expires_at);

INSERT INTO permissions (key, display_name, description, risk_level, created_at) VALUES
  ('platform.session.read', 'Read own session', 'Read the active user, tenant, roles, permissions and module context.', 'low', CURRENT_TIMESTAMP),
  ('platform.modules.read', 'Read module entitlements', 'Read modules and their tenant entitlement state.', 'low', CURRENT_TIMESTAMP),
  ('platform.modules.manage', 'Manage module entitlements', 'Enable or disable tenant modules and their background processing.', 'high', CURRENT_TIMESTAMP),
  ('platform.tenants.manage', 'Manage tenants', 'Create and administer tenant companies and operating defaults.', 'critical', CURRENT_TIMESTAMP),
  ('platform.audit.read', 'Read audit trail', 'Read immutable security and administrative audit events.', 'high', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO NOTHING;

INSERT INTO module_catalog (
  key, display_name, description, lifecycle_status, delivery_status
) VALUES
  ('platform', 'Platform & Administration', 'Tenants, users, roles, workflows, files, notifications and audit.', 'foundation', 'foundation'),
  ('master-data', 'Master Data', 'Products, packs, parties, locations, units, currencies and classifications.', 'foundation', 'foundation'),
  ('procurement', 'Procurement', 'Sourcing, suppliers, purchase orders, inbound logistics and landed cost.', 'foundation', 'planned'),
  ('production', 'Production', 'MRP, recipes, capacity, scheduling, quality and maintenance.', 'foundation', 'planned'),
  ('workforce', 'Workforce', 'Shifts, skills, attendance, labor planning and training.', 'foundation', 'planned'),
  ('inventory', 'Inventory & WMS', 'Lots, expiry, aging, FEFO, counts, reservations and dispatch.', 'foundation', 'foundation'),
  ('sales', 'Sales', 'Pricing, quotations, orders, allocation, delivery and returns.', 'foundation', 'foundation'),
  ('finance', 'Finance', 'Accounting, invoicing, receivables, payables, tax and cash.', 'foundation', 'planned'),
  ('crm', 'CRM', 'Accounts, contacts, activities, pipeline, service and follow-up.', 'foundation', 'foundation'),
  ('field-execution', 'Field Execution', 'Visits, merchandising, surveys, evidence and sales-rep execution.', 'foundation', 'planned'),
  ('geospatial', 'Routes & Zones', 'Territories, mapping, routing, zoning and proof of visit.', 'foundation', 'planned'),
  ('distributors', 'Distributor Management', 'Distributor agreements, inventory, sell-in, sell-out and performance.', 'foundation', 'planned'),
  ('retailers', 'Retailer Management', 'Outlet hierarchy, assortment, terms, coverage and execution.', 'foundation', 'planned'),
  ('trade-terms', 'Commercial Terms', 'Price lists, contracts, promotions, accruals and claims.', 'foundation', 'planned'),
  ('returns-rebates', 'Returns & Rebates', 'Returns, deductions, rebate calculation, evidence and settlement.', 'foundation', 'planned'),
  ('ecommerce', 'E-commerce', 'B2B ordering, D2C, marketplaces, subscriptions and fulfillment.', 'foundation', 'planned'),
  ('marketing', 'Marketing Campaigns', 'Segments, campaigns, journeys, consent, attribution and ROI.', 'foundation', 'planned'),
  ('analytics', 'Planning & Analytics', 'Dashboards, forecasts, S&OP, scenarios and operational alerts.', 'foundation', 'planned'),
  ('integrations', 'Integrations', 'ERP, EDI, payment, tax, maps, marketplace and BI connections.', 'foundation', 'planned')
ON CONFLICT(key) DO UPDATE SET
  display_name = excluded.display_name,
  description = excluded.description,
  lifecycle_status = excluded.lifecycle_status,
  delivery_status = excluded.delivery_status;
