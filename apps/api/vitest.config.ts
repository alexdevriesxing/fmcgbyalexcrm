import path from 'node:path';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(
            path.resolve('../../database/migrations/control')
          )
        }
      }
    }))
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
    testTimeout: 15_000
  }
});
