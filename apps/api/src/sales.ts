import type {
  CancelSalesOrderResponse,
  ConvertQuoteRequest,
  ConvertQuoteResponse,
  CreatePriceListRequest,
  CreatePriceListResponse,
  CreateQuoteRequest,
  InventoryReservationSummary,
  PriceListItemSummary,
  PriceListSummary,
  ProductAvailabilitySummary,
  QuoteCommandResponse,
  QuoteLineSummary,
  QuoteStatus,
  QuoteSummary,
  SalesOrderLineSummary,
  SalesOrderSummary,
  SalesOverviewResponse
} from '@fmcgbyalex/contracts/commercial';
import {
  conflictError,
  domainAuditStatement,
  domainOutboxStatement,
  idempotencyStatement,
  notFoundError,
  normalizedCode,
  optionalDate,
  optionalText,
  readDomainReplay,
  requestHash,
  requireDomainAccess,
  requireIdempotencyKey,
  requiredId,
  requiredPositiveInteger,
  requiredText,
  validationError
} from './domain-support';
import type { ResolvedSession } from './platform';

type VariantRow = {
  id: string;
  sku: string;
  display_name: string;
};

type AccountRow = {
  id: string;
  display_name: string;
  currency_code: string;
};

type WarehouseRow = {
  id: string;
  code: string;
};

type PriceListRow = {
  id: string;
  code: string;
  display_name: string;
  currency_code: string;
  valid_from: string | null;
  valid_until: string | null;
  active: number;
  created_at: string;
  updated_at: string;
  version: number;
};

type PriceItemRow = {
  id: string;
  price_list_id: string;
  variant_id: string;
  sku: string;
  variant_name: string;
  minimum_quantity_base: number;
  unit_price_minor: number;
  tax_basis_points: number;
};

