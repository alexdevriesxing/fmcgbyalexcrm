# Live web operations

The React client is a live tenant-aware operating interface. Primary workspaces do not use seeded business rows: they load the authenticated session, selected tenant, permissions, modules and domain read models from the API.

## Runtime configuration

`apps/web/public/runtime-config.js` supplies local development defaults. Cloudflare Pages deployments overwrite the built file through `scripts/render-pages-security.mjs`.

The browser runtime exposes:

- `apiBaseUrl`
- `webBaseUrl`
- `environment`: `development`, `staging` or `production`
- `authenticationMode`: `development` or `oidc`

Generated staging and production configuration always sets `authenticationMode` to `oidc`. `runtime-config.js` is served with `Cache-Control: no-store` so environment changes do not remain behind an immutable asset cache.

## Authentication

### Development

The local client can send:

- `X-Dev-Identity-Subject`
- `X-Dev-Identity-Email`
- `X-Dev-Identity-Name`

The API accepts these headers only when both the Worker environment and authentication mode are development. The browser stores the selected local identity in local storage.

### Staging and production

The client requires a bearer access token and stores it in session storage only. The Worker validates the token signature, issuer, audience, algorithm, timestamps and subject through OIDC/JWKS before membership resolution.

The current token-entry gate is provider-neutral. A later identity-provider integration can replace it with authorization-code plus PKCE without changing the tenant data layer or workspace components.

## Tenant resolution

The client loads `/v1/tenant-options` first. It persists only a preferred tenant identifier. Every API request still sends `X-Tenant-Id`, and the Worker verifies that the selected tenant is an active membership for the authenticated identity.

If no active tenant exists:

- development can use `/v1/development/bootstrap`;
- enabled self-service environments can use `/v1/onboarding/tenant`;
- otherwise the API fails closed according to environment configuration.

## Application state

`ApplicationProvider` owns:

- authentication
- tenant options and selection
- session, roles, permissions and modules
- product, warehouse and party read models
- inventory overview, aging and settings
- approval workspace
- tenant administration
- loading, refresh, error and notice state

Tenant data is loaded in parallel only after the session is resolved. A domain endpoint is requested only when its module is enabled and the session contains the required read permission.

## Mutations

Every state-changing web action generates a unique idempotency key. After a successful command, affected read models are reloaded from the server rather than trusted from client-side optimistic assumptions.

Implemented operating forms:

- create product with one or more SKUs
- create legal entity, site, warehouse, default zone and default bin
- create supplier, customer, distributor or retailer
- receive lot-controlled stock
- transfer stock
- post stock adjustment
- quarantine and release stock
- reverse eligible standalone movements
- calculate FEFO allocation
- update inventory-aging buckets
- approve or reject pending requests
- invite a member and display the one-time token
- update membership status and roles
- revoke pending invitations

## Permission-aware UI

Buttons and creation actions are disabled or omitted when the session lacks the corresponding permission. This is a usability control only; the API remains the security boundary and independently verifies every command.

Resolved approval requests are audit-only in the client. Only pending requests display decision controls, and the API still enforces step permissions, minimum approvers and self-approval policy.

## Search and export

The command palette searches the currently loaded tenant data across:

- products and SKUs
- warehouses
- business parties
- stock positions and lots
- approvals

Master-data, balance, movement and aging views can be exported as CSV from the browser. Exports contain only data already returned for the authenticated tenant.

## Failure behavior

The web application displays explicit states for:

- authentication required
- tenant onboarding required
- loading
- API or network failure
- permission-limited modules
- empty domain data
- mutation failure

A `401` clears the stored credential and returns to authentication. Other failures preserve the credential and allow a retry. Correlation identifiers are surfaced when the API returns one.

## Local development

Run the API and web client together:

```bash
pnpm dev
```

The default addresses are:

- web: `http://localhost:5173`
- API: `http://localhost:8787`

On a fresh local database, continue with the default `local-admin` identity and create the first development tenant through the onboarding gate.

## Production limitation

The repository does not contain a hosted identity-provider login redirect or real Cloudflare resource identifiers. Production remains unavailable until protected Cloudflare resources, domains, GitHub Environment values and an OIDC provider are configured according to `docs/CLOUDFLARE_DEPLOYMENT.md`.
