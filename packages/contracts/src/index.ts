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

export type ModuleEntitlement = {
  key: ModuleKey;
  enabled: boolean;
  status: 'available' | 'foundation' | 'planned';
  label: string;
  description: string;
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