type QuoteRow = {
  id: string;
  quote_number: string;
  account_id: string;
  account_name: string;
  status: QuoteStatus;
  currency_code: string;
  valid_until: string;
  customer_reference: string | null;
  notes: string | null;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  converted_order_id: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

type LineRow = {
  id: string;
  parent_id: string;
  line_number: number;
  variant_id: string;
  sku_snapshot: string;
  description: string;
  quantity_base: number;
  unit_price_minor: number;
  discount_basis_points: number;
  tax_basis_points: number;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  reserved_quantity_base?: number;
};

type OrderRow = {
  id: string;
  order_number: string;
  account_id: string;
  account_name: string;
  source_quote_id: string | null;
  status: SalesOrderSummary['status'];
  currency_code: string;
  requested_delivery_date: string | null;
  customer_reference: string | null;
  subtotal_minor: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  created_at: string;
  updated_at: string;
  version: number;
};

type ReservationRow = {
  id: string;
  order_id: string;
  order_line_id: string;
  variant_id: string;
  sku: string;
  warehouse_id: string;
  warehouse_code: string;
  quantity_base: number;
  status: InventoryReservationSummary['status'];
  created_at: string;
  released_at: string | null;
};

type AvailabilityRow = {
  variant_id: string;
  sku: string;
  warehouse_id: string;
  warehouse_code: string;
  on_hand_available_base: number;
  reserved_base: number;
};

type CalculatedLine = QuoteLineSummary;

export async function getSalesOverview(
  env: Env,
  request: Request,
  session: ResolvedSession
): Promise<SalesOverviewResponse> {
  await Promise.all([
    requireDomainAccess(env, request, session, 'sales', 'sales.pricing.read', 'sales.overview.read'),
    requireDomainAccess(env, request, session, 'sales', 'sales.quotes.read', 'sales.overview.read'),
    requireDomainAccess(env, request, session, 'sales', 'sales.orders.read', 'sales.overview.read')
  ]);
  return readSalesOverview(env.TENANT_DB, session.response.tenant.id);
}

export async function createPriceList(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: CreatePriceListRequest
): Promise<CreatePriceListResponse> {
  await requireDomainAccess(env, request, session, 'sales', 'sales.pricing.manage', 'sales.price-list.create');
  const tenantId = session.response.tenant.id;
  const normalized = {
    code: normalizedCode(input.code, 'code'),
    name: requiredText(input.name, 'name', 2, 160),
    currencyCode: tenantCurrency(input.currencyCode, session),
    validFrom: optionalDate(input.validFrom, 'validFrom'),
    validUntil: optionalDate(input.validUntil, 'validUntil'),
    items: normalizePriceItems(input.items)
  };
  if (normalized.validFrom && normalized.validUntil && normalized.validFrom > normalized.validUntil) {
    throw validationError('validFrom must be on or before validUntil.');
  }
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash(normalized);
  const replay = await readDomainReplay<CreatePriceListResponse>(
    env.TENANT_DB, tenantId, 'sales.price-list.create', idempotencyKey, hash
  );
  if (replay) return { ...replay, replayed: true };

  const duplicate = await env.TENANT_DB.prepare(
    'SELECT id FROM sales_price_lists WHERE tenant_id = ?1 AND code = ?2'
  ).bind(tenantId, normalized.code).first<{ id: string }>();
  if (duplicate) throw conflictError('sales-price-list-code-conflict', 'Price list code already exists.');
  const variants = await loadVariants(env.TENANT_DB, tenantId, normalized.items.map((item) => item.variantId));

  const now = new Date().toISOString();
  const priceListId = `prl_${crypto.randomUUID()}`;
  const itemSummaries: PriceListItemSummary[] = normalized.items.map((item) => {
    const variant = requireVariant(variants, item.variantId);
    return {
      id: `pri_${crypto.randomUUID()}`,
      variantId: item.variantId,
      sku: variant.sku,
      variantName: variant.display_name,
      minimumQuantityBase: item.minimumQuantityBase,
      unitPriceMinor: item.unitPriceMinor,
      taxBasisPoints: item.taxBasisPoints
    };
  });
  const priceList: PriceListSummary = {
    id: priceListId,
    code: normalized.code,
    name: normalized.name,
    currencyCode: normalized.currencyCode,
    validFrom: normalized.validFrom,
    validUntil: normalized.validUntil,
    active: true,
    items: itemSummaries,
    createdAt: now,
    updatedAt: now,
    version: 1
  };
  const response: CreatePriceListResponse = { priceList, replayed: false };
  const statements: D1PreparedStatement[] = [
    env.TENANT_DB.prepare(
      `INSERT INTO sales_price_lists (
         id, tenant_id, code, display_name, currency_code, valid_from, valid_until,
         active, created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8, 1)`
    ).bind(priceList.id, tenantId, priceList.code, priceList.name, priceList.currencyCode,
      priceList.validFrom, priceList.validUntil, now)
  ];
  for (const item of itemSummaries) {
    statements.push(env.TENANT_DB.prepare(
      `INSERT INTO sales_price_list_items (
         id, tenant_id, price_list_id, variant_id, minimum_quantity_base,
         unit_price_minor, tax_basis_points, created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 1)`
    ).bind(item.id, tenantId, priceList.id, item.variantId, item.minimumQuantityBase,
      item.unitPriceMinor, item.taxBasisPoints, now));
  }
  statements.push(
    idempotencyStatement(env.TENANT_DB, {
      tenantId, scope: 'sales.price-list.create', idempotencyKey, requestHash: hash,
      responseStatus: 201, responseBody: response, now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'sales.price-list.create', resourceType: 'sales-price-list', resourceId: priceList.id,
      metadata: { code: priceList.code, itemCount: itemSummaries.length }, now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'sales.price-list.created.v1', aggregateType: 'sales-price-list', aggregateId: priceList.id,
      aggregateVersion: 1, payload: { priceListId: priceList.id, code: priceList.code }, now
    })
  );
  await env.TENANT_DB.batch(statements);
  return response;
}

export async function createQuote(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: CreateQuoteRequest
): Promise<QuoteCommandResponse> {
  await requireDomainAccess(env, request, session, 'sales', 'sales.quotes.manage', 'sales.quote.create');
  const tenantId = session.response.tenant.id;
  const accountId = requiredId(input.accountId, 'accountId');
  const account = await requireAccount(env.TENANT_DB, tenantId, accountId);
  const normalized = {
    accountId,
    currencyCode: accountCurrency(input.currencyCode, account.currency_code),
    validUntil: requiredDate(input.validUntil, 'validUntil'),
    customerReference: optionalText(input.customerReference, 'customerReference', 120),
    notes: optionalText(input.notes, 'notes', 4000),
    lines: normalizeQuoteLines(input.lines)
  };
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash(normalized);
  const replay = await readDomainReplay<QuoteCommandResponse>(
    env.TENANT_DB, tenantId, 'sales.quote.create', idempotencyKey, hash
  );
  if (replay) return { ...replay, replayed: true };
  const variants = await loadVariants(env.TENANT_DB, tenantId, normalized.lines.map((line) => line.variantId));
  const calculatedLines = normalized.lines.map((line, index) => {
    const variant = requireVariant(variants, line.variantId);
    return calculateLine({
      id: `qtl_${crypto.randomUUID()}`,
      lineNumber: index + 1,
      variantId: line.variantId,
      sku: variant.sku,
      description: line.description ?? variant.display_name,
      quantityBase: line.quantityBase,
      unitPriceMinor: line.unitPriceMinor,
      discountBasisPoints: line.discountBasisPoints,
      taxBasisPoints: line.taxBasisPoints
    });
  });
  const totals = documentTotals(calculatedLines);
  const now = new Date().toISOString();
  const quote: QuoteSummary = {
    id: `quo_${crypto.randomUUID()}`,
    quoteNumber: businessNumber('Q', now),
    accountId,
    accountName: account.display_name,
    status: 'draft',
    currencyCode: normalized.currencyCode,
    validUntil: normalized.validUntil,
    customerReference: normalized.customerReference,
    notes: normalized.notes,
    ...totals,
    convertedOrderId: null,
    lines: calculatedLines,
    createdAt: now,
    updatedAt: now,
    version: 1
  };
  const response: QuoteCommandResponse = { quote, replayed: false };
  const statements: D1PreparedStatement[] = [
    env.TENANT_DB.prepare(
      `INSERT INTO sales_quotes (
         id, tenant_id, quote_number, account_id, status, currency_code, valid_until,
         customer_reference, notes, subtotal_minor, discount_minor, tax_minor, total_minor,
         converted_order_id, created_by_user_id, created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, ?4, 'draft', ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12,
         NULL, ?13, ?14, ?14, 1)`
    ).bind(quote.id, tenantId, quote.quoteNumber, quote.accountId, quote.currencyCode,
      quote.validUntil, quote.customerReference, quote.notes, quote.subtotalMinor,
      quote.discountMinor, quote.taxMinor, quote.totalMinor, session.response.user.id, now)
  ];
  for (const line of calculatedLines) statements.push(quoteLineInsert(env.TENANT_DB, tenantId, quote.id, line, now));
  statements.push(
    idempotencyStatement(env.TENANT_DB, {
      tenantId, scope: 'sales.quote.create', idempotencyKey, requestHash: hash,
      responseStatus: 201, responseBody: response, now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'sales.quote.create', resourceType: 'sales-quote', resourceId: quote.id,
      metadata: { quoteNumber: quote.quoteNumber, accountId, totalMinor: quote.totalMinor }, now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'sales.quote.created.v1', aggregateType: 'sales-quote', aggregateId: quote.id,
      aggregateVersion: 1, payload: { quoteId: quote.id, quoteNumber: quote.quoteNumber, accountId }, now
    })
  );
  await env.TENANT_DB.batch(statements);
  return response;
}

export async function sendQuote(
  env: Env,
  request: Request,
  session: ResolvedSession,
  quoteIdValue: string
): Promise<QuoteCommandResponse> {
  return transitionQuote(env, request, session, quoteIdValue, 'draft', 'sent', 'sales.quote.send');
}

export async function acceptQuote(
  env: Env,
  request: Request,
  session: ResolvedSession,
  quoteIdValue: string
): Promise<QuoteCommandResponse> {
  const quote = await loadQuote(env.TENANT_DB, session.response.tenant.id, requiredId(quoteIdValue, 'quoteId'));
  if (quote.validUntil < new Date().toISOString().slice(0, 10)) {
    throw conflictError('sales-quote-expired', 'Expired quotations cannot be accepted.');
  }
  return transitionQuote(env, request, session, quoteIdValue, 'sent', 'accepted', 'sales.quote.accept', quote);
}

export async function convertQuote(
  env: Env,
  request: Request,
  session: ResolvedSession,
  quoteIdValue: string,
  input: ConvertQuoteRequest
): Promise<ConvertQuoteResponse> {
  await Promise.all([
    requireDomainAccess(env, request, session, 'sales', 'sales.orders.manage', 'sales.quote.convert'),
    requireDomainAccess(env, request, session, 'sales', 'sales.orders.reserve', 'sales.quote.convert')
  ]);
  const tenantId = session.response.tenant.id;
  const quoteId = requiredId(quoteIdValue, 'quoteId');
  const normalized = {
    quoteId,
    warehouseId: requiredId(input.warehouseId, 'warehouseId'),
    requestedDeliveryDate: optionalDate(input.requestedDeliveryDate, 'requestedDeliveryDate'),
    customerReference: optionalText(input.customerReference, 'customerReference', 120)
  };
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash(normalized);
  const replay = await readDomainReplay<ConvertQuoteResponse>(env.TENANT_DB, tenantId, 'sales.quote.convert', idempotencyKey, hash);
  if (replay) return { ...replay, replayed: true };
  const quote = await loadQuote(env.TENANT_DB, tenantId, quoteId);
  if (quote.status !== 'accepted') throw conflictError('sales-quote-not-accepted', 'Only accepted quotations can become orders.');
  if (quote.convertedOrderId) throw conflictError('sales-quote-already-converted', 'Quotation was already converted.');
  const warehouse = await env.TENANT_DB.prepare(
    `SELECT id, code FROM warehouses WHERE tenant_id = ?1 AND id = ?2 AND active = 1`
  ).bind(tenantId, normalized.warehouseId).first<WarehouseRow>();
  if (!warehouse) throw notFoundError('warehouse-not-found', 'Active warehouse not found.');

  const now = new Date().toISOString();
  const orderId = `ord_${crypto.randomUUID()}`;
  const orderLines: SalesOrderLineSummary[] = quote.lines.map((line) => ({
    ...line,
    id: `orl_${crypto.randomUUID()}`,
    reservedQuantityBase: line.quantityBase
  }));
  const order: SalesOrderSummary = {
    id: orderId,
    orderNumber: businessNumber('SO', now),
    accountId: quote.accountId,
    accountName: quote.accountName,
    sourceQuoteId: quote.id,
    status: 'allocated',
    currencyCode: quote.currencyCode,
    requestedDeliveryDate: normalized.requestedDeliveryDate,
    customerReference: normalized.customerReference ?? quote.customerReference,
    subtotalMinor: quote.subtotalMinor,
    discountMinor: quote.discountMinor,
    taxMinor: quote.taxMinor,
    totalMinor: quote.totalMinor,
    lines: orderLines,
    createdAt: now,
    updatedAt: now,
    version: 1
  };
  const reservations: InventoryReservationSummary[] = orderLines.map((line) => ({
    id: `res_${crypto.randomUUID()}`,
    orderId,
    orderLineId: line.id,
    variantId: line.variantId,
    sku: line.sku,
    warehouseId: warehouse.id,
    warehouseCode: warehouse.code,
    quantityBase: line.quantityBase,
    status: 'active',
    createdAt: now,
    releasedAt: null
  }));
  const convertedQuote: QuoteSummary = {
    ...quote,
    status: 'converted',
    convertedOrderId: orderId,
    updatedAt: now,
    version: quote.version + 1
  };
  const response: ConvertQuoteResponse = { quote: convertedQuote, order, reservations, replayed: false };
  const statements: D1PreparedStatement[] = [
    env.TENANT_DB.prepare(
      `INSERT INTO sales_orders (
         id, tenant_id, order_number, account_id, source_quote_id, status, currency_code,
         requested_delivery_date, customer_reference, subtotal_minor, discount_minor,
         tax_minor, total_minor, created_by_user_id, cancelled_at, created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, ?4, ?5, 'allocated', ?6, ?7, ?8, ?9, ?10, ?11, ?12,
         ?13, NULL, ?14, ?14, 1)`
    ).bind(order.id, tenantId, order.orderNumber, order.accountId, order.sourceQuoteId,
      order.currencyCode, order.requestedDeliveryDate, order.customerReference,
      order.subtotalMinor, order.discountMinor, order.taxMinor, order.totalMinor,
      session.response.user.id, now)
  ];
  for (const line of orderLines) statements.push(orderLineInsert(env.TENANT_DB, tenantId, order.id, line, now));
  for (const reservation of reservations) {
    statements.push(env.TENANT_DB.prepare(
      `INSERT INTO inventory_reservations (
         id, tenant_id, order_id, order_line_id, variant_id, warehouse_id,
         quantity_base, status, created_at, released_at
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'active', ?8, NULL)`
    ).bind(reservation.id, tenantId, reservation.orderId, reservation.orderLineId,
      reservation.variantId, reservation.warehouseId, reservation.quantityBase, now));
  }
  statements.push(
    env.TENANT_DB.prepare(
      `UPDATE sales_quotes SET status = 'converted', converted_order_id = ?3,
       updated_at = ?4, version = version + 1
       WHERE tenant_id = ?1 AND id = ?2 AND status = 'accepted' AND converted_order_id IS NULL`
    ).bind(tenantId, quote.id, order.id, now),
    idempotencyStatement(env.TENANT_DB, {
      tenantId, scope: 'sales.quote.convert', idempotencyKey, requestHash: hash,
      responseStatus: 201, responseBody: response, now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'sales.quote.convert', resourceType: 'sales-order', resourceId: order.id,
      metadata: { quoteId: quote.id, orderNumber: order.orderNumber, warehouseId: warehouse.id }, now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'sales.order.created.v1', aggregateType: 'sales-order', aggregateId: order.id,
      aggregateVersion: 1, payload: { orderId: order.id, quoteId: quote.id, accountId: order.accountId }, now
    })
  );
  try {
    await env.TENANT_DB.batch(statements);
  } catch (error) {
    if (String(error).includes('sales_reservation_insufficient_stock')) {
      throw conflictError('sales-insufficient-available-stock', 'Available-to-promise stock is insufficient for this order.');
    }
    throw error;
  }
  return response;
}

export async function cancelSalesOrder(
  env: Env,
  request: Request,
  session: ResolvedSession,
  orderIdValue: string
): Promise<CancelSalesOrderResponse> {
  await requireDomainAccess(env, request, session, 'sales', 'sales.orders.manage', 'sales.order.cancel');
  const tenantId = session.response.tenant.id;
  const orderId = requiredId(orderIdValue, 'orderId');
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash({ orderId });
  const replay = await readDomainReplay<CancelSalesOrderResponse>(env.TENANT_DB, tenantId, 'sales.order.cancel', idempotencyKey, hash);
  if (replay) return { ...replay, replayed: true };
  const order = await loadOrder(env.TENANT_DB, tenantId, orderId);
  if (!['confirmed', 'allocated'].includes(order.status)) {
    throw conflictError('sales-order-not-cancellable', 'Only confirmed or allocated orders can be cancelled.');
  }
  const activeReservations = await loadReservations(env.TENANT_DB, tenantId, orderId, 'active');
  const now = new Date().toISOString();
  const cancelledOrder: SalesOrderSummary = {
    ...order,
    status: 'cancelled',
    lines: order.lines.map((line) => ({ ...line, reservedQuantityBase: 0 })),
    updatedAt: now,
    version: order.version + 1
  };
  const releasedReservations = activeReservations.map((reservation) => ({
    ...reservation,
    status: 'released' as const,
    releasedAt: now
  }));
  const response: CancelSalesOrderResponse = {
    order: cancelledOrder,
    releasedReservations,
    replayed: false
  };
  await env.TENANT_DB.batch([
    env.TENANT_DB.prepare(
      `UPDATE sales_orders SET status = 'cancelled', cancelled_at = ?3,
       updated_at = ?3, version = version + 1
       WHERE tenant_id = ?1 AND id = ?2 AND status IN ('confirmed', 'allocated')`
    ).bind(tenantId, orderId, now),
    env.TENANT_DB.prepare(
      `UPDATE inventory_reservations SET status = 'released', released_at = ?3
       WHERE tenant_id = ?1 AND order_id = ?2 AND status = 'active'`
    ).bind(tenantId, orderId, now),
    idempotencyStatement(env.TENANT_DB, {
      tenantId, scope: 'sales.order.cancel', idempotencyKey, requestHash: hash,
      responseStatus: 200, responseBody: response, now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'sales.order.cancel', resourceType: 'sales-order', resourceId: orderId,
      metadata: { releasedReservationCount: releasedReservations.length }, now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'sales.order.cancelled.v1', aggregateType: 'sales-order', aggregateId: orderId,
      aggregateVersion: cancelledOrder.version, payload: { orderId }, now
    })
  ]);
  return response;
}

async function transitionQuote(
  env: Env,
  request: Request,
  session: ResolvedSession,
  quoteIdValue: string,
  expectedStatus: QuoteStatus,
  nextStatus: QuoteStatus,
  action: string,
  preloaded?: QuoteSummary
): Promise<QuoteCommandResponse> {
  await requireDomainAccess(env, request, session, 'sales', 'sales.quotes.manage', action);
  const tenantId = session.response.tenant.id;
  const quoteId = requiredId(quoteIdValue, 'quoteId');
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash({ quoteId, nextStatus });
  const scope = `${action}:${quoteId}`;
  const replay = await readDomainReplay<QuoteCommandResponse>(env.TENANT_DB, tenantId, scope, idempotencyKey, hash);
  if (replay) return { ...replay, replayed: true };
  const quote = preloaded ?? await loadQuote(env.TENANT_DB, tenantId, quoteId);
  if (quote.status !== expectedStatus) {
    throw conflictError('sales-quote-invalid-state', `Quotation must be ${expectedStatus} before it can become ${nextStatus}.`);
  }
  const now = new Date().toISOString();
  const updated: QuoteSummary = { ...quote, status: nextStatus, updatedAt: now, version: quote.version + 1 };
  const response: QuoteCommandResponse = { quote: updated, replayed: false };
  await env.TENANT_DB.batch([
    env.TENANT_DB.prepare(
      `UPDATE sales_quotes SET status = ?3, updated_at = ?4, version = version + 1
       WHERE tenant_id = ?1 AND id = ?2 AND status = ?5`
    ).bind(tenantId, quoteId, nextStatus, now, expectedStatus),
    idempotencyStatement(env.TENANT_DB, {
      tenantId, scope, idempotencyKey, requestHash: hash,
      responseStatus: 200, responseBody: response, now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action, resourceType: 'sales-quote', resourceId: quoteId,
      metadata: { previousStatus: expectedStatus, status: nextStatus }, now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: `sales.quote.${nextStatus}.v1`, aggregateType: 'sales-quote', aggregateId: quoteId,
      aggregateVersion: updated.version, payload: { quoteId, status: nextStatus }, now
    })
  ]);
  return response;
}

async function readSalesOverview(db: D1Database, tenantId: string): Promise<SalesOverviewResponse> {
  const [priceLists, quotes, orders, reservations, availability] = await Promise.all([
    loadPriceLists(db, tenantId),
    loadQuotes(db, tenantId),
    loadOrders(db, tenantId),
    loadReservations(db, tenantId),
    loadAvailability(db, tenantId)
  ]);
  const openQuotes = quotes.filter((quote) => ['draft', 'sent', 'accepted'].includes(quote.status));
  const activeOrders = orders.filter((order) => ['confirmed', 'allocated'].includes(order.status));
  return {
    metrics: {
      openQuoteCount: openQuotes.length,
      openQuoteValueMinor: openQuotes.reduce((sum, item) => safeAdd(sum, item.totalMinor, 'openQuoteValueMinor'), 0),
      activeOrderCount: activeOrders.length,
      activeOrderValueMinor: activeOrders.reduce((sum, item) => safeAdd(sum, item.totalMinor, 'activeOrderValueMinor'), 0),
      reservedQuantityBase: reservations.filter((item) => item.status === 'active')
        .reduce((sum, item) => safeAdd(sum, item.quantityBase, 'reservedQuantityBase'), 0)
    },
    priceLists,
    quotes,
    orders,
    reservations,
    availability
  };
}

async function loadPriceLists(db: D1Database, tenantId: string): Promise<PriceListSummary[]> {
  const [listResult, itemResult] = await Promise.all([
    db.prepare('SELECT * FROM sales_price_lists WHERE tenant_id = ?1 ORDER BY active DESC, display_name, id')
      .bind(tenantId).all<PriceListRow>(),
    db.prepare(
      `SELECT i.*, v.sku, v.display_name AS variant_name
       FROM sales_price_list_items i
       JOIN product_variants v ON v.tenant_id = i.tenant_id AND v.id = i.variant_id
       WHERE i.tenant_id = ?1 ORDER BY i.price_list_id, i.variant_id, i.minimum_quantity_base`
    ).bind(tenantId).all<PriceItemRow>()
  ]);
  const itemsByList = groupBy(itemResult.results, (item) => item.price_list_id);
  return listResult.results.map((row) => ({
    id: row.id, code: row.code, name: row.display_name, currencyCode: row.currency_code,
    validFrom: row.valid_from, validUntil: row.valid_until, active: row.active === 1,
    items: (itemsByList.get(row.id) ?? []).map(priceItemSummary),
    createdAt: row.created_at, updatedAt: row.updated_at, version: Number(row.version)
  }));
}

async function loadQuotes(db: D1Database, tenantId: string): Promise<QuoteSummary[]> {
  const [quoteResult, lineResult] = await Promise.all([
    db.prepare(
      `SELECT q.*, a.display_name AS account_name
       FROM sales_quotes q JOIN crm_accounts a ON a.tenant_id = q.tenant_id AND a.id = q.account_id
       WHERE q.tenant_id = ?1 ORDER BY q.updated_at DESC LIMIT 300`
    ).bind(tenantId).all<QuoteRow>(),
    db.prepare(
      `SELECT id, quote_id AS parent_id, line_number, variant_id, sku_snapshot, description,
       quantity_base, unit_price_minor, discount_basis_points, tax_basis_points,
       subtotal_minor, discount_minor, tax_minor, total_minor
       FROM sales_quote_lines WHERE tenant_id = ?1 ORDER BY quote_id, line_number`
    ).bind(tenantId).all<LineRow>()
  ]);
  const linesByQuote = groupBy(lineResult.results, (line) => line.parent_id);
  return quoteResult.results.map((row) => quoteSummary(row, (linesByQuote.get(row.id) ?? []).map(quoteLineSummary)));
}

async function loadQuote(db: D1Database, tenantId: string, quoteId: string): Promise<QuoteSummary> {
  const row = await db.prepare(
    `SELECT q.*, a.display_name AS account_name
     FROM sales_quotes q JOIN crm_accounts a ON a.tenant_id = q.tenant_id AND a.id = q.account_id
     WHERE q.tenant_id = ?1 AND q.id = ?2`
  ).bind(tenantId, quoteId).first<QuoteRow>();
  if (!row) throw notFoundError('sales-quote-not-found', 'Sales quotation not found.');
  const lines = await db.prepare(
    `SELECT id, quote_id AS parent_id, line_number, variant_id, sku_snapshot, description,
     quantity_base, unit_price_minor, discount_basis_points, tax_basis_points,
     subtotal_minor, discount_minor, tax_minor, total_minor
     FROM sales_quote_lines WHERE tenant_id = ?1 AND quote_id = ?2 ORDER BY line_number`
  ).bind(tenantId, quoteId).all<LineRow>();
  return quoteSummary(row, lines.results.map(quoteLineSummary));
}

async function loadOrders(db: D1Database, tenantId: string): Promise<SalesOrderSummary[]> {
  const [orderResult, lineResult] = await Promise.all([
    db.prepare(
      `SELECT o.*, a.display_name AS account_name
       FROM sales_orders o JOIN crm_accounts a ON a.tenant_id = o.tenant_id AND a.id = o.account_id
       WHERE o.tenant_id = ?1 ORDER BY o.updated_at DESC LIMIT 300`
    ).bind(tenantId).all<OrderRow>(),
    db.prepare(
      `SELECT l.id, l.order_id AS parent_id, l.line_number, l.variant_id, l.sku_snapshot,
       l.description, l.quantity_base, l.unit_price_minor, l.discount_basis_points,
       l.tax_basis_points, l.subtotal_minor, l.discount_minor, l.tax_minor, l.total_minor,
       COALESCE((SELECT SUM(r.quantity_base) FROM inventory_reservations r
         WHERE r.tenant_id = l.tenant_id AND r.order_line_id = l.id AND r.status = 'active'), 0) AS reserved_quantity_base
       FROM sales_order_lines l WHERE l.tenant_id = ?1 ORDER BY l.order_id, l.line_number`
    ).bind(tenantId).all<LineRow>()
  ]);
  const linesByOrder = groupBy(lineResult.results, (line) => line.parent_id);
  return orderResult.results.map((row) => orderSummary(row, (linesByOrder.get(row.id) ?? []).map(orderLineSummary)));
}

async function loadOrder(db: D1Database, tenantId: string, orderId: string): Promise<SalesOrderSummary> {
  const row = await db.prepare(
    `SELECT o.*, a.display_name AS account_name
     FROM sales_orders o JOIN crm_accounts a ON a.tenant_id = o.tenant_id AND a.id = o.account_id
     WHERE o.tenant_id = ?1 AND o.id = ?2`
  ).bind(tenantId, orderId).first<OrderRow>();
  if (!row) throw notFoundError('sales-order-not-found', 'Sales order not found.');
  const lines = await db.prepare(
    `SELECT l.id, l.order_id AS parent_id, l.line_number, l.variant_id, l.sku_snapshot,
     l.description, l.quantity_base, l.unit_price_minor, l.discount_basis_points,
     l.tax_basis_points, l.subtotal_minor, l.discount_minor, l.tax_minor, l.total_minor,
     COALESCE((SELECT SUM(r.quantity_base) FROM inventory_reservations r
       WHERE r.tenant_id = l.tenant_id AND r.order_line_id = l.id AND r.status = 'active'), 0) AS reserved_quantity_base
     FROM sales_order_lines l WHERE l.tenant_id = ?1 AND l.order_id = ?2 ORDER BY l.line_number`
  ).bind(tenantId, orderId).all<LineRow>();
  return orderSummary(row, lines.results.map(orderLineSummary));
}

async function loadReservations(
  db: D1Database,
  tenantId: string,
  orderId?: string,
  status?: InventoryReservationSummary['status']
): Promise<InventoryReservationSummary[]> {
  let sql = `SELECT r.*, v.sku, w.code AS warehouse_code
    FROM inventory_reservations r
    JOIN product_variants v ON v.tenant_id = r.tenant_id AND v.id = r.variant_id
    JOIN warehouses w ON w.tenant_id = r.tenant_id AND w.id = r.warehouse_id
    WHERE r.tenant_id = ?1`;
  const values: unknown[] = [tenantId];
  if (orderId) { sql += ` AND r.order_id = ?${values.length + 1}`; values.push(orderId); }
  if (status) { sql += ` AND r.status = ?${values.length + 1}`; values.push(status); }
  sql += ' ORDER BY r.created_at DESC, r.id';
  const result = await db.prepare(sql).bind(...values).all<ReservationRow>();
  return result.results.map(reservationSummary);
}

async function loadAvailability(db: D1Database, tenantId: string): Promise<ProductAvailabilitySummary[]> {
  const result = await db.prepare(
    `SELECT v.id AS variant_id, v.sku, w.id AS warehouse_id, w.code AS warehouse_code,
       COALESCE(SUM(CASE WHEN b.inventory_status = 'available' THEN b.quantity_base ELSE 0 END), 0) AS on_hand_available_base,
       COALESCE((SELECT SUM(r.quantity_base) FROM inventory_reservations r
         WHERE r.tenant_id = v.tenant_id AND r.variant_id = v.id
           AND r.warehouse_id = w.id AND r.status = 'active'), 0) AS reserved_base
     FROM product_variants v
     CROSS JOIN warehouses w
     LEFT JOIN inventory_balances b ON b.tenant_id = v.tenant_id AND b.variant_id = v.id AND b.warehouse_id = w.id
     WHERE v.tenant_id = ?1 AND v.active = 1 AND w.tenant_id = ?1 AND w.active = 1
     GROUP BY v.id, v.sku, w.id, w.code
     HAVING on_hand_available_base > 0 OR reserved_base > 0
     ORDER BY w.code, v.sku`
  ).bind(tenantId).all<AvailabilityRow>();
  return result.results.map((row) => {
    const onHand = Number(row.on_hand_available_base);
    const reserved = Number(row.reserved_base);
    return {
      variantId: row.variant_id,
      sku: row.sku,
      warehouseId: row.warehouse_id,
      warehouseCode: row.warehouse_code,
      onHandAvailableBase: onHand,
      reservedBase: reserved,
      availableToPromiseBase: Math.max(0, onHand - reserved)
    };
  });
}

async function requireAccount(db: D1Database, tenantId: string, accountId: string): Promise<AccountRow> {
  const account = await db.prepare(
    `SELECT id, display_name, currency_code FROM crm_accounts
     WHERE tenant_id = ?1 AND id = ?2 AND status = 'active'`
  ).bind(tenantId, accountId).first<AccountRow>();
  if (!account) throw notFoundError('crm-account-not-found', 'Active CRM account not found.');
  return account;
}

async function loadVariants(db: D1Database, tenantId: string, ids: string[]): Promise<Map<string, VariantRow>> {
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length === 0) throw validationError('At least one product variant is required.');
  const placeholders = uniqueIds.map((_, index) => `?${index + 2}`).join(', ');
  const result = await db.prepare(
    `SELECT id, sku, display_name FROM product_variants
     WHERE tenant_id = ?1 AND active = 1 AND id IN (${placeholders})`
  ).bind(tenantId, ...uniqueIds).all<VariantRow>();
  if (result.results.length !== uniqueIds.length) throw notFoundError('product-variant-not-found', 'One or more active product variants were not found.');
  return new Map(result.results.map((row) => [row.id, row]));
}

