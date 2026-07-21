export const MODULE_KEYS = [
  'platform',
  'master-data',
  'procurement',
  'production',
  'workforce',
  'inventory',
  'sales',
  'finance',
  'crm',
  'field-execution',
  'geospatial',
  'distributors',
  'retailers',
  'trade-terms',
  'returns-rebates',
  'ecommerce',
  'marketing',
  'analytics',
  'integrations'
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];

export const PLATFORM_PERMISSIONS = [
  'platform.session.read',
  'platform.modules.read',
  'platform.modules.manage',
  'platform.tenants.manage',
  'platform.audit.read'
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number];
export type PermissionKey = PlatformPermission | (string & {});

export type ModuleEntitlement = {
  key: ModuleKey;
  enabled: boolean;
  status: 'available' | 'foundation' | 'planned';
  label: string;
  description: string;
  version: number;
};

export type TenantSummary = {
  id: string;
  slug: string;
  displayName: string;
  defaultCurrency: string;
  defaultLocale: string;
  defaultTimezone: string;
};

export type UserSummary = {
  id: string;
  displayName: string;
};

export type SessionContextResponse = {
  user: UserSummary;
  tenant: TenantSummary;
  roles: string[];
  permissions: string[];
  modules: ModuleEntitlement[];
};

export type SetModuleEntitlementRequest = {
  enabled: boolean;
};

export type SetModuleEntitlementResponse = {
  module: ModuleEntitlement;
  replayed: boolean;
};

export type DevelopmentBootstrapRequest = {
  tenantName: string;
  tenantSlug: string;
  adminEmail: string;
  adminDisplayName: string;
};

export type DevelopmentBootstrapResponse = {
  tenantId: string;
  userId: string;
  created: boolean;
};

export type HealthResponse = {
  service: 'fmcgbyalex-api';
  status: 'ok';
  version: string;
  timestamp: string;
};

export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  correlationId?: string;
};
