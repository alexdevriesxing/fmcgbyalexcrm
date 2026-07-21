declare module 'cloudflare:workers' {
  interface ProvidedEnv {
    CONTROL_DB: D1Database;
    TEST_MIGRATIONS: D1Migration[];
  }
}

export {};
