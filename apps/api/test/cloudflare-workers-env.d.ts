declare module 'cloudflare:workers' {
  interface Env {
    TENANT_DB: D1Database;
  }
}
