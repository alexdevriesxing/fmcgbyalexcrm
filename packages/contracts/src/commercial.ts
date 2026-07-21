export const CRM_PERMISSIONS = [
  'crm.accounts.read',
  'crm.accounts.manage',
  'crm.activities.read',
  'crm.activities.manage',
  'crm.pipeline.read',
  'crm.pipeline.manage'
] as const;

export const SALES_PERMISSIONS = [
  'sales.pricing.read',
  'sales.pricing.manage',
  'sales.quotes.read',
  'sales.quotes.manage',
  'sales.orders.read',
  'sales.orders.manage',
  'sales.orders.reserve'
] as const;

export type CurrencyCode = string;
export type CrmAccountType = 'prospect' | 'customer' | 'distributor' | 'retailer';
export type CrmAccountStatus = 'active' | 'inactive';
export type CrmActivityType = 'note' | 'call' | 'email' | 'meeting';
export type CrmTaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type CrmTaskStatus = 'open' | 'completed' | 'cancelled';
export type OpportunityStage = 'lead' | 'qualified' | 'proposal' | 'negotiation' | 'won' | 'lost';
export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired' | 'converted' | 'cancelled';
export type SalesOrderStatus = 'confirmed' | 'allocated' | 'fulfilled' | 'cancelled';
export type ReservationStatus = 'active' | 'released' | 'consumed';

