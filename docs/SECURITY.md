# Security, privacy and reliability baseline

## Assurance target

- OWASP ASVS 5.0 Level 2 for the complete application
- ASVS Level 3-style verification for finance posting, tenant administration, identity, secrets, exports and integration credentials
- OWASP multi-tenant security controls as mandatory architecture requirements
- documented threat model for every new module and trust boundary

Security is a continuous program, not a one-time claim.

## Identity and access

OIDC/OAuth 2.1 identity abstraction; passkeys and MFA; SAML SSO and SCIM for enterprise tenants; short-lived rotating sessions; device/session inventory; role- and attribute-based authorization; approval limits and segregation of duties; step-up authentication; scoped service accounts; emergency access with dual control and complete audit.

## Tenant isolation

Every request establishes tenant context from authenticated membership. Controls include authorization before repository access, tenant-scoped repositories, physical database isolation where required, tenant-prefixed R2 object keys, tenant-aware cache keys, tenant in queue/event envelopes, no user-selectable database identifiers, negative cross-tenant tests in CI and privileged support/export workflows.

## Data protection

TLS for traffic; managed encryption at rest; application-level encryption for selected high-risk fields; secrets only in a secrets manager/runtime binding; no secrets, tokens or personal data in logs; classification and retention; regional storage options; secure deletion procedures; malware scanning/content validation; short-lived signed URLs.

## Application security

Schema validation at every external boundary; parameterized SQL; output encoding and strict CSP; CSRF protection; narrow CORS; replay-protected signed webhooks; idempotency keys; optimistic concurrency; layered rate limits; bot protection on public forms; safe file detection and decompression limits; supply-chain scanning; lockfile integrity; security headers; no sensitive browser storage.

## Financial and stock integrity

Append-only journals; balanced accounting constraints; immutable posted periods; reversal instead of destructive correction; maker-checker approvals; duplicate detection; idempotent posting and settlement; reconciliation reports; configuration audit; controlled backdating and timezone handling.

## Reliability

Stateless request handlers; bounded memory and streaming; pagination/query limits; queues for expensive work; backpressure and dead-letter handling; timeouts, circuit breakers and bulkheads; deterministic retries; indexes and query budgets; load, soak and fault-injection tests; SLOs and error budgets; health/readiness checks.

## Backup and recovery

Point-in-time recovery where supported; encrypted independent exports; lifecycle/versioning policy for critical objects; tested tenant restore procedures; provider-loss and outage runbooks; plan-specific RPO/RTO; quarterly production restore drills.

## Secure development lifecycle

A release must pass formatting/linting/strict typing, unit and invariant tests, tenant-isolation tests, migration validation, dependency/secret scanning, static analysis, contract/integration tests, accessibility checks, production build and review for authorization, audit and retention effects.

## Observability and incident response

Structured correlation-aware logs; security events separated from business telemetry; immutable audit references; alerts for denials, suspicious exports and failed logins; runbooks; tenant-aware incident scoping; evidence preservation and notification process; corrective actions tracked to closure.
