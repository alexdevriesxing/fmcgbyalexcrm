export const MASTER_DATA_PERMISSIONS = [
  'master-data.catalog.read',
  'master-data.catalog.manage',
  'master-data.locations.read',
  'master-data.locations.manage',
  'master-data.parties.read',
  'master-data.parties.manage'
] as const;

export const INVENTORY_PERMISSIONS = [
  'inventory.stock.read',
  'inventory.stock.receive',
  'inventory.stock.adjust',
  'inventory.stock.transfer',
  'inventory.stock.quarantine',
  'inventory.settings.manage'
] as const;

export const TENANT_ADMIN_PERMISSIONS = [
  'platform.session.read',
  'platform.modules.read',
  'platform.modules.manage',
  'platform.tenants.manage',
  'platform.memberships.read',
  'platform.memberships.manage',
  'platform.roles.read',
  'platform.roles.manage',
  'platform.invitations.manage',
  'platform.approvals.read',
  'platform.approvals.request',
  'platform.approvals.decide',
  'platform.approval-policies.read',
  'platform.approval-policies.manage',
  'platform.audit.read',
  ...MASTER_DATA_PERMISSIONS,
  ...INVENTORY_PERMISSIONS
] as const;

export const OPERATOR_PERMISSIONS = [
  'platform.session.read',
  'platform.modules.read',
  'platform.memberships.read',
  'platform.roles.read',
  'platform.approvals.read',
  'platform.approval-policies.read',
  'master-data.catalog.read',
  'master-data.locations.read',
  'master-data.parties.read',
  'inventory.stock.read',
  'inventory.stock.receive',
  'inventory.stock.transfer',
  'inventory.stock.quarantine'
] as const;

export const VIEWER_PERMISSIONS = [
  'platform.session.read',
  'platform.modules.read',
  'platform.memberships.read',
  'platform.roles.read',
  'platform.approvals.read',
  'platform.approval-policies.read',
  'master-data.catalog.read',
  'master-data.locations.read',
  'master-data.parties.read',
  'inventory.stock.read'
] as const;

export type ProductVariantSummary = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  barcode: string | null;
  baseUnitCode: string;
  packQuantityBase: number;
  caseQuantityBase: number | null;
  active: boolean;
  version: number;
};