function requireVariant(variants: Map<string, VariantRow>, id: string): VariantRow {
  const variant = variants.get(id);
  if (!variant) throw notFoundError('product-variant-not-found', 'Active product variant not found.');
  return variant;
}

function normalizePriceItems(items: CreatePriceListRequest['items']): Array<{
  variantId: string; minimumQuantityBase: number; unitPriceMinor: number; taxBasisPoints: number;
}> {
  if (!Array.isArray(items) || items.length < 1 || items.length > 500) {
    throw validationError('items must contain 1 to 500 price entries.');
  }
  const normalized = items.map((item) => ({
    variantId: requiredId(item.variantId, 'variantId'),
    minimumQuantityBase: requiredPositiveInteger(item.minimumQuantityBase, 'minimumQuantityBase'),
    unitPriceMinor: moneyMinor(item.unitPriceMinor, 'unitPriceMinor'),
    taxBasisPoints: basisPoints(item.taxBasisPoints ?? 0, 'taxBasisPoints')
  }));
  const keys = normalized.map((item) => `${item.variantId}:${item.minimumQuantityBase}`);
  if (new Set(keys).size !== keys.length) throw validationError('Price list items must have unique variant and quantity break combinations.');
  return normalized;
}

function normalizeQuoteLines(lines: CreateQuoteRequest['lines']): Array<{
  variantId: string; description: string | null; quantityBase: number; unitPriceMinor: number;
  discountBasisPoints: number; taxBasisPoints: number;
}> {
  if (!Array.isArray(lines) || lines.length < 1 || lines.length > 100) {
    throw validationError('lines must contain 1 to 100 quotation lines.');
  }
  return lines.map((line) => ({
    variantId: requiredId(line.variantId, 'variantId'),
    description: optionalText(line.description, 'description', 240),
    quantityBase: requiredPositiveInteger(line.quantityBase, 'quantityBase'),
    unitPriceMinor: moneyMinor(line.unitPriceMinor, 'unitPriceMinor'),
    discountBasisPoints: basisPoints(line.discountBasisPoints ?? 0, 'discountBasisPoints'),
    taxBasisPoints: basisPoints(line.taxBasisPoints ?? 0, 'taxBasisPoints')
  }));
}

