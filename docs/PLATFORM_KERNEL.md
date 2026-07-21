# Platform kernel

This milestone turns the repository foundation into an enforceable multi-tenant application core.

## Request trust chain

1. The identity adapter establishes an external subject.
2. The subject is resolved to active user and tenant memberships in the control database.
3. A requested `X-Tenant-Id` is treated only as a selector and must match an active membership.
4. Tenant roles are resolved to permissions.
5. Tenant module entitlements are resolved into the request context.
6. Routes enforce both the module and permission before application logic executes.

Development header authentication is accepted only when both `ENVIRONMENT` and `AUTH_MODE` equal `development`. Staging and production therefore fail closed until the OIDC adapter is installed.

## Development bootstrap

After applying D1 migrations, create the first local tenant with:

```bash
curl --request POST http://localhost:8787/v1/development/bootstrap \
  --header 'Content-Type: application/json' \
  --header 'X-Dev-Identity-Subject: local-admin' \
  --data '{
    "tenantName": "Demo FMCG Group",
    "tenantSlug": "demo-fmcg-group",
    "adminEmail": "admin@example.com",
    "adminDisplayName": "Local Administrator"
  }'
```

The endpoint creates the tenant, active user membership, tenant administrator role, platform permissions, initial module entitlements, an audit record and an outbox event in one D1 batch. It is unavailable outside development.

## Protected endpoints

- `GET /v1/session` returns the active user, tenant, roles, permissions and modules.
- `GET /v1/modules` returns the tenant module catalogue and entitlement versions.
- `PATCH /v1/admin/modules/:moduleKey` changes an entitlement and requires `platform.modules.manage` plus a valid `Idempotency-Key`.

Module changes atomically write the entitlement, immutable audit record, transactional outbox event and cached idempotent response.

## Production identity adapter

The next identity increment must validate OIDC issuer, audience, signature, expiry, nonce and authorized-party claims. Raw identity headers from clients must never be accepted in staging or production. Enterprise extensions will add passkeys, SAML federation, SCIM provisioning, session inventory and step-up authentication.