export type ProductSummary = {
  id: string;
  code: string;
  name: string;
  brand: string;
  category: string;
  baseUnitCode: string;
  shelfLifeDays: number | null;
  active: boolean;
  variants: ProductVariantSummary[];
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CreateProductRequest = {
  code: string;
  name: string;
  brand: string;
  category: string;
  baseUnitCode: string;
  baseUnitName: string;
  baseUnitPrecision?: number;
  shelfLifeDays?: number;
  variants: Array<{
    sku: string;
    name: string;
    barcode?: string;
    packQuantityBase: number;
    caseQuantityBase?: number;
  }>;
};

export type CreateProductResponse = {
  product: ProductSummary;
  replayed: boolean;
};

export type ProductCatalogResponse = {
  products: ProductSummary[];
};

export type WarehouseSummary = {
  id: string;
  code: string;
  name: string;
  siteCode: string;
  siteName: string;
  legalEntityCode: string;
  timezone: string;
  active: boolean;
  defaultZoneId: string;
  defaultBinId: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CreateWarehouseRequest = {
  legalEntityCode: string;
  legalEntityName: string;
  siteCode: string;
  siteName: string;
  warehouseCode: string;
  warehouseName: string;
  timezone: string;
  defaultZoneCode?: string;
  defaultBinCode?: string;
};

export type CreateWarehouseResponse = {
  warehouse: WarehouseSummary;
  replayed: boolean;
};

export type WarehouseListResponse = {
  warehouses: WarehouseSummary[];
};

export type PartyType = 'supplier' | 'customer' | 'distributor' | 'retailer';

export type PartySummary = {
  id: string;
  code: string;
  name: string;
  type: PartyType;
  countryCode: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CreatePartyRequest = {
  code: string;
  name: string;
  type: PartyType;
  countryCode: string;
  taxId?: string;
  email?: string;
  phone?: string;
};

export type CreatePartyResponse = {
  party: PartySummary;
  replayed: boolean;
};

export type PartyListResponse = {
  parties: PartySummary[];
};

export type InventoryStatus = 'available' | 'quarantine' | 'damaged' | 'blocked';

export type InventoryMovementType =
  | 'receive'
  | 'adjust-in'
  | 'adjust-out'
  | 'transfer-out'
  | 'transfer-in'
  | 'quarantine-out'
  | 'quarantine-in'
  | 'release-out'
  | 'release-in'
  | 'reversal';

export type InventoryLotSummary = {
  id: string;
  variantId: string;
  lotCode: string;
  manufacturedOn: string | null;
  expiresOn: string | null;
  supplierPartyId: string | null;
  createdAt: string;
};

export type InventoryBalanceSummary = {
  variantId: string;
  sku: string;
  productName: string;
  variantName: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  binId: string;
  binCode: string;
  lot: InventoryLotSummary;
  status: InventoryStatus;
  quantityBase: number;
  baseUnitCode: string;
  expiresInDays: number | null;
  version: number;
  updatedAt: string;
};

export type InventoryMovementSummary = {
  id: string;
  movementType: InventoryMovementType;
  referenceType: string;
  referenceId: string;
  variantId: string;
  sku: string;
  warehouseId: string;
  warehouseCode: string;
  binId: string;
  binCode: string;
  lotId: string;
  lotCode: string;
  status: InventoryStatus;
  quantityDeltaBase: number;
  resultingQuantityBase: number;
  reversalOfMovementId: string | null;
  actorUserId: string;
  occurredAt: string;
};

export type InventoryOverviewResponse = {
  totals: {
    quantityBase: number;
    availableBase: number;
    quarantineBase: number;
    nearExpiryBase: number;
    expiredBase: number;
    skuCount: number;
    lotCount: number;
  };
  balances: InventoryBalanceSummary[];
  recentMovements: InventoryMovementSummary[];
};

export type ReceiveStockRequest = {
  variantId: string;
  warehouseId: string;
  binId?: string;
  lotCode: string;
  manufacturedOn?: string;
  expiresOn?: string;
  supplierPartyId?: string;
  quantityBase: number;
  referenceType: string;
  referenceId: string;
};

export type AdjustStockRequest = {
  variantId: string;
  warehouseId: string;
  binId?: string;
  lotId: string;
  status: InventoryStatus;
  quantityDeltaBase: number;
  reason: string;
  referenceId: string;
};

export type TransferStockRequest = {
  variantId: string;
  sourceWarehouseId: string;
  sourceBinId?: string;
  destinationWarehouseId: string;
  destinationBinId?: string;
  lotId: string;
  status: InventoryStatus;
  quantityBase: number;
  referenceId: string;
};

export type ChangeInventoryStatusRequest = {
  variantId: string;
  warehouseId: string;
  binId?: string;
  lotId: string;
  quantityBase: number;
  reason: string;
  referenceId: string;
};

export type ReverseInventoryMovementRequest = {
  reason: string;
  referenceId: string;
};

export type InventoryCommandResponse = {
  movements: InventoryMovementSummary[];
  balances: InventoryBalanceSummary[];
  replayed: boolean;
};

export type FefoCandidate = {
  balance: InventoryBalanceSummary;
  recommendedQuantityBase: number;
  cumulativeQuantityBase: number;
};

export type FefoResponse = {
  requestedQuantityBase: number;
  allocatedQuantityBase: number;
  fullyAllocated: boolean;
  candidates: FefoCandidate[];
};

export type InventoryAgingBucket = {
  key: string;
  label: string;
  minimumDays: number | null;
  maximumDays: number | null;
  quantityBase: number;
  lotCount: number;
};

export type InventoryAgingResponse = {
  configuredBucketsDays: number[];
  buckets: InventoryAgingBucket[];
};

export type InventorySettingsResponse = {
  agingBucketsDays: number[];
  updatedAt: string;
  version: number;
};

export type UpdateInventorySettingsRequest = {
  agingBucketsDays: number[];
};

export type UpdateInventorySettingsResponse = {
  settings: InventorySettingsResponse;
  replayed: boolean;
};