function calculateLine(input: {
  id: string; lineNumber: number; variantId: string; sku: string; description: string;
  quantityBase: number; unitPriceMinor: number; discountBasisPoints: number; taxBasisPoints: number;
}): CalculatedLine {
  const subtotalMinor = safeMultiply(input.quantityBase, input.unitPriceMinor, 'line subtotal');
  const discountMinor = Math.floor(safeMultiply(subtotalMinor, input.discountBasisPoints, 'line discount numerator') / 10000);
  const taxableMinor = subtotalMinor - discountMinor;
  const taxMinor = Math.floor(safeMultiply(taxableMinor, input.taxBasisPoints, 'line tax numerator') / 10000);
  const totalMinor = safeAdd(taxableMinor, taxMinor, 'line total');
  return { ...input, subtotalMinor, discountMinor, taxMinor, totalMinor };
}

function documentTotals(lines: CalculatedLine[]): Pick<QuoteSummary, 'subtotalMinor' | 'discountMinor' | 'taxMinor' | 'totalMinor'> {
  return lines.reduce((totals, line) => ({
    subtotalMinor: safeAdd(totals.subtotalMinor, line.subtotalMinor, 'document subtotal'),
    discountMinor: safeAdd(totals.discountMinor, line.discountMinor, 'document discount'),
    taxMinor: safeAdd(totals.taxMinor, line.taxMinor, 'document tax'),
    totalMinor: safeAdd(totals.totalMinor, line.totalMinor, 'document total')
  }), { subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0 });
}

