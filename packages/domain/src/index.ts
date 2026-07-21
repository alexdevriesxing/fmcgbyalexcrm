import type { ModuleKey } from '@fmcgbyalex/contracts';

export type TenantId = string & { readonly __brand: 'TenantId' };
export type UserId = string & { readonly __brand: 'UserId' };
export type CorrelationId = string & { readonly __brand: 'CorrelationId' };

export type TenantContext = Readonly<{
  tenantId: TenantId;
  userId: UserId;
  correlationId: CorrelationId;
  roles: readonly string[];
  permissions: ReadonlySet<string>;
  modules: ReadonlyMap<ModuleKey, boolean>;
}>;

export class AccessDeniedError extends Error {
  readonly code = 'access_denied';
  readonly permission: string;

  constructor(permission: string) {
    super(`Permission denied: ${permission}`);
    this.name = 'AccessDeniedError';
    this.permission = permission;
  }
}

export class ModuleDisabledError extends Error {
  readonly code = 'module_disabled';
  readonly moduleKey: ModuleKey;

  constructor(moduleKey: ModuleKey) {
    super(`Module is disabled: ${moduleKey}`);
    this.name = 'ModuleDisabledError';
    this.moduleKey = moduleKey;
  }
}

export function hasPermission(context: TenantContext, permission: string): boolean {
  return context.permissions.has(permission);
}

export function requirePermission(
  context: TenantContext,
  permission: string
): void {
  if (!hasPermission(context, permission)) {
    throw new AccessDeniedError(permission);
  }
}

export function isModuleEnabled(
  context: TenantContext,
  moduleKey: ModuleKey
): boolean {
  return context.modules.get(moduleKey) === true;
}

export function requireModule(
  context: TenantContext,
  moduleKey: ModuleKey
): void {
  if (!isModuleEnabled(context, moduleKey)) {
    throw new ModuleDisabledError(moduleKey);
  }
}

export type Money = Readonly<{
  currency: string;
  minorUnits: bigint;
}>;

export function addMoney(left: Money, right: Money): Money {
  if (left.currency !== right.currency) {
    throw new Error('Cannot add amounts in different currencies');
  }

  return {
    currency: left.currency,
    minorUnits: left.minorUnits + right.minorUnits
  };
}
