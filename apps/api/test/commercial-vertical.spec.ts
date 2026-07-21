import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { OnboardTenantResponse, ProblemDetails } from '@fmcgbyalex/contracts';
import type {
  ConvertQuoteResponse,
  CreateCrmAccountResponse,
  CreateCrmContactResponse,
  CreateCrmTaskResponse,
  CreateOpportunityResponse,
  CreatePriceListResponse,
  CrmOverviewResponse,
  QuoteCommandResponse,
  SalesOverviewResponse
} from '@fmcgbyalex/contracts/commercial';
import type {
  CreateProductResponse,
  CreateWarehouseResponse,
  InventoryCommandResponse
} from '@fmcgbyalex/contracts/inventory';

describe('CRM and sales commercial vertical', () => {
  it('runs CRM follow-up, quote-to-order conversion and reservation release', async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const identity = {
      subject: `commercial-admin-${suffix}`,
      email: `commercial-admin-${suffix}@example.com`,
      name: 'Commercial Administrator'
    };
    const tenant = await onboard(identity, `commercial-${suffix}`);
    const headers = tenantHeaders(identity, tenant.tenantId);
    const product = await createProduct(headers, suffix);
    const variant = product.product.variants[0]!;
    const warehouse = await createWarehouse(headers, suffix);
    await command<InventoryCommandResponse>('POST', '/v1/inventory/receipts', headers, `receipt-${suffix}`, {
      variantId: variant.id,
      warehouseId: warehouse.warehouse.id,
      lotCode: `COMM-${suffix}`,
      expiresOn: '2027-12-31',
      quantityBase: 1000,
      referenceType: 'purchase-receipt',
      referenceId: `GRN-COMM-${suffix}`
    }, 201);

    const account = await command<CreateCrmAccountResponse>('POST', '/v1/crm/accounts', headers, `account-${suffix}`, {
      code: `ACC-${suffix}`,
      name: `Benelux Retail ${suffix}`,
      accountType: 'retailer',
      countryCode: 'NL',
      currencyCode: 'EUR'
    }, 201);
    const contact = await command<CreateCrmContactResponse>('POST', '/v1/crm/contacts', headers, `contact-${suffix}`, {
      accountId: account.account.id,
      firstName: 'Sophie',
      lastName: 'Buyer',
      jobTitle: 'Category Manager',
      email: `buyer-${suffix}@example.com`,
      primary: true
    }, 201);
    expect(contact.contact.primary).toBe(true);

    await command('POST', '/v1/crm/activities', headers, `activity-${suffix}`, {
      accountId: account.account.id,
      contactId: contact.contact.id,
      activityType: 'meeting',
      subject: 'Range review meeting',
      body: 'Reviewed launch volumes and promotional calendar.'
    }, 201);
    const task = await command<CreateCrmTaskResponse>('POST', '/v1/crm/tasks', headers, `task-${suffix}`, {
      accountId: account.account.id,
      subject: 'Send revised commercial proposal',
      dueAt: '2026-07-01T09:00:00.000Z',
      priority: 'high'
    }, 201);
    expect(task.task.overdue).toBe(true);
    const opportunity = await command<CreateOpportunityResponse>('POST', '/v1/crm/opportunities', headers, `opportunity-${suffix}`, {
      accountId: account.account.id,
      name: 'National beverage listing',
      stage: 'proposal',
      expectedValueMinor: 2500000,
      currencyCode: 'EUR',
      probabilityBasisPoints: 6000,
      expectedCloseDate: '2026-09-30',
      nextAction: 'Secure buyer approval'
    }, 201);
    expect(opportunity.opportunity.weightedValueMinor).toBe(1500000);

    const crm = await fetchJson<CrmOverviewResponse>('/v1/crm/overview', { headers });
    expect(crm.response.status).toBe(200);
    expect(crm.body.metrics.accountCount).toBe(1);
    expect(crm.body.metrics.overdueTaskCount).toBe(1);
    expect(crm.body.metrics.pipelineMinor).toBe(2500000);

    const priceList = await command<CreatePriceListResponse>('POST', '/v1/sales/price-lists', headers, `price-${suffix}`, {
      code: `EUR-RETAIL-${suffix}`,
      name: 'EUR Retail Price List',
      currencyCode: 'EUR',
      validFrom: '2026-07-01',
      items: [{ variantId: variant.id, minimumQuantityBase: 1, unitPriceMinor: 199, taxBasisPoints: 2100 }]
    }, 201);
    expect(priceList.priceList.items[0]?.unitPriceMinor).toBe(199);

    const quoteBody = {
      accountId: account.account.id,
      currencyCode: 'EUR',
      validUntil: '2026-12-31',
      customerReference: `BUY-${suffix}`,
      lines: [{
        variantId: variant.id,
        quantityBase: 100,
        unitPriceMinor: 199,
        discountBasisPoints: 1000,
        taxBasisPoints: 2100
      }]
    };
    const quote = await command<QuoteCommandResponse>('POST', '/v1/sales/quotes', headers, `quote-${suffix}`, quoteBody, 201);
    expect(quote.quote.subtotalMinor).toBe(19900);
    expect(quote.quote.discountMinor).toBe(1990);
    expect(quote.quote.taxMinor).toBe(3761);
    expect(quote.quote.totalMinor).toBe(21671);

    const quoteReplay = await command<QuoteCommandResponse>('POST', '/v1/sales/quotes', headers, `quote-${suffix}`, quoteBody, 200);
    expect(quoteReplay.replayed).toBe(true);
    expect(quoteReplay.quote.id).toBe(quote.quote.id);

    await command<QuoteCommandResponse>('POST', `/v1/sales/quotes/${quote.quote.id}/send`, headers, `send-${suffix}`, undefined, 200);
    await command<QuoteCommandResponse>('POST', `/v1/sales/quotes/${quote.quote.id}/accept`, headers, `accept-${suffix}`, undefined, 200);
    const converted = await command<ConvertQuoteResponse>('POST', `/v1/sales/quotes/${quote.quote.id}/convert`, headers, `convert-${suffix}`, {
      warehouseId: warehouse.warehouse.id,
      requestedDeliveryDate: '2026-08-15'
    }, 201);
    expect(converted.order.status).toBe('allocated');
    expect(converted.order.totalMinor).toBe(21671);
    expect(converted.reservations[0]?.quantityBase).toBe(100);

    const conversionReplay = await command<ConvertQuoteResponse>('POST', `/v1/sales/quotes/${quote.quote.id}/convert`, headers, `convert-${suffix}`, {
      warehouseId: warehouse.warehouse.id,
      requestedDeliveryDate: '2026-08-15'
    }, 200);
    expect(conversionReplay.replayed).toBe(true);
    expect(conversionReplay.order.id).toBe(converted.order.id);

    const largeQuote = await createAcceptedQuote(headers, suffix, account.account.id, variant.id, 950);
    const overcommit = await commandResult<ProblemDetails>('POST', `/v1/sales/quotes/${largeQuote.quote.id}/convert`, headers, `overcommit-${suffix}`, {
      warehouseId: warehouse.warehouse.id
    });
    expect(overcommit.response.status).toBe(409);
    expect(overcommit.body.type).toBe('https://fmcgbyalex.com/problems/sales-insufficient-available-stock');

    const cancellation = await command<{
      order: { status: string };
      releasedReservations: Array<{ status: string }>;
      replayed: boolean;
    }>('POST', `/v1/sales/orders/${converted.order.id}/cancel`, headers, `cancel-${suffix}`, undefined, 200);
    expect(cancellation.order.status).toBe('cancelled');
    expect(cancellation.releasedReservations[0]?.status).toBe('released');

    const sales = await fetchJson<SalesOverviewResponse>('/v1/sales/overview', { headers });
    expect(sales.response.status).toBe(200);
    const availability = sales.body.availability.find((item) =>
      item.variantId === variant.id && item.warehouseId === warehouse.warehouse.id
    );
    expect(availability?.onHandAvailableBase).toBe(1000);
    expect(availability?.reservedBase).toBe(0);
    expect(availability?.availableToPromiseBase).toBe(1000);
    expect(sales.body.orders.find((item) => item.id === converted.order.id)?.status).toBe('cancelled');
  });

  it('keeps accounts, quotes and reservations isolated between tenants', async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const identityA = { subject: `commercial-a-${suffix}`, email: `a-${suffix}@example.com`, name: 'Commercial A' };
    const identityB = { subject: `commercial-b-${suffix}`, email: `b-${suffix}@example.com`, name: 'Commercial B' };
    const tenantA = await onboard(identityA, `commercial-a-${suffix}`);
    const tenantB = await onboard(identityB, `commercial-b-${suffix}`);
    const headersA = tenantHeaders(identityA, tenantA.tenantId);
    const headersB = tenantHeaders(identityB, tenantB.tenantId);
    await command<CreateCrmAccountResponse>('POST', '/v1/crm/accounts', headersA, `private-account-${suffix}`, {
      code: `PRIVATE-${suffix}`,
      name: 'Private Account A',
      accountType: 'customer',
      countryCode: 'NL',
      currencyCode: 'EUR'
    }, 201);

    const overviewB = await fetchJson<CrmOverviewResponse>('/v1/crm/overview', { headers: headersB });
    expect(overviewB.response.status).toBe(200);
    expect(overviewB.body.accounts).toHaveLength(0);
    expect(overviewB.body.opportunities).toHaveLength(0);

    const forged = await fetchJson<ProblemDetails>('/v1/sales/overview', {
      headers: identityHeaders(identityB, { 'X-Tenant-Id': tenantA.tenantId })
    });
    expect(forged.response.status).toBe(403);
  });
});

