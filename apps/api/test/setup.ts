import { env } from 'cloudflare:workers';
import { applyD1Migrations } from 'cloudflare:test';

const testEnv = env as unknown as {
  CONTROL_DB: D1Database;
  TEST_MIGRATIONS: D1Migration[];
};

await applyD1Migrations(testEnv.CONTROL_DB, testEnv.TEST_MIGRATIONS);