export type CrmAccountSummary = {
  id: string;
  code: string;
  name: string;
  accountType: CrmAccountType;
  status: CrmAccountStatus;
  countryCode: string;
  currencyCode: CurrencyCode;
  ownerUserId: string;
  partyId: string | null;
  contactCount: number;
  openOpportunityCount: number;
  openPipelineMinor: number;
  nextTaskDueAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CrmContactSummary = {
  id: string;
  accountId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  primary: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CrmActivitySummary = {
  id: string;
  accountId: string;
  contactId: string | null;
  opportunityId: string | null;
  activityType: CrmActivityType;
  subject: string;
  body: string | null;
  occurredAt: string;
  createdByUserId: string;
  createdAt: string;
};

export type CrmTaskSummary = {
  id: string;
  accountId: string;
  opportunityId: string | null;
  subject: string;
  detail: string | null;
  dueAt: string;
  priority: CrmTaskPriority;
  status: CrmTaskStatus;
  ownerUserId: string;
  completedAt: string | null;
  overdue: boolean;
  dueSoon: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type OpportunitySummary = {
  id: string;
  accountId: string;
  accountName: string;
  name: string;
  stage: OpportunityStage;
  expectedValueMinor: number;
  weightedValueMinor: number;
  currencyCode: CurrencyCode;
  probabilityBasisPoints: number;
  ownerUserId: string;
  expectedCloseDate: string | null;
  nextAction: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CrmOverviewResponse = {
  metrics: {
    accountCount: number;
    activeOpportunityCount: number;
    pipelineMinor: number;
    weightedPipelineMinor: number;
    overdueTaskCount: number;
    dueSoonTaskCount: number;
  };
  accounts: CrmAccountSummary[];
  contacts: CrmContactSummary[];
  opportunities: OpportunitySummary[];
  tasks: CrmTaskSummary[];
  recentActivities: CrmActivitySummary[];
};

export type CreateCrmAccountRequest = {
  code: string;
  name: string;
  accountType: CrmAccountType;
  countryCode: string;
  currencyCode: CurrencyCode;
  partyId?: string;
  ownerUserId?: string;
};

export type CreateCrmAccountResponse = {
  account: CrmAccountSummary;
  replayed: boolean;
};

export type CreateCrmContactRequest = {
  accountId: string;
  firstName: string;
  lastName: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
  primary?: boolean;
};

export type CreateCrmContactResponse = {
  contact: CrmContactSummary;
  replayed: boolean;
};

export type CreateCrmActivityRequest = {
  accountId: string;
  contactId?: string;
  opportunityId?: string;
  activityType: CrmActivityType;
  subject: string;
  body?: string;
  occurredAt?: string;
};

export type CreateCrmActivityResponse = {
  activity: CrmActivitySummary;
  replayed: boolean;
};

export type CreateCrmTaskRequest = {
  accountId: string;
  opportunityId?: string;
  subject: string;
  detail?: string;
  dueAt: string;
  priority: CrmTaskPriority;
  ownerUserId?: string;
};

export type CompleteCrmTaskResponse = {
  task: CrmTaskSummary;
  replayed: boolean;
};

export type CreateCrmTaskResponse = CompleteCrmTaskResponse;

export type CreateOpportunityRequest = {
  accountId: string;
  name: string;
  stage?: OpportunityStage;
  expectedValueMinor: number;
  currencyCode: CurrencyCode;
  probabilityBasisPoints: number;
  expectedCloseDate?: string;
  nextAction?: string;
  ownerUserId?: string;
};

export type CreateOpportunityResponse = {
  opportunity: OpportunitySummary;
  replayed: boolean;
};

export type UpdateOpportunityStageRequest = {
  stage: OpportunityStage;
  probabilityBasisPoints: number;
  nextAction?: string;
};

export type UpdateOpportunityStageResponse = CreateOpportunityResponse;

export type PriceListItemSummary = {
  id: string;
  variantId: string;
  sku: string;
  variantName: string;
  minimumQuantityBase: number;
  unitPriceMinor: number;
  taxBasisPoints: number;
};

export type PriceListSummary = {
  id: string;
  code: string;
  name: string;
  currencyCode: CurrencyCode;
  validFrom: string | null;
  validUntil: string | null;
  active: boolean;
  items: PriceListItemSummary[];
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CreatePriceListRequest = {
  code: string;
  name: string;
  currencyCode: CurrencyCode;
  validFrom?: string;
  validUntil?: string;
  items: Array<{
    variantId: string;
    minimumQuantityBase: number;
    unitPriceMinor: number;
    taxBasisPoints?: number;
  }>;
};

export type CreatePriceListResponse = {
  priceList: PriceListSummary;
  replayed: boolean;
};

export type QuoteLineSummary = {
  id: string;
  lineNumber: number;
  variantId: string;
  sku: string;
  description: string;
  quantityBase: number;
  unitPriceMinor: number;
  discountBasisPoints: number;
  taxBasisPoints: number;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
};

export type QuoteSummary = {
  id: string;
  quoteNumber: string;
  accountId: string;
  accountName: string;
  status: QuoteStatus;
  currencyCode: CurrencyCode;
  validUntil: string;
  customerReference: string | null;
  notes: string | null;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  convertedOrderId: string | null;
  lines: QuoteLineSummary[];
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type CreateQuoteRequest = {
  accountId: string;
  currencyCode: CurrencyCode;
  validUntil: string;
  customerReference?: string;
  notes?: string;
  lines: Array<{
    variantId: string;
    description?: string;
    quantityBase: number;
    unitPriceMinor: number;
    discountBasisPoints?: number;
    taxBasisPoints?: number;
  }>;
};

export type QuoteCommandResponse = {
  quote: QuoteSummary;
  replayed: boolean;
};

export type SalesOrderLineSummary = QuoteLineSummary & {
  reservedQuantityBase: number;
};

export type SalesOrderSummary = {
  id: string;
  orderNumber: string;
  accountId: string;
  accountName: string;
  sourceQuoteId: string | null;
  status: SalesOrderStatus;
  currencyCode: CurrencyCode;
  requestedDeliveryDate: string | null;
  customerReference: string | null;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  lines: SalesOrderLineSummary[];
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type InventoryReservationSummary = {
  id: string;
  orderId: string;
  orderLineId: string;
  variantId: string;
  sku: string;
  warehouseId: string;
  warehouseCode: string;
  quantityBase: number;
  status: ReservationStatus;
  createdAt: string;
  releasedAt: string | null;
};

export type ProductAvailabilitySummary = {
  variantId: string;
  sku: string;
  warehouseId: string;
  warehouseCode: string;
  onHandAvailableBase: number;
  reservedBase: number;
  availableToPromiseBase: number;
};

export type SalesOverviewResponse = {
  metrics: {
    openQuoteCount: number;
    openQuoteValueMinor: number;
    activeOrderCount: number;
    activeOrderValueMinor: number;
    reservedQuantityBase: number;
  };
  priceLists: PriceListSummary[];
  quotes: QuoteSummary[];
  orders: SalesOrderSummary[];
  reservations: InventoryReservationSummary[];
  availability: ProductAvailabilitySummary[];
};

export type ConvertQuoteRequest = {
  warehouseId: string;
  requestedDeliveryDate?: string;
  customerReference?: string;
};

export type ConvertQuoteResponse = {
  quote: QuoteSummary;
  order: SalesOrderSummary;
  reservations: InventoryReservationSummary[];
  replayed: boolean;
};

export type CancelSalesOrderResponse = {
  order: SalesOrderSummary;
  releasedReservations: InventoryReservationSummary[];
  replayed: boolean;
};
