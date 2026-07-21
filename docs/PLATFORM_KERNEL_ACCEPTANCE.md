# Platform kernel acceptance checklist

- [x] Tenant selection is resolved from an authenticated active membership.
- [x] Tenant request headers are selectors only and cannot grant access.
- [x] Permissions and module entitlements are enforced before protected actions.
- [x] Denied permission and module checks create audit events.
- [x] Administrative module changes require idempotency keys.
- [x] Module changes write entitlement, audit, outbox and idempotency state atomically.
- [x] Development bootstrap is unavailable in staging and production.
- [x] Platform permissions, role mappings and approval-policy schema exist.
- [x] Domain-level permission and module fail-closed tests exist.
- [ ] Production OIDC adapter and token verification.
- [ ] Negative cross-tenant integration tests against local D1.
- [ ] Tenant onboarding UI and production provisioning workflow.
- [ ] Approval request runtime and maker-checker execution.