function quoteLineInsert(db: D1Database, tenantId: string, quoteId: string, line: QuoteLineSummary, now: string): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO sales_quote_lines (
       id, tenant_id, quote_id, line_number, variant_id, sku_snapshot, description,
       quantity_base, unit_price_minor, discount_basis_points, tax_basis_points,
       subtotal_minor, discount_minor, tax_minor, total_minor, created_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`
  ).bind(line.id, tenantId, quoteId, line.lineNumber, line.variantId, line.sku,
    line.description, line.quantityBase, line.unitPriceMinor, line.discountBasisPoints,
    line.taxBasisPoints, line.subtotalMinor, line.discountMinor, line.taxMinor, line.totalMinor, now);
}

function orderLineInsert(db: D1Database, tenantId: string, orderId: string, line: SalesOrderLineSummary, now: string): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO sales_order_lines (
       id, tenant_id, order_id, line_number, variant_id, sku_snapshot, description,
       quantity_base, unit_price_minor, discount_basis_points, tax_basis_points,
       subtotal_minor, discount_minor, tax_minor, total_minor, created_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`
  ).bind(line.id, tenantId, orderId, line.lineNumber, line.variantId, line.sku,
    line.description, line.quantityBase, line.unitPriceMinor, line.discountBasisPoints,
    line.taxBasisPoints, line.subtotalMinor, line.discountMinor, line.taxMinor, line.totalMinor, now);
}

