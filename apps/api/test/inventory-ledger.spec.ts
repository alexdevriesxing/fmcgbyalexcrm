import { env } from 'cloudflare:workers';
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type {
  CreatePartyResponse,
  CreateProductResponse,
  CreateWarehouseResponse,
  FefoResponse,
  InventoryCommandResponse,
  InventoryOverviewResponse,
  ProductCatalogResponse
} from '@fmcgbyalex/contracts/inventory';
import type { OnboardTenantResponse, ProblemDetails } from '@fmcgbyalex/contracts';

describe('master data and inventory ledger', () => {
  it('reconciles receipts, transfers, quarantine, release and reversal entries', async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const identity = {
      subject: `inventory-admin-${suffix}`,
      email: `inventory-admin-${suffix}@example.com`,
      name: 'Inventory Administrator'
    };
    const tenant = await onboard(identity, `inventory-${suffix}`);
    const headers = tenantHeaders(identity, tenant.tenantId);

    const supplier = await createParty(headers, suffix);
    const product = await createProduct(headers, suffix);
    const variantId = product.product.variants[0]!.id;
    const primary = await createWarehouse(headers, suffix, 'MAIN');
    const secondary = await createWarehouse(headers, suffix, 'SECONDARY');

    const firstReceipt = await command<InventoryCommandResponse>(
      '/v1/inventory/receipts',
      headers,
      `receipt-a-${suffix}`,
      {
        variantId,
        warehouseId: primary.warehouse.id,
        lotCode: `LOT-A-${suffix}`,
        manufacturedOn: '2026-06-01',
        expiresOn: '2026-08-15',
        supplierPartyId: supplier.party.id,
        quantityBase: 1000,
        referenceType: 'purchase-receipt',
        referenceId: `GRN-A-${suffix}`
      },
      201
    );
    expect(firstReceipt.movements).toHaveLength(1);
    expect(firstReceipt.balances[0]?.quantityBase).toBe(1000);

    const replayResponse = await fetchJson<InventoryCommandResponse>(
      '/v1/inventory/receipts',
      {
        method: 'POST',
        headers: jsonHeaders(headers, `receipt-a-${suffix}`),
        body: JSON.stringify({
          variantId,
          warehouseId: primary.warehouse.id,
          lotCode: `LOT-A-${suffix}`,
          manufacturedOn: '2026-06-01',
          expiresOn: '2026-08-15',
          supplierPartyId: supplier.party.id,
          quantityBase: 1000,
          referenceType: 'purchase-receipt',
          referenceId: `GRN-A-${suffix}`
        })
      }
    );
    expect(replayResponse.response.status).toBe(200);
    expect(replayResponse.body.replayed).toBe(true);

    const secondReceipt = await command<InventoryCommandResponse>(
      '/v1/inventory/receipts',
      headers,
      `receipt-b-${suffix}`,
      {
        variantId,
        warehouseId: primary.warehouse.id,
        lotCode: `LOT-B-${suffix}`,
        manufacturedOn: '2026-06-15',
        expiresOn: '2026-09-30',
        supplierPartyId: supplier.party.id,
        quantityBase: 500,
        referenceType: 'purchase-receipt',
        referenceId: `GRN-B-${suffix}`
      },
      201
    );
    const lotA = firstReceipt.balances[0]!.lot.id;
    const lotB = secondReceipt.balances[0]!.lot.id;

    const fefo = await fetchJson<FefoResponse>(
      `/v1/inventory/fefo?variantId=${encodeURIComponent(variantId)}&warehouseId=${encodeURIComponent(primary.warehouse.id)}&quantityBase=1200`,
      { headers }
    );
    expect(fefo.response.status).toBe(200);
    expect(fefo.body.fullyAllocated).toBe(true);
    expect(fefo.body.candidates.map((candidate) => candidate.balance.lot.id)).toEqual([lotA, lotB]);
    expect(fefo.body.candidates.map((candidate) => candidate.recommendedQuantityBase)).toEqual([1000, 200]);

    const transfer = await command<InventoryCommandResponse>(
      '/v1/inventory/transfers',
      headers,
      `transfer-${suffix}`,
      {
        variantId,
        sourceWarehouseId: primary.warehouse.id,
        destinationWarehouseId: secondary.warehouse.id,
        lotId: lotA,
        status: 'available',
        quantityBase: 250,
        referenceId: `TRN-${suffix}`
      },
      201
    );
    expect(transfer.movements.map((movement) => movement.quantityDeltaBase).sort((a, b) => a - b)).toEqual([-250, 250]);

    const quarantine = await command<InventoryCommandResponse>(
      '/v1/inventory/quarantine',
      headers,
      `quarantine-${suffix}`,
      {
        variantId,
        warehouseId: secondary.warehouse.id,
        lotId: lotA,
        quantityBase: 100,
        reason: 'Quality inspection required',
        referenceId: `QA-${suffix}`
      },
      201
    );
    expect(quarantine.movements.map((movement) => movement.status)).toEqual(
      expect.arrayContaining(['available', 'quarantine'])
    );

    const release = await command<InventoryCommandResponse>(
      '/v1/inventory/releases',
      headers,
      `release-${suffix}`,
      {
        variantId,
        warehouseId: secondary.warehouse.id,
        lotId: lotA,
        quantityBase: 40,
        reason: 'Quality inspection passed',
        referenceId: `QA-REL-${suffix}`
      },
      201
    );
    expect(release.movements).toHaveLength(2);

    const adjustment = await command<InventoryCommandResponse>(
      '/v1/inventory/adjustments',
      headers,
      `adjust-${suffix}`,
      {
        variantId,
        warehouseId: primary.warehouse.id,
        lotId: lotB,
        status: 'available',
        quantityDeltaBase: 25,
        reason: 'Count correction after recount',
        referenceId: `COUNT-${suffix}`
      },
      201
    );
    const adjustmentMovementId = adjustment.movements[0]!.id;

    const reversal = await command<InventoryCommandResponse>(
      `/v1/inventory/movements/${adjustmentMovementId}/reversal`,
      headers,
      `reverse-${suffix}`,
      {
        reason: 'Count document was entered twice',
        referenceId: `REV-${suffix}`
      },
      201
    );
    expect(reversal.movements[0]?.reversalOfMovementId).toBe(adjustmentMovementId);
    expect(reversal.movements[0]?.quantityDeltaBase).toBe(-25);

    const insufficient = await fetchJson<ProblemDetails>('/v1/inventory/transfers', {
      method: 'POST',
      headers: jsonHeaders(headers, `insufficient-${suffix}`),
      body: JSON.stringify({
        variantId,
        sourceWarehouseId: primary.warehouse.id,
        destinationWarehouseId: secondary.warehouse.id,
        lotId: lotA,
        status: 'available',
        quantityBase: 999999,
        referenceId: `TRN-FAIL-${suffix}`
      })
    });
    expect(insufficient.response.status).toBe(409);
    expect(insufficient.body.type).toBe('https://fmcgbyalex.com/problems/insufficient-stock');

    const overview = await fetchJson<InventoryOverviewResponse>('/v1/inventory/overview', { headers });
    expect(overview.response.status).toBe(200);
    expect(overview.body.totals.quantityBase).toBe(1500);
    expect(overview.body.totals.quarantineBase).toBe(60);

    const database = env.TENANT_DB;
    const ledger = await database.prepare(
      `SELECT COALESCE(SUM(quantity_delta_base), 0) AS total
       FROM inventory_movements WHERE tenant_id = ?1`
    )
      .bind(tenant.tenantId)
      .first<{ total: number }>();
    const balances = await database.prepare(
      `SELECT COALESCE(SUM(quantity_base), 0) AS total
       FROM inventory_balances WHERE tenant_id = ?1`
    )
      .bind(tenant.tenantId)
      .first<{ total: number }>();
    expect(ledger?.total).toBe(balances?.total);
    expect(balances?.total).toBe(1500);
  });

  it('keeps product and inventory data isolated between tenants', async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const identityA = {
      subject: `tenant-a-${suffix}`,
      email: `tenant-a-${suffix}@example.com`,
      name: 'Tenant A Admin'
    };
    const identityB = {
      subject: `tenant-b-${suffix}`,
      email: `tenant-b-${suffix}@example.com`,
      name: 'Tenant B Admin'
    };
    const tenantA = await onboard(identityA, `tenant-a-${suffix}`);
    const tenantB = await onboard(identityB, `tenant-b-${suffix}`);
    const headersA = tenantHeaders(identityA, tenantA.tenantId);
    const headersB = tenantHeaders(identityB, tenantB.tenantId);

    const productA = await createProduct(headersA, `a-${suffix}`);
    const warehouseA = await createWarehouse(headersA, `a-${suffix}`, 'MAIN');
    await command<InventoryCommandResponse>(
      '/v1/inventory/receipts',
      headersA,
      `receipt-a-${suffix}`,
      {
        variantId: productA.product.variants[0]!.id,
        warehouseId: warehouseA.warehouse.id,
        lotCode: `PRIVATE-${suffix}`,
        expiresOn: '2026-12-31',
        quantityBase: 75,
        referenceType: 'purchase-receipt',
        referenceId: `PRIVATE-GRN-${suffix}`
      },
      201
    );

    const catalogB = await fetchJson<ProductCatalogResponse>('/v1/master-data/products', {
      headers: headersB
    });
    const overviewB = await fetchJson<InventoryOverviewResponse>('/v1/inventory/overview', {
      headers: headersB
    });
    expect(catalogB.response.status).toBe(200);
    expect(catalogB.body.products).toHaveLength(0);
    expect(overviewB.response.status).toBe(200);
    expect(overviewB.body.totals.quantityBase).toBe(0);
    expect(overviewB.body.balances).toHaveLength(0);

    const forged = await fetchJson<ProblemDetails>('/v1/inventory/overview', {
      headers: identityHeaders(identityB, { 'X-Tenant-Id': tenantA.tenantId })
    });
    expect(forged.response.status).toBe(403);
  });
});