async function createAcceptedQuote(
  headers: HeadersInit,
  suffix: string,
  accountId: string,
  variantId: string,
  quantityBase: number
): Promise<QuoteCommandResponse> {
  const quote = await command<QuoteCommandResponse>('POST', '/v1/sales/quotes', headers, `large-quote-${suffix}`, {
    accountId,
    currencyCode: 'EUR',
    validUntil: '2026-12-31',
    lines: [{ variantId, quantityBase, unitPriceMinor: 100, taxBasisPoints: 2100 }]
  }, 201);
  await command('POST', `/v1/sales/quotes/${quote.quote.id}/send`, headers, `large-send-${suffix}`, undefined, 200);
  await command('POST', `/v1/sales/quotes/${quote.quote.id}/accept`, headers, `large-accept-${suffix}`, undefined, 200);
  return (await fetchJson<SalesOverviewResponse>('/v1/sales/overview', { headers })).body.quotes.find((item) => item.id === quote.quote.id)
    ? { quote: (await fetchJson<SalesOverviewResponse>('/v1/sales/overview', { headers })).body.quotes.find((item) => item.id === quote.quote.id)!, replayed: false }
    : quote;
}

async function onboard(
  identity: { subject: string; email: string; name: string },
  slug: string
): Promise<OnboardTenantResponse> {
  const result = await fetchJson<OnboardTenantResponse>('/v1/onboarding/tenant', {
    method: 'POST',
    headers: identityHeaders(identity, {
      'Content-Type': 'application/json',
      'Idempotency-Key': `onboard-${slug}`
    }),
    body: JSON.stringify({
      tenantName: slug.replaceAll('-', ' '),
      tenantSlug: slug,
      adminDisplayName: identity.name,
      defaultCurrency: 'EUR',
      defaultLocale: 'en-NL',
      defaultTimezone: 'Europe/Amsterdam'
    })
  });
  expect(result.response.status).toBe(201);
  return result.body;
}

