PRAGMA foreign_keys = ON;

CREATE TABLE crm_accounts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('prospect', 'customer', 'distributor', 'retailer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  country_code TEXT NOT NULL,
  currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
  owner_user_id TEXT NOT NULL,
  party_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  FOREIGN KEY (tenant_id, party_id) REFERENCES business_parties(tenant_id, id)
);

CREATE INDEX crm_accounts_owner_idx ON crm_accounts(tenant_id, owner_user_id, status);
CREATE INDEX crm_accounts_type_idx ON crm_accounts(tenant_id, account_type, status);

CREATE TABLE crm_contacts (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  job_title TEXT,
  email TEXT,
  phone TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES crm_accounts(tenant_id, id)
);

CREATE INDEX crm_contacts_account_idx ON crm_contacts(tenant_id, account_id, active);
CREATE UNIQUE INDEX crm_contacts_primary_uq
  ON crm_contacts(tenant_id, account_id)
  WHERE is_primary = 1 AND active = 1;

CREATE TABLE crm_opportunities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  stage TEXT NOT NULL CHECK (stage IN ('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost')),
  expected_value_minor INTEGER NOT NULL CHECK (expected_value_minor >= 0),
  currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
  probability_basis_points INTEGER NOT NULL CHECK (probability_basis_points BETWEEN 0 AND 10000),
  owner_user_id TEXT NOT NULL,
  expected_close_date TEXT,
  next_action TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES crm_accounts(tenant_id, id)
);

CREATE INDEX crm_opportunities_pipeline_idx ON crm_opportunities(tenant_id, stage, expected_close_date);
CREATE INDEX crm_opportunities_owner_idx ON crm_opportunities(tenant_id, owner_user_id, stage);

CREATE TABLE crm_activities (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  contact_id TEXT,
  opportunity_id TEXT,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('note', 'call', 'email', 'meeting')),
  subject TEXT NOT NULL,
  body TEXT,
  occurred_at TEXT NOT NULL,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES crm_accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, contact_id) REFERENCES crm_contacts(tenant_id, id),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES crm_opportunities(tenant_id, id)
);

CREATE INDEX crm_activities_account_time_idx ON crm_activities(tenant_id, account_id, occurred_at DESC);
CREATE INDEX crm_activities_opportunity_idx ON crm_activities(tenant_id, opportunity_id, occurred_at DESC);

CREATE TABLE crm_tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  opportunity_id TEXT,
  subject TEXT NOT NULL,
  detail TEXT,
  due_at TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed', 'cancelled')),
  owner_user_id TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES crm_accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, opportunity_id) REFERENCES crm_opportunities(tenant_id, id),
  CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR status <> 'completed')
);

CREATE INDEX crm_tasks_due_idx ON crm_tasks(tenant_id, status, due_at, priority);
CREATE INDEX crm_tasks_owner_idx ON crm_tasks(tenant_id, owner_user_id, status, due_at);

CREATE TABLE sales_price_lists (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  code TEXT NOT NULL,
  display_name TEXT NOT NULL,
  currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
  valid_from TEXT,
  valid_until TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, code),
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_from <= valid_until)
);

CREATE TABLE sales_price_list_items (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  price_list_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  minimum_quantity_base INTEGER NOT NULL CHECK (minimum_quantity_base > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  tax_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (tax_basis_points BETWEEN 0 AND 10000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, price_list_id, variant_id, minimum_quantity_base),
  FOREIGN KEY (tenant_id, price_list_id) REFERENCES sales_price_lists(tenant_id, id),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES product_variants(tenant_id, id)
);

CREATE INDEX sales_price_items_lookup_idx
  ON sales_price_list_items(tenant_id, variant_id, minimum_quantity_base DESC);

CREATE TABLE sales_quotes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  quote_number TEXT NOT NULL,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired', 'converted', 'cancelled')),
  currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
  valid_until TEXT NOT NULL,
  customer_reference TEXT,
  notes TEXT,
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL CHECK (discount_minor >= 0),
  tax_minor INTEGER NOT NULL CHECK (tax_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  converted_order_id TEXT,
  created_by_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, quote_number),
  UNIQUE (tenant_id, converted_order_id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES crm_accounts(tenant_id, id)
);

CREATE INDEX sales_quotes_status_idx ON sales_quotes(tenant_id, status, valid_until, updated_at DESC);
CREATE INDEX sales_quotes_account_idx ON sales_quotes(tenant_id, account_id, updated_at DESC);

CREATE TABLE sales_quote_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  quote_id TEXT NOT NULL,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  variant_id TEXT NOT NULL,
  sku_snapshot TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity_base INTEGER NOT NULL CHECK (quantity_base > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  discount_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (discount_basis_points BETWEEN 0 AND 10000),
  tax_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (tax_basis_points BETWEEN 0 AND 10000),
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL CHECK (discount_minor >= 0),
  tax_minor INTEGER NOT NULL CHECK (tax_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, quote_id, line_number),
  FOREIGN KEY (tenant_id, quote_id) REFERENCES sales_quotes(tenant_id, id),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES product_variants(tenant_id, id)
);

CREATE TABLE sales_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  order_number TEXT NOT NULL,
  account_id TEXT NOT NULL,
  source_quote_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'allocated', 'fulfilled', 'cancelled')),
  currency_code TEXT NOT NULL CHECK (length(currency_code) = 3),
  requested_delivery_date TEXT,
  customer_reference TEXT,
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL CHECK (discount_minor >= 0),
  tax_minor INTEGER NOT NULL CHECK (tax_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  created_by_user_id TEXT NOT NULL,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, order_number),
  UNIQUE (tenant_id, source_quote_id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES crm_accounts(tenant_id, id),
  FOREIGN KEY (tenant_id, source_quote_id) REFERENCES sales_quotes(tenant_id, id),
  CHECK ((status = 'cancelled' AND cancelled_at IS NOT NULL) OR status <> 'cancelled')
);

