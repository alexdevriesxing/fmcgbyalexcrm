interface Env {
  ENVIRONMENT: 'development' | 'staging' | 'production';
  APP_VERSION: string;
  CONTROL_DB: D1Database;
  CONFIG: KVNamespace;
  DOCUMENTS: R2Bucket;
}
