# Target architecture

## 1. Product shape

FMCG by Alex SuperApp is a **modular multi-tenant ERP/CRM/commerce platform**, not a single large CRUD application. It is organised as a modular monolith first, with strict boundaries and an event/outbox backbone. Domains can be extracted into services only when scale, ownership or isolation data proves it is necessary.

This avoids premature distributed-system complexity while preserving a migration path.

## 2. Runtime targets

### Web and PWA

A responsive React application is the canonical client. It supports office and admin workflows, warehouse tablets, route and map views, PWA installation, resilient caching and queued offline actions where safe.

### Desktop

The web client is wrapped with Tauri for Windows, macOS and Linux. Desktop-specific capabilities are exposed through a narrow command bridge: secure credential storage, local encrypted database, barcode and label printing, filesystem imports and exports, signed auto-update and optional local-device integrations.

### Mobile

The web client is wrapped with Capacitor for iOS and Android: camera and barcode scanning, geolocation and proof-of-visit, push notifications, secure storage, offline route/order/visit data and controlled background sync.

## 3. Cloud architecture

```text
Browser / PWA / Tauri / Capacitor
              |
       Cloudflare edge
              |
  Web Worker + API Worker
              |
  +-----------+-------------+-------------+-------------+
  |           |             |             |             |
Control DB  Tenant DBs      R2          Queues       Durable Objects
  D1       D1/Postgres   documents     async work   ordered state
```

### Control plane

A small D1 database stores tenants and legal entities, user-to-tenant memberships, module entitlements, tenant database routing, subscription and usage metadata, the global integration registry and immutable security audit references.

No operational stock, order or accounting rows belong in the control plane.

### Tenant data plane

Two adapters implement the same repository contracts:

1. **D1-per-tenant** for small and mid-market customers.
2. **PostgreSQL-per-tenant or per-enterprise cluster via Hyperdrive** for high-write-volume, complex reporting or large data footprints.

The tenant directory resolves the adapter and physical database for every request. A tenant identifier from a URL or request body is never trusted by itself; it must match authenticated membership and signed tenant context.

### Storage and async processing

- R2 object keys begin with an immutable tenant identifier and data classification.
- Queues carry typed envelopes with tenant, correlation, causation and idempotency identifiers.
- Workflows execute long-running imports, invoice batches, campaign sends, rebate settlements and integration syncs.
- Durable Objects are reserved for workloads that need strict ordering or live coordination, such as inventory reservations or offline-sync cursors.
- KV caches only non-sensitive, reconstructible configuration.

## 4. Domain boundaries

The platform kernel owns identity, tenants, modules, permissions, audit, files, notifications, workflow and integrations.

Business domains own their models and invariants: master data; procurement; production and quality; workforce; inventory and warehousing; sales and pricing; finance and tax; CRM; field execution and geospatial; distributors and retailers; trade terms, returns and rebates; e-commerce; marketing; analytics and planning.

Domains communicate through application commands, queries and versioned events. They do not read each other's tables directly.

## 5. Critical ledgers

The following use append-only journals with derived balances: inventory quantity/status/ownership/valuation, general ledger, receivables/payables, rebates/accruals/claims/deductions, deposits/wallet/loyalty balances, stock reservations and allocations.

Corrections are reversal and replacement entries, never destructive edits.

## 6. Module entitlement model

A capability can be controlled at five levels: subscription plan, tenant, legal entity or operating unit, site/warehouse/sales organization, and user or role.

A disabled module disappears from navigation, rejects API access, stops scheduled jobs and event subscriptions, retains data according to policy, and can be re-enabled without schema surgery.

## 7. API design

- versioned REST endpoints and generated OpenAPI
- problem-detail responses
- cursor pagination
- idempotency keys on state-changing operations
- optimistic concurrency with entity versions
- correlation and causation IDs
- explicit locale, currency, timezone and unit context
- signed, replay-protected integration webhooks

## 8. Offline sync

Only bounded workflows are offline-enabled. Each offline command includes a globally unique client command ID, tenant and user binding, device ID, entity version last observed, created-at timestamp and deterministic payload hash.

Conflicts are handled by domain policy, not generic last-write-wins. Financial posting, stock close and approval decisions require online verification unless a domain-specific offline rule exists.

## 9. Reporting

Operational screens query tenant stores. Cross-domain analytics use an event pipeline into an analytical store. Reports must never run unbounded scans against transactional databases during peak operations.

## 10. Extensibility

Every external dependency sits behind a port: identity, tenant database, object storage, messaging, maps/routing, tax/e-invoicing, payments, commerce channels, accounting export and BI destination. This permits regional providers and enterprise systems without forking the core product.