async function onboard(
  identity: { subject: string; email: string; name: string },
  slug: string
): Promise<OnboardTenantResponse> {
  const response = await fetchJson<OnboardTenantResponse>('/v1/onboarding/tenant', {
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
  expect(response.response.status).toBe(201);
  return response.body;
}

async function createProduct(headers: HeadersInit, suffix: string): Promise<CreateProductResponse> {
  return command<CreateProductResponse>(
    '/v1/master-data/products',
    headers,
    `product-${suffix}`,
    {
      code: `DRINK-${suffix}`,
      name: `Botanical Drink ${suffix}`,
      brand: 'FMCG by Alex',
      category: 'Beverages',
      baseUnitCode: 'EA',
      baseUnitName: 'Each',
      shelfLifeDays: 365,
      variants: [
        {
          sku: `DRINK-330-${suffix}`,
          name: 'Botanical Drink 330 ml',
          barcode: `871${suffix.replaceAll('-', '').padEnd(10, '0').slice(0, 10)}`,
          packQuantityBase: 1,
          caseQuantityBase: 24
        }
      ]
    },
    201
  );
}

async function createWarehouse(
  headers: HeadersInit,
  suffix: string,
  code: string
): Promise<CreateWarehouseResponse> {
  return command<CreateWarehouseResponse>(
    '/v1/master-data/warehouses',
    headers,
    `warehouse-${code}-${suffix}`,
    {
      legalEntityCode: `NL-${suffix}`,
      legalEntityName: 'Netherlands Operating Company',
      siteCode: `${code}-SITE-${suffix}`,
      siteName: `${code} Logistics Site`,
      warehouseCode: `${code}-${suffix}`,
      warehouseName: `${code} Warehouse`,
      timezone: 'Europe/Amsterdam',
      defaultZoneCode: 'GENERAL',
      defaultBinCode: 'RECEIVING'
    },
    201
  );
}

async function createParty(headers: HeadersInit, suffix: string): Promise<CreatePartyResponse> {
  return command<CreatePartyResponse>(
    '/v1/master-data/parties',
    headers,
    `party-${suffix}`,
    {
      code: `SUP-${suffix}`,
      name: `Ingredient Supplier ${suffix}`,
      type: 'supplier',
      countryCode: 'NL',
      email: `supplier-${suffix}@example.com`
    },
    201
  );
}

async function command<T>(
  path: string,
  headers: HeadersInit,
  idempotencyKey: string,
  body: unknown,
  expectedStatus: number
): Promise<T> {
  const result = await fetchJson<T>(path, {
    method: 'POST',
    headers: jsonHeaders(headers, idempotencyKey),
    body: JSON.stringify(body)
  });
  expect(result.response.status).toBe(expectedStatus);
  return result.body;
}

async function fetchJson<T>(
  path: string,
  init: RequestInit
): Promise<{ response: Response; body: T }> {
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