CREATE INDEX sales_orders_status_idx ON sales_orders(tenant_id, status, requested_delivery_date, updated_at DESC);
CREATE INDEX sales_orders_account_idx ON sales_orders(tenant_id, account_id, updated_at DESC);

CREATE TABLE sales_order_lines (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  variant_id TEXT NOT NULL,
  sku_snapshot TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity_base INTEGER NOT NULL CHECK (quantity_base > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  discount_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (discount_basis_points BETWEEN 0 AND 10000),
  tax_basis_points INTEGER NOT NULL DEFAULT 0 CHECK (tax_basis_points BETWEEN 0 AND 10000),
  subtotal_minor INTEGER NOT NULL CHECK (subtotal_minor >= 0),
  discount_minor INTEGER NOT NULL CHECK (discount_minor >= 0),
  tax_minor INTEGER NOT NULL CHECK (tax_minor >= 0),
  total_minor INTEGER NOT NULL CHECK (total_minor >= 0),
  created_at TEXT NOT NULL,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, order_id, line_number),
  FOREIGN KEY (tenant_id, order_id) REFERENCES sales_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES product_variants(tenant_id, id)
);

CREATE TABLE inventory_reservations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  order_id TEXT NOT NULL,
  order_line_id TEXT NOT NULL,
  variant_id TEXT NOT NULL,
  warehouse_id TEXT NOT NULL,
  quantity_base INTEGER NOT NULL CHECK (quantity_base > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'consumed')),
  created_at TEXT NOT NULL,
  released_at TEXT,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, order_line_id),
  FOREIGN KEY (tenant_id, order_id) REFERENCES sales_orders(tenant_id, id),
  FOREIGN KEY (tenant_id, order_line_id) REFERENCES sales_order_lines(tenant_id, id),
  FOREIGN KEY (tenant_id, variant_id) REFERENCES product_variants(tenant_id, id),
  FOREIGN KEY (tenant_id, warehouse_id) REFERENCES warehouses(tenant_id, id),
  CHECK ((status = 'released' AND released_at IS NOT NULL) OR status <> 'released')
);

CREATE INDEX inventory_reservations_active_idx
  ON inventory_reservations(tenant_id, warehouse_id, variant_id, status);
CREATE INDEX inventory_reservations_order_idx
  ON inventory_reservations(tenant_id, order_id, status);

CREATE TRIGGER inventory_reservations_prevent_overcommit_insert
BEFORE INSERT ON inventory_reservations
WHEN NEW.status = 'active'
  AND NEW.quantity_base > (
    SELECT COALESCE(SUM(quantity_base), 0)
    FROM inventory_balances
    WHERE tenant_id = NEW.tenant_id
      AND variant_id = NEW.variant_id
      AND warehouse_id = NEW.warehouse_id
      AND inventory_status = 'available'
  ) - (
    SELECT COALESCE(SUM(quantity_base), 0)
    FROM inventory_reservations
    WHERE tenant_id = NEW.tenant_id
      AND variant_id = NEW.variant_id
      AND warehouse_id = NEW.warehouse_id
      AND status = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'sales_reservation_insufficient_stock');
END;

CREATE TRIGGER inventory_reservations_prevent_overcommit_update
BEFORE UPDATE OF quantity_base, status, variant_id, warehouse_id ON inventory_reservations
WHEN NEW.status = 'active'
  AND NEW.quantity_base > (
    SELECT COALESCE(SUM(quantity_base), 0)
    FROM inventory_balances
    WHERE tenant_id = NEW.tenant_id
      AND variant_id = NEW.variant_id
      AND warehouse_id = NEW.warehouse_id
      AND inventory_status = 'available'
  ) - (
    SELECT COALESCE(SUM(quantity_base), 0)
    FROM inventory_reservations
    WHERE tenant_id = NEW.tenant_id
      AND variant_id = NEW.variant_id
      AND warehouse_id = NEW.warehouse_id
      AND status = 'active'
      AND id <> OLD.id
  )
BEGIN
  SELECT RAISE(ABORT, 'sales_reservation_insufficient_stock');
END;
