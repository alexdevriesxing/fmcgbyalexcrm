# Cloudflare environment and deployment runbook

The repository treats GitHub and generated Wrangler configuration as the deployment source of truth. Development, staging and production must use separate Cloudflare resources and separate GitHub Environments.

## Environment topology

Each environment requires its own:

- API Worker name
- Cloudflare Pages project
- D1 control-plane database
- D1 tenant data-plane database for the initial shared development/mid-market adapter
- KV configuration namespace
- R2 document bucket
- outbox Queue and dead-letter Queue
- OIDC audience and permitted origins
- Worker secrets

Never point staging at production resources. The control and tenant D1 bindings must also be different from each other. Resource IDs are rendered into a temporary `apps/api/wrangler.generated.json` file and are not committed.

The tenant binding is the first implementation of the tenant data-plane port. Smaller deployments may progress to D1-per-tenant; larger deployments may route tenants to PostgreSQL through Hyperdrive. Operational stock, orders and accounting data must never be placed in the control database.

## Initial Cloudflare resources

Create resources once for each environment with Wrangler or the Cloudflare dashboard. Record the resulting non-secret IDs as GitHub Environment variables.

```bash
pnpm --dir apps/api exec wrangler d1 create fmcgbyalex-control-staging --location=weur
pnpm --dir apps/api exec wrangler d1 create fmcgbyalex-tenant-staging --location=weur
pnpm --dir apps/api exec wrangler kv namespace create fmcgbyalex-config-staging
pnpm --dir apps/api exec wrangler r2 bucket create fmcgbyalex-documents-staging
pnpm --dir apps/api exec wrangler queues create fmcgbyalex-outbox-staging
pnpm --dir apps/api exec wrangler queues create fmcgbyalex-outbox-dlq-staging
pnpm --dir apps/api exec wrangler pages project create fmcgbyalex-web-staging --production-branch=main
```

Use equivalent unique names for development and production. The outbox consumer and DLQ attachment are intentionally provisioned separately from the API producer binding so deployment cannot accidentally create a consumer before the dispatcher exists.

## GitHub Environments

Create `development`, `staging` and `production` under repository settings. Configure production with required reviewers and prevent self-approval.

Add these secrets to each environment:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `INVITATION_ENCRYPTION_KEY`
- `CF_SMOKE_BEARER_TOKEN` (optional)
- `CF_SMOKE_TENANT_ID` (optional)

The API token should be scoped to the target Cloudflare account and only the products required by the workflow: Workers Scripts, D1, KV, R2, Queues and Pages.

Add the variables listed in `infrastructure/cloudflare/environment.example.json`, including both `CF_D1_DATABASE_*` and `CF_TENANT_D1_DATABASE_*`. The renderer rejects zero IDs, example hostnames, malformed resource identifiers, reused control/tenant databases and unsafe production routing.

Generate the invitation key locally and store only the base64 value in GitHub:

```bash
openssl rand -base64 32
```

## Deployment workflow

Run **Deploy Cloudflare** from GitHub Actions.

1. Select the GitHub Environment.
2. Run `plan` first.
3. Review the generated Wrangler configuration artifact.
4. Run `deploy` after the environment is approved.

The workflow then:

1. runs all repository checks;
2. renders a fail-closed Wrangler configuration;
3. performs a Worker dry deployment;
4. builds the web application;
5. applies control-plane D1 migrations remotely;
6. applies tenant data-plane D1 migrations remotely;
7. deploys the Worker and required secrets together;
8. deploys the static web build to Pages;
9. smoke-tests `/health`, anonymous module rejection and the web shell.

An optional OIDC token and tenant ID upgrade the module smoke test from an expected anonymous `401` to a fully authenticated response check.

## Migration and recovery policy

- Control and tenant migrations have independent directories and migration histories.
- Migrations are append-only after they reach staging.
- Apply staging migrations before production.
- Export or back up D1 before a destructive data migration.
- Prefer expand-and-contract migrations: add compatible schema, deploy code, migrate data, then remove deprecated fields in a later release.
- A failed D1 migration is rolled back by D1; do not edit an already-applied migration to retry it.
- The deployment workflow stops immediately when either database migration fails.
- Operational migration recovery must preserve the append-only inventory and accounting journals.

## Rollback

Worker versions and Pages deployments are immutable deployment records.

For an API rollback:

```bash
pnpm --dir apps/api exec wrangler versions list --config wrangler.generated.json
pnpm --dir apps/api exec wrangler versions deploy <VERSION_ID> --config wrangler.generated.json
```

For a Pages rollback, select the previous deployment in Cloudflare or redeploy a known-good Git commit through the workflow.

A code rollback does not reverse data migrations. Use forward corrective migrations unless a tested data restore is explicitly required.

## Domain and security posture

- Production must use a custom API route with `CF_WORKERS_DEV=false`.
- Development and staging may use `workers.dev` endpoints.
- `CF_CORS_ORIGINS` must list exact HTTPS origins.
- Pages receives a generated CSP, HSTS, clickjacking protection, restrictive Permissions Policy and immutable asset caching.
- Required Worker secrets are declared in generated Wrangler configuration, so deploy fails when a secret is absent.
- Generated configs and secret files are excluded from Git and written with restrictive file permissions.
- Tenant operational rows always include an authenticated tenant identifier and tenant-scoped foreign keys.

## What remains external

This repository cannot invent Cloudflare account IDs, resource IDs, custom-domain ownership or identity-provider values. Until real values and credentials exist in protected GitHub Environments, production deployment remains deliberately unavailable.