function quoteSummary(row: QuoteRow, lines: QuoteLineSummary[]): QuoteSummary {
  return {
    id: row.id, quoteNumber: row.quote_number, accountId: row.account_id,
    accountName: row.account_name, status: row.status, currencyCode: row.currency_code,
    validUntil: row.valid_until, customerReference: row.customer_reference, notes: row.notes,
    subtotalMinor: Number(row.subtotal_minor), discountMinor: Number(row.discount_minor),
    taxMinor: Number(row.tax_minor), totalMinor: Number(row.total_minor),
    convertedOrderId: row.converted_order_id, lines, createdAt: row.created_at,
    updatedAt: row.updated_at, version: Number(row.version)
  };
}

function orderSummary(row: OrderRow, lines: SalesOrderLineSummary[]): SalesOrderSummary {
  return {
    id: row.id, orderNumber: row.order_number, accountId: row.account_id,
    accountName: row.account_name, sourceQuoteId: row.source_quote_id, status: row.status,
    currencyCode: row.currency_code, requestedDeliveryDate: row.requested_delivery_date,
    customerReference: row.customer_reference, subtotalMinor: Number(row.subtotal_minor),
    discountMinor: Number(row.discount_minor), taxMinor: Number(row.tax_minor),
    totalMinor: Number(row.total_minor), lines, createdAt: row.created_at,
    updatedAt: row.updated_at, version: Number(row.version)
  };
}

