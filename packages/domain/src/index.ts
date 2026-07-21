export type TenantId = string & { readonly __brand: 'TenantId' };
export type UserId = string & { readonly __brand: 'UserId' };
export type CorrelationId = string & { readonly __brand: 'CorrelationId' };

export type TenantContext = Readonly<{
  tenantId: TenantId;
  userId: UserId;
  correlationId: CorrelationId;
  roles: readonly string[];
  permissions: ReadonlySet<string>;
}>;

export function requirePermission(
  context: TenantContext,
  permission: string
): void {
  if (!context.permissions.has(permission)) {
    throw new Error(`Permission denied: ${permission}`);
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