async function createProduct(headers: HeadersInit, suffix: string): Promise<CreateProductResponse> {
  return command<CreateProductResponse>('POST', '/v1/master-data/products', headers, `product-${suffix}`, {
    code: `COMM-PROD-${suffix}`,
    name: `Commercial Product ${suffix}`,
    brand: 'FMCG by Alex',
    category: 'Beverages',
    baseUnitCode: 'EA',
    baseUnitName: 'Each',
    shelfLifeDays: 365,
    variants: [{
      sku: `COMM-SKU-${suffix}`,
      name: 'Commercial SKU',
      packQuantityBase: 1,
      caseQuantityBase: 24
    }]
  }, 201);
}

async function createWarehouse(headers: HeadersInit, suffix: string): Promise<CreateWarehouseResponse> {
  return command<CreateWarehouseResponse>('POST', '/v1/master-data/warehouses', headers, `warehouse-${suffix}`, {
    legalEntityCode: `NL-${suffix}`,
    legalEntityName: 'Commercial Netherlands B.V.',
    siteCode: `COMM-SITE-${suffix}`,
    siteName: 'Commercial Distribution Site',
    warehouseCode: `COMM-WH-${suffix}`,
    warehouseName: 'Commercial Warehouse',
    timezone: 'Europe/Amsterdam',
    defaultZoneCode: 'GENERAL',
    defaultBinCode: 'PICK'
  }, 201);
}

async function command<T>(
  method: string,
  path: string,
  headers: HeadersInit,
  idempotencyKey: string,
  body: unknown,
  expectedStatus: number
): Promise<T> {
  const result = await commandResult<T>(method, path, headers, idempotencyKey, body);
  expect(result.response.status).toBe(expectedStatus);
  return result.body;
}

async function commandResult<T>(
  method: string,
  path: string,
  headers: HeadersInit,
  idempotencyKey: string,
  body: unknown
): Promise<{ response: Response; body: T }> {
  return fetchJson<T>(path, {
    method,
    headers: jsonHeaders(headers, idempotencyKey),
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

async function fetchJson<T>(path: string, init: RequestInit): Promise<{ response: Response; body: T }> {
  const response = await SELF.fetch(`https://api.example${path}`, init);
  return { response, body: await response.json<T>() };
}

function tenantHeaders(
  identity: { subject: string; email: string; name: string },
  tenantId: string
): HeadersInit {
  return identityHeaders(identity, { 'X-Tenant-Id': tenantId });
}

function jsonHeaders(headers: HeadersInit, idempotencyKey: string): HeadersInit {
  return {
    ...Object.fromEntries(new Headers(headers).entries()),
    'Content-Type': 'application/json',
    'Idempotency-Key': idempotencyKey
  };
}

function identityHeaders(
  identity: { subject: string; email: string; name: string },
  extra: Record<string, string> = {}
): HeadersInit {
  return {
    'X-Dev-Identity-Subject': identity.subject,
    'X-Dev-Identity-Email': identity.email,
    'X-Dev-Identity-Name': identity.name,
    ...extra
  };
}
