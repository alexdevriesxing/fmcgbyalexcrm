interface Env {
  ENVIRONMENT: 'development' | 'staging' | 'production';
  APP_VERSION: string;
  AUTH_MODE: 'development' | 'oidc';
  CORS_ORIGINS: string;
  DEVELOPMENT_IDENTITY_SUBJECT: string;
  CONTROL_DB: D1Database;
  CONFIG: KVNamespace;
  DOCUMENTS: R2Bucket;
}
