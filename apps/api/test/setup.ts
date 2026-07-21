import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';

type MigrationList = Parameters<typeof applyD1Migrations>[1];

const testEnv = env as unknown as {
  CONTROL_DB: D1Database;
  TEST_MIGRATIONS: MigrationList;
};

await applyD1Migrations(testEnv.CONTROL_DB, testEnv.TEST_MIGRATIONS);
