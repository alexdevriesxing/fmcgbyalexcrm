PRAGMA foreign_keys = ON;

CREATE TABLE tenant_inventory_settings (
  tenant_id TEXT PRIMARY KEY,
  aging_buckets_json TEXT NOT NULL DEFAULT '[30,60,90,180]',
  allow_negative_stock INTEGER NOT NULL DEFAULT 0 CHECK (allow_negative_stock IN (0, 1)),
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0)
);

CREATE TABLE units_of_measure (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  precision_digits INTEGER NOT NULL DEFAULT 0 CHECK (precision_digits BETWEEN 0 AND 6),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE unit_conversions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  from_unit_id TEXT NOT NULL,
  to_unit_id TEXT NOT NULL,
  numerator INTEGER NOT NULL CHECK (numerator > 0),
  denominator INTEGER NOT NULL CHECK (denominator > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, from_unit_id, to_unit_id),
  FOREIGN KEY (tenant_id, from_unit_id) REFERENCES units_of_measure(tenant_id, id),
  FOREIGN KEY (tenant_id, to_unit_id) REFERENCES units_of_measure(tenant_id, id),
  CHECK (from_unit_id <> to_unit_id)
);

CREATE TABLE product_brands (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE product_categories (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  parent_category_id TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, parent_category_id) REFERENCES product_categories(tenant_id, id)
);

CREATE TABLE products (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  brand_id TEXT NOT NULL,
  category_id TEXT NOT NULL,
  base_unit_id TEXT NOT NULL,
  shelf_life_days INTEGER CHECK (shelf_life_days IS NULL OR shelf_life_days >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, brand_id) REFERENCES product_brands(tenant_id, id),
  FOREIGN KEY (tenant_id, category_id) REFERENCES product_categories(tenant_id, id),
  FOREIGN KEY (tenant_id, base_unit_id) REFERENCES units_of_measure(tenant_id, id)
);

CREATE TABLE product_variants (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  display_name TEXT NOT NULL,
  barcode TEXT,
  base_unit_id TEXT NOT NULL,
  pack_quantity_base INTEGER NOT NULL CHECK (pack_quantity_base > 0),
  case_quantity_base INTEGER CHECK (case_quantity_base IS NULL OR case_quantity_base > 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, sku),
  UNIQUE (tenant_id, barcode),
  FOREIGN KEY (tenant_id, product_id) REFERENCES products(tenant_id, id),
  FOREIGN KEY (tenant_id, base_unit_id) REFERENCES units_of_measure(tenant_id, id)
);

CREATE INDEX product_variants_product_idx ON product_variants(tenant_id, product_id, active);

CREATE TABLE legal_entities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  country_code TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE TABLE sites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  legal_entity_id TEXT NOT NULL,
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES legal_entities(tenant_id, id)
);

CREATE TABLE warehouses (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL,
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, site_id) REFERENCES sites(tenant_id, id)
);

CREATE TABLE warehouse_zones (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, warehouse_id, code),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id)
);

CREATE UNIQUE INDEX warehouse_default_zone_uq
  ON warehouse_zones(tenant_id, warehouse_id)
  WHERE is_default = 1;

CREATE TABLE warehouse_bins (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, warehouse_id, code),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, zone_id) REFERENCES warehouse_zones(tenant_id, id)
);

CREATE UNIQUE INDEX warehouse_default_bin_uq
  ON warehouse_bins(tenant_id, warehouse_id)
  WHERE is_default = 1;

CREATE TABLE business_parties (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  party_type TEXT NOT NULL CHECK (party_type IN ('supplier', 'customer', 'distributor', 'retailer')),
  country_code TEXT NOT NULL,
  tax_id TEXT,
  email TEXT,
  phone TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code)
);

CREATE INDEX business_parties_type_idx ON business_parties(tenant_id, party_type, active);

CREATE TABLE inventory_lots (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  lot_code TEXT NOT NULL,
  manufactured_on TEXT,
  expires_on TEXT,
  supplier_party_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, variant_id, lot_code),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES product_variants(tenant_id, id),
  FOREIGN KEY (tenant_id, supplier_party_id) REFERENCES business_parties(tenant_id, id),
  CHECK (manufactured_on IS NULL OR expires_on IS NULL OR manufactured_on <= expires_on)
);

CREATE INDEX inventory_lots_expiry_idx ON inventory_lots(tenant_id, expires_on, variant_id);

CREATE TABLE inventory_balances (
  tenant_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  bin_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  inventory_status TEXT NOT NULL CHECK (inventory_status IN ('available', 'quarantine', 'damaged', 'blocked')),
  quantity_base INTEGER NOT NULL DEFAULT 0 CHECK (quantity_base >= 0),
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  PRIMARY KEY (tenant_id, variant_id, warehouse_id, bin_id, lot_id, inventory_status),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES product_variants(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, bin_id) REFERENCES warehouse_bins(tenant_id, id),
  FOREIGN KEY (tenant_id, lot_id) REFERENCES inventory_lots(tenant_id, id)
);

CREATE INDEX inventory_balances_warehouse_idx
  ON inventory_balances(tenant_id, warehouse_id, inventory_status, variant_id);
CREATE INDEX inventory_balances_lot_idx
  ON inventory_balances(tenant_id, lot_id, inventory_status);

CREATE TABLE inventory_movements (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN (
    'receive', 'adjust-in', 'adjust-out', 'transfer-out', 'transfer-in',
    'quarantine-out', 'quarantine-in', 'release-out', 'release-in', 'reversal'
  )),
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  transfer_group_id TEXT,
  variant_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  bin_id TEXT NOT NULL,
  lot_id TEXT NOT NULL,
  inventory_status TEXT NOT NULL CHECK (inventory_status IN ('available', 'quarantine', 'damaged', 'blocked')),
  quantity_delta_base INTEGER NOT NULL CHECK (quantity_delta_base <> 0),
  resulting_quantity_base INTEGER NOT NULL CHECK (resulting_quantity_base >= 0),
  reversal_of_movement_id TEXT,
  reason TEXT,
  actor_user_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, reversal_of_movement_id),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES product_variants(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id),
  FOREIGN KEY (tenant_id, bin_id) REFERENCES warehouse_bins(tenant_id, id),
  FOREIGN KEY (tenant_id, lot_id) REFERENCES inventory_lots(tenant_id, id),
  FOREIGN KEY (tenant_id, reversal_of_movement_id) REFERENCES inventory_movements(tenant_id, id)
);

CREATE INDEX inventory_movements_tenant_time_idx
  ON inventory_movements(tenant_id, occurred_at DESC);
CREATE INDEX inventory_movements_reference_idx
  ON inventory_movements(tenant_id, reference_type, reference_id);
CREATE INDEX inventory_movements_transfer_idx
  ON inventory_movements(tenant_id, transfer_group_id);

CREATE TABLE domain_idempotency (
  tenant_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_status INTEGER NOT NULL,
  response_body TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, scope, idempotency_key)
);

CREATE INDEX domain_idempotency_expiry_idx ON domain_idempotency(expires_at);

CREATE TABLE domain_audit_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'denied', 'failure')),
  correlation_id TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  occurred_at TEXT NOT NULL
);

CREATE INDEX domain_audit_tenant_time_idx ON domain_audit_events(tenant_id, occurred_at DESC);

CREATE TABLE domain_outbox_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  occurred_at TEXT NOT NULL,
  published_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX domain_outbox_unpublished_idx
  ON domain_outbox_events(tenant_id, published_at, occurred_at);
