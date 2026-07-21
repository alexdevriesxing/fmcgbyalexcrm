import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';

type MigrationList = Parameters<typeof applyD1Migrations>[1];

const testEnv = env as unknown as {
  CONTROL_DB: D1Database;
  TENANT_DB: D1Database;
  TEST_CONTROL_MIGRATIONS: MigrationList;
  TEST_TENANT_MIGRATIONS: MigrationList;
};

await applyD1Migrations(testEnv.CONTROL_DB, testEnv.TEST_CONTROL_MIGRATIONS);
await applyD1Migrations(testEnv.TENANT_DB, testEnv.TEST_TENANT_MIGRATIONS);
