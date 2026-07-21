PRAGMA foreign_keys = ON;

INSERT INTO permissions (key, display_name, description, risk_level, created_at) VALUES
  ('master-data.catalog.read', 'Read product catalog', 'Read products, variants, packs, units and conversions.', 'low', CURRENT_TIMESTAMP),
  ('master-data.catalog.manage', 'Manage product catalog', 'Create and maintain products, variants, packs, units and conversions.', 'high', CURRENT_TIMESTAMP),
  ('master-data.locations.read', 'Read operating locations', 'Read legal entities, sites, warehouses, zones and bins.', 'low', CURRENT_TIMESTAMP),
  ('master-data.locations.manage', 'Manage operating locations', 'Create and maintain legal entities, sites, warehouses, zones and bins.', 'high', CURRENT_TIMESTAMP),
  ('master-data.parties.read', 'Read business parties', 'Read suppliers, customers, distributors and retailers.', 'low', CURRENT_TIMESTAMP),
  ('master-data.parties.manage', 'Manage business parties', 'Create and maintain suppliers, customers, distributors and retailers.', 'high', CURRENT_TIMESTAMP),
  ('inventory.stock.read', 'Read inventory', 'Read stock balances, lots, movements, FEFO and aging reports.', 'low', CURRENT_TIMESTAMP),
  ('inventory.stock.receive', 'Receive inventory', 'Receive stock into warehouses, bins and lots.', 'high', CURRENT_TIMESTAMP),
  ('inventory.stock.adjust', 'Adjust inventory', 'Post controlled stock adjustments and reversals.', 'critical', CURRENT_TIMESTAMP),
  ('inventory.stock.transfer', 'Transfer inventory', 'Transfer stock between warehouses and bins.', 'high', CURRENT_TIMESTAMP),
  ('inventory.stock.quarantine', 'Control inventory status', 'Quarantine and release stock through status-transfer ledger entries.', 'high', CURRENT_TIMESTAMP),
  ('inventory.settings.manage', 'Manage inventory settings', 'Configure inventory aging and allocation policies.', 'high', CURRENT_TIMESTAMP)
ON CONFLICT(key) DO NOTHING;

INSERT OR IGNORE INTO role_permissions (tenant_id, role_id, permission_key, created_at)
SELECT r.tenant_id, r.id, p.key, CURRENT_TIMESTAMP
FROM roles r
JOIN permissions p ON p.key IN (
  'master-data.catalog.read',
  'master-data.catalog.manage',
  'master-data.locations.read',
  'master-data.locations.manage',
  'master-data.parties.read',
  'master-data.parties.manage',
  'inventory.stock.read',
  'inventory.stock.receive',
  'inventory.stock.adjust',
  'inventory.stock.transfer',
  'inventory.stock.quarantine',
  'inventory.settings.manage'
)
WHERE r.key = 'tenant-admin';

INSERT OR IGNORE INTO role_permissions (tenant_id, role_id, permission_key, created_at)
SELECT r.tenant_id, r.id, p.key, CURRENT_TIMESTAMP
FROM roles r
JOIN permissions p ON p.key IN (
  'master-data.catalog.read',
  'master-data.locations.read',
  'master-data.parties.read',
  'inventory.stock.read',
  'inventory.stock.receive',
  'inventory.stock.transfer',
  'inventory.stock.quarantine'
)
WHERE r.key = 'operator';

INSERT OR IGNORE INTO role_permissions (tenant_id, role_id, permission_key, created_at)
SELECT r.tenant_id, r.id, p.key, CURRENT_TIMESTAMP
FROM roles r
JOIN permissions p ON p.key IN (
  'master-data.catalog.read',
  'master-data.locations.read',
  'master-data.parties.read',
  'inventory.stock.read'
)
WHERE r.key = 'viewer';
