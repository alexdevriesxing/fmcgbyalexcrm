import path from 'node:path';
import {
  cloudflareTest,
  readD1Migrations
} from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_CONTROL_MIGRATIONS: await readD1Migrations(
            path.resolve('../../database/migrations/control')
          ),
          TEST_TENANT_MIGRATIONS: await readD1Migrations(
            path.resolve('../../database/migrations/tenant')
          )
        }
      }
    }))
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
    testTimeout: 20_000
  }
});
