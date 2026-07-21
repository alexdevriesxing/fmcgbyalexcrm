# Delivery roadmap

## Phase 0 — Product and assurance foundation

Architecture decisions; module/entitlement catalogue; threat model and data classification; CI/release policy; web/API shells; design system and accessibility baseline.

**Exit gate:** reproducible builds, no high-severity dependency findings, documented tenant boundary.

## Phase 1 — Platform kernel and master data

Authentication, MFA and onboarding; roles, permissions and approval policies; tenant provisioning and entitlements; legal entities, sites, warehouses and sales organizations; products, packs, units, parties, currencies and tax basics; files, notifications, audit, outbox and integrations.

**Exit gate:** automated cross-tenant isolation tests and audited admin actions.

## Phase 2 — Inventory, procurement and sales core

Inventory ledger, lots, expiry, status and aging; receiving, put-away, transfers, counts and dispatch; suppliers, requisitions, POs and goods receipt; quotations, orders, allocation and returns; price lists, discounts and credit controls.

**Exit gate:** end-to-end procure-to-stock and order-to-delivery reconciliation.

## Phase 3 — Finance and commercial terms

Double-entry ledger, AR, AP and invoicing; bank reconciliation; tax/e-invoicing adapter framework; agreements, accruals, rebates, claims and settlement; period close and profitability.

**Exit gate:** balanced postings, immutable periods and reconciliation coverage.

## Phase 4 — CRM, field execution and distribution

Customer 360, activities, pipeline and cases; territory, route, zone and visit planning; offline mobile order capture and audits; distributor secondary sales and inventory; retailer assortments, assets and compliance.

**Exit gate:** a route day works offline with deterministic conflict handling.

## Phase 5 — Production, workforce and quality

BOM/recipes, MRP, production orders and capacity; shifts, skills, attendance and labor allocation; inspections, holds, release and genealogy; maintenance and OEE.

**Exit gate:** batch genealogy from supplier lot to customer delivery.

## Phase 6 — E-commerce and marketing

B2B portal and D2C/headless commerce; payments, tax, shipping and marketplace adapters; campaign planning, segmentation and journeys; consent, frequency caps and attribution; promotion ROI and marketing accruals.

**Exit gate:** campaign-to-order-to-margin attribution is reconciled.

## Phase 7 — Planning, analytics and enterprise scale

Analytical event pipeline and semantic metrics; demand planning, S&OP and scenarios; enterprise SSO/SCIM and regional controls; high-volume Postgres tenant adapter; advanced integrations and extension SDK.

**Exit gate:** performance, soak, disaster-recovery and penetration-test acceptance.

## Delivery policy

Each phase ships vertically in small production-capable slices. A module is not complete with screens alone; it also needs permissions, audit, import/export, accessibility, observability, tests, documentation, retention rules and recovery behavior.