function quoteLineSummary(row: LineRow): QuoteLineSummary {
  return {
    id: row.id, lineNumber: Number(row.line_number), variantId: row.variant_id,
    sku: row.sku_snapshot, description: row.description, quantityBase: Number(row.quantity_base),
    unitPriceMinor: Number(row.unit_price_minor), discountBasisPoints: Number(row.discount_basis_points),
    taxBasisPoints: Number(row.tax_basis_points), subtotalMinor: Number(row.subtotal_minor),
    discountMinor: Number(row.discount_minor), taxMinor: Number(row.tax_minor), totalMinor: Number(row.total_minor)
  };
}

function orderLineSummary(row: LineRow): SalesOrderLineSummary {
  return { ...quoteLineSummary(row), reservedQuantityBase: Number(row.reserved_quantity_base ?? 0) };
}

function priceItemSummary(row: PriceItemRow): PriceListItemSummary {
  return {
    id: row.id, variantId: row.variant_id, sku: row.sku, variantName: row.variant_name,
    minimumQuantityBase: Number(row.minimum_quantity_base), unitPriceMinor: Number(row.unit_price_minor),
    taxBasisPoints: Number(row.tax_basis_points)
  };
}

function reservationSummary(row: ReservationRow): InventoryReservationSummary {
  return {
    id: row.id, orderId: row.order_id, orderLineId: row.order_line_id,
    variantId: row.variant_id, sku: row.sku, warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code, quantityBase: Number(row.quantity_base), status: row.status,
    createdAt: row.created_at, releasedAt: row.released_at
  };
}

