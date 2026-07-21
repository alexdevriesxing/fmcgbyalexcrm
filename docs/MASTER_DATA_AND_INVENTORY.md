# Master data and inventory vertical slice

## Purpose

This slice turns the platform kernel into the first complete FMCG operating workflow. It provides tenant-scoped product and location master data plus an append-only inventory journal with derived balances.

Operational inventory rows live in the tenant data plane (`TENANT_DB`), never in the platform control database. The development binding is a shared D1 database with an explicit `tenant_id` on every row. The repository and deployment contracts allow that binding to be replaced by D1-per-tenant or a PostgreSQL tenant adapter later without changing the HTTP contracts.

## Master data

The tenant schema includes:

- units of measure and rational unit conversions
- brands, categories, products and sellable variants/SKUs
- pack and case quantities expressed in integer base units
- legal entities, sites, warehouses, zones and bins
- suppliers, customers, distributors and retailers

Every code and identifier is unique within a tenant. Cross-table foreign keys include the tenant identifier so a child row cannot reference another tenant's master data.

## Inventory ledger

`inventory_movements` is append-only. Every stock command writes one or more movements and updates the derived `inventory_balances` table in the same D1 batch.

Supported movement types:

- receive
- adjust-in and adjust-out
- transfer-out and transfer-in
- quarantine-out and quarantine-in
- release-out and release-in
- reversal

Corrections do not edit historical movements. A correction creates a reversal movement linked through `reversal_of_movement_id`. Paired transfers and status changes cannot be reversed as a single side because doing so would break conservation.

Quantities use safe integers in base units. Floating-point stock quantities are not stored.

## Nonnegative stock

`inventory_balances.quantity_base` has a database check constraint requiring a value greater than or equal to zero. Commands also perform a readable stock-availability check before submission. The database constraint remains the final protection if two commands race.

D1 batch execution keeps each command atomic: the ledger, balances, idempotency record, audit record and outbox event either commit together or roll back together.

## Lots, expiry and FEFO

Lots capture:

- tenant and SKU
- lot or batch code
- manufacture date
- expiry date
- supplier reference

The FEFO query returns available balances ordered by earliest expiry and then lot creation time. It recommends quantities until the requested amount is fully allocated or stock is exhausted.

Inventory aging buckets are configurable per tenant. The default boundaries are 30, 60, 90 and 180 days. Reports include expired, configured remaining-life bands and stock without an expiry date.

## Permissions

Tenant administrators receive all master-data and inventory permissions. Operators can read master data, receive and transfer inventory, and move stock into or out of quarantine. Viewers receive read-only access.

Important permissions include:

- `master-data.catalog.read` / `master-data.catalog.manage`
- `master-data.locations.read` / `master-data.locations.manage`
- `master-data.parties.read` / `master-data.parties.manage`
- `inventory.stock.read`
- `inventory.stock.receive`
- `inventory.stock.adjust`
- `inventory.stock.transfer`
- `inventory.stock.quarantine`
- `inventory.settings.manage`

All endpoints first enforce the active module entitlement and then the required permission.

## API surface

### Master data

```text
GET  /v1/master-data/products
POST /v1/master-data/products
GET  /v1/master-data/warehouses
POST /v1/master-data/warehouses
GET  /v1/master-data/parties
POST /v1/master-data/parties
```

### Inventory

```text
GET  /v1/inventory/overview
GET  /v1/inventory/balances
POST /v1/inventory/receipts
POST /v1/inventory/adjustments
POST /v1/inventory/transfers
POST /v1/inventory/quarantine
POST /v1/inventory/releases
POST /v1/inventory/movements/:movementId/reversal
GET  /v1/inventory/fefo
GET  /v1/inventory/aging
GET  /v1/inventory/settings
PUT  /v1/inventory/settings
```

All state-changing commands require an `Idempotency-Key`. Reusing a key with the same payload replays the original result; reusing it with a different payload returns a conflict.

## Audit and events

Every successful command writes a tenant-domain audit event and versioned outbox event in the same batch as the business change. Event payloads carry identifiers and operational facts, not authentication secrets.

## Verification

The Workers integration suite applies both control-plane and tenant-plane migrations to real local D1 bindings and verifies:

- product, location and supplier creation
- receipt replay safety
- FEFO lot ordering and allocation
- transfer conservation
- quarantine and release status moves
- reversal-only correction
- rejection of insufficient stock
- reconciliation of movement totals and balance totals
- negative cross-tenant access and zero data leakage
- separate control and tenant D1 deployment bindings
