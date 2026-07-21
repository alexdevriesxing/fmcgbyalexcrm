# FMCG by Alex SuperApp

A modular, multi-tenant operating system for FMCG companies: procurement, production, workforce scheduling, inventory and aging, sales, finance, CRM, field execution, routing, distributor and retailer management, commercial terms, returns, rebates, e-commerce, and marketing campaigns.

> **Status:** Foundation milestone. The repository now contains the architecture, security baseline, tenant-aware data model, Cloudflare Worker API shell, responsive web/PWA shell, shared contracts, and CI.

## Product principles

1. **One operational truth** — shared master data, ledgers and workflows across every module.
2. **Modular by entitlement** — modules can be enabled per tenant, legal entity, site, role, or user.
3. **Tenant isolation first** — tenant context is mandatory at the edge, application, repository, database, cache, queue and object-storage layers.
4. **Ledger-based critical state** — stock, finance, rebates and loyalty balances are append-only and auditable.
5. **Offline-capable field work** — sales reps, merchandisers, drivers and warehouse users can continue safely with conflict-aware sync.
6. **Replaceable infrastructure** — domain logic depends on ports, not on D1, Postgres, R2, an identity vendor, or a payment provider.
7. **Secure delivery** — threat modelling, OWASP ASVS controls, dependency scanning, signed releases, audit events and disaster-recovery testing are delivery gates.

## Repository layout

```text
apps/
  api/                 Cloudflare Worker API
  web/                 Responsive React web app and PWA shell
packages/
  contracts/           Shared API and module contracts
  domain/              Pure domain model and invariants
database/
  migrations/          Control-plane and tenant schema migrations
docs/
  ARCHITECTURE.md       Target architecture and deployment model
  MODULES.md            Definitive functional module map
  SECURITY.md           Security, privacy and reliability baseline
  ROADMAP.md            Delivery sequence and acceptance gates
.github/workflows/      CI and security checks
```

## Local development

Requirements:

- Node.js 22+
- pnpm 10+
- Cloudflare Wrangler

```bash
corepack enable
pnpm install
pnpm dev
```

Run individual targets:

```bash
pnpm --filter @fmcgbyalex/web dev
pnpm --filter @fmcgbyalex/api dev
```

## Cloudflare deployment model

- **Workers + Static Assets**: web application and API
- **D1**: control plane and isolated SME tenant databases
- **PostgreSQL through Hyperdrive**: high-volume enterprise tenants
- **R2**: product media, invoices, contracts, imports, exports and evidence
- **Queues + Workflows**: email, integrations, document generation, imports, settlements and long-running jobs
- **Durable Objects**: real-time coordination, inventory reservations and sync cursors where strict ordering is required
- **KV**: non-sensitive configuration and feature-flag cache
- **Secrets Store / Worker secrets**: secrets and credentials
- **Analytics Engine / Pipelines**: operational telemetry and event ingestion

## Important assurance statement

No responsible engineering team can truthfully promise that software is “100% secure” or will never contain defects. This project is designed to achieve a high-assurance posture through isolation, least privilege, secure defaults, verification, observability, backups, recovery drills and continuous patching.

## Next milestone

Build the platform kernel:

- authentication and organization onboarding
- role, permission and segregation-of-duties policy engine
- tenant provisioning
- feature entitlements
- audit trail and outbox
- master data for products, parties, locations, units and currencies
- first production-grade inventory ledger