function moneyMinor(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw validationError(`${field} must be a non-negative safe integer in minor currency units.`);
  }
  return Number(value);
}

function basisPoints(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 10000) {
    throw validationError(`${field} must be an integer from 0 to 10000.`);
  }
  return Number(value);
}

function currency(value: unknown): string {
  const normalized = requiredText(value, 'currencyCode', 3, 3).toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw validationError('currencyCode must be a three-letter ISO code.');
  return normalized;
}

function tenantCurrency(value: unknown, session: ResolvedSession): string {
  const normalized = currency(value);
  if (normalized !== session.response.tenant.defaultCurrency.toUpperCase()) {
    throw validationError(`currencyCode must match tenant currency ${session.response.tenant.defaultCurrency}.`);
  }
  return normalized;
}

function accountCurrency(value: unknown, expected: string): string {
  const normalized = currency(value);
  if (normalized !== expected) throw validationError(`currencyCode must match account currency ${expected}.`);
  return normalized;
}

function requiredDate(value: unknown, field: string): string {
  const parsed = optionalDate(value, field);
  if (!parsed) throw validationError(`${field} is required.`);
  return parsed;
}

function safeMultiply(a: number, b: number, field: string): number {
  const result = a * b;
  if (!Number.isSafeInteger(result)) throw validationError(`${field} exceeds safe integer limits.`);
  return result;
}

function safeAdd(a: number, b: number, field: string): number {
  const result = a + b;
  if (!Number.isSafeInteger(result)) throw validationError(`${field} exceeds safe integer limits.`);
  return result;
}

function businessNumber(prefix: string, now: string): string {
  const compactDate = now.slice(0, 10).replaceAll('-', '');
  return `${prefix}-${compactDate}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    const existing = grouped.get(groupKey);
    if (existing) existing.push(value);
    else grouped.set(groupKey, [value]);
  }
  return grouped;
}
