interface Env {
  ENVIRONMENT: 'development' | 'staging' | 'production';
  APP_VERSION: string;
  AUTH_MODE: 'development' | 'oidc';
  CORS_ORIGINS: string;
  DEVELOPMENT_IDENTITY_SUBJECT: string;
  OIDC_ISSUER: string;
  OIDC_AUDIENCE: string;
  OIDC_JWKS_URI: string;
  OIDC_ALGORITHMS: string;
  CONTROL_DB: D1Database;
  CONFIG: KVNamespace;
  DOCUMENTS: R2Bucket;
}
