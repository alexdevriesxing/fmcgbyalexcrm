# Identity and tenant isolation

## Authentication modes

The API supports two explicit modes.

### Development

`ENVIRONMENT=development` and `AUTH_MODE=development` are both required. The Worker accepts `X-Dev-Identity-Subject` or the configured local subject. This mode must never be used in staging or production.

### OIDC

`AUTH_MODE=oidc` validates an `Authorization: Bearer <JWT>` token using a remote JWKS endpoint. The following variables are mandatory:

- `OIDC_ISSUER`: exact HTTPS token issuer
- `OIDC_AUDIENCE`: one or more comma-separated accepted audiences
- `OIDC_JWKS_URI`: HTTPS JWKS endpoint
- `OIDC_ALGORITHMS`: comma-separated asymmetric algorithms; only RS256, PS256, ES256 and EdDSA are accepted

Tokens must contain `sub`, `iat` and `exp`. Issuer, audience, signature, expiry and configured algorithm are validated. Authentication failures return a generic 401 response and never include token contents or validation internals.

## Key caching and rotation

Remote JWKS resolvers are cached per URI with a hard maximum of four entries per Worker isolate. The cache has a ten-minute maximum age, a short cooldown for unknown key IDs and a five-second fetch timeout. This allows ordinary key rotation without an unbounded in-memory cache.

## Subject bridge

After OIDC verification, only the validated `sub` claim is passed into the platform membership resolver. The original Authorization header is removed and any client-supplied development identity header is overwritten. Tenant membership, roles, permissions and module entitlements continue through the same resolver used by local development.

## Tenant selection rules

- Tenant context is derived from active user membership.
- `X-Tenant-Id` is only a selector; it is never an authorization credential.
- A selector not present in the authenticated identity's active memberships returns 403.
- An identity with more than one active membership must select a tenant and receives 409 otherwise.
- Suspended users, memberships and tenants are excluded before role or permission evaluation.

## Test coverage

The API test suite runs inside Cloudflare's Workers runtime through the Vitest pool and applies the real D1 migrations to isolated local storage.

The negative tenant suite provisions distinct identities and tenants, then verifies that one identity cannot select the other tenant. It also verifies that multi-company identities must make an explicit selection.

The OIDC suite serves an intercepted JWKS document, signs a real RS256 token, validates the accepted token and rejects wrong audiences, missing bearer headers and symmetric signing algorithms.

## Production checklist

1. Configure a dedicated API audience; do not reuse a frontend client ID unless the provider explicitly requires it.
2. Pin the exact issuer and JWKS URI from the provider's discovery document.
3. Store environment-specific values in Worker configuration or secrets management, never in application source.
4. Disable development mode in staging and production.
5. Configure short access-token lifetimes and enforce MFA/passkeys at the identity provider.
6. Test signing-key rotation and provider outage behavior before launch.
7. Alert on repeated 401 responses, denied tenant selectors and abnormal tenant switching.
8. Review identity-provider claims and lifecycle events before enabling SCIM or just-in-time provisioning.
