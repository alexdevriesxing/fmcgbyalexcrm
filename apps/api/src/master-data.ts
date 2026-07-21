import type {
  CreatePartyRequest,
  CreatePartyResponse,
  CreateProductRequest,
  CreateProductResponse,
  CreateWarehouseRequest,
  CreateWarehouseResponse,
  PartyListResponse,
  PartySummary,
  ProductCatalogResponse,
  ProductSummary,
  ProductVariantSummary,
  WarehouseListResponse,
  WarehouseSummary
} from '@fmcgbyalex/contracts/inventory';
import type { ResolvedSession } from './platform';
import {
  conflictError,
  countryCode,
  domainAuditStatement,
  domainOutboxStatement,
  idempotencyStatement,
  normalizedCode,
  optionalEmail,
  optionalNonNegativeInteger,
  optionalText,
  readDomainReplay,
  requestHash,
  requireDomainAccess,
  requireIdempotencyKey,
  requiredPositiveInteger,
  requiredText,
  validateTimezone,
  validationError
} from './domain-support';

const PARTY_TYPES = new Set(['supplier', 'customer', 'distributor', 'retailer']);

type ProductRow = {
  id: string;
  code: string;
  display_name: string;
  brand_name: string;
  category_name: string;
  base_unit_code: string;
  shelf_life_days: number | null;
  active: number;
  created_at: string;
  updated_at: string;
  version: number;
};

type VariantRow = {
  id: string;
  product_id: string;
  sku: string;
  display_name: string;
  barcode: string | null;
  base_unit_code: string;
  pack_quantity_base: number;
  case_quantity_base: number | null;
  active: number;
  version: number;
};

type NamedIdRow = { id: string };
type ProductIdReplay = { productId: string };
type WarehouseIdReplay = { warehouseId: string };
type PartyIdReplay = { partyId: string };

type WarehouseRow = {
  id: string;
  code: string;
  display_name: string;
  site_code: string;
  site_name: string;
  legal_entity_code: string;
  timezone: string;
  active: number;
  default_zone_id: string;
  default_bin_id: string;
  created_at: string;
  updated_at: string;
  version: number;
};

type PartyRow = {
  id: string;
  code: string;
  display_name: string;
  party_type: 'supplier' | 'customer' | 'distributor' | 'retailer';
  country_code: string;
  tax_id: string | null;
  email: string | null;
  phone: string | null;
  active: number;
  created_at: string;
  updated_at: string;
  version: number;
};

export async function listProducts(
  env: Env,
  request: Request,
  session: ResolvedSession
): Promise<ProductCatalogResponse> {
  await requireDomainAccess(
    env,
    request,
    session,
    'master-data',
    'master-data.catalog.read',
    'master-data.products.read'
  );

  const products = await env.TENANT_DB.prepare(
    `SELECT
       p.id, p.code, p.display_name,
       b.display_name AS brand_name,
       c.display_name AS category_name,
       u.code AS base_unit_code,
       p.shelf_life_days, p.active, p.created_at, p.updated_at, p.version
     FROM products p
     JOIN product_brands b ON b.tenant_id = p.tenant_id AND b.id = p.brand_id
     JOIN product_categories c ON c.tenant_id = p.tenant_id AND c.id = p.category_id
     JOIN units_of_measure u ON u.tenant_id = p.tenant_id AND u.id = p.base_unit_id
     WHERE p.tenant_id = ?1
     ORDER BY p.display_name, p.code`
  )
    .bind(session.response.tenant.id)
    .all<ProductRow>();

  const variants = await env.TENANT_DB.prepare(
    `SELECT
       v.id, v.product_id, v.sku, v.display_name, v.barcode,
       u.code AS base_unit_code, v.pack_quantity_base,
       v.case_quantity_base, v.active, v.version
     FROM product_variants v
     JOIN units_of_measure u ON u.tenant_id = v.tenant_id AND u.id = v.base_unit_id
     WHERE v.tenant_id = ?1
     ORDER BY v.sku, v.id`
  )
    .bind(session.response.tenant.id)
    .all<VariantRow>();

  const variantsByProduct = new Map<string, ProductVariantSummary[]>();
  for (const row of variants.results) {
    const values = variantsByProduct.get(row.product_id) ?? [];
    values.push(toVariantSummary(row));
    variantsByProduct.set(row.product_id, values);
  }

  return {
    products: products.results.map((row) => toProductSummary(row, variantsByProduct.get(row.id) ?? []))
  };
}

export async function createProduct(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: CreateProductRequest
): Promise<CreateProductResponse> {
  await requireDomainAccess(
    env,
    request,
    session,
    'master-data',
    'master-data.catalog.manage',
    'master-data.product.create'
  );

  const tenantId = session.response.tenant.id;
  const code = normalizedCode(input.code, 'code');
  const name = requiredText(input.name, 'name', 2, 160);
  const brandName = requiredText(input.brand, 'brand', 1, 120);
  const brandCode = normalizedCode(toBusinessCode(brandName), 'brand');
  const categoryName = requiredText(input.category, 'category', 1, 120);
  const categoryCode = normalizedCode(toBusinessCode(categoryName), 'category');
  const unitCode = normalizedCode(input.baseUnitCode, 'baseUnitCode');
  const unitName = requiredText(input.baseUnitName, 'baseUnitName', 1, 80);
  const precisionDigits = optionalNonNegativeInteger(input.baseUnitPrecision, 'baseUnitPrecision') ?? 0;
  if (precisionDigits > 6) throw validationError('baseUnitPrecision must be between 0 and 6.');
  const shelfLifeDays = optionalNonNegativeInteger(input.shelfLifeDays, 'shelfLifeDays');

  if (!Array.isArray(input.variants) || input.variants.length < 1 || input.variants.length > 100) {
    throw validationError('variants must contain 1 to 100 SKU definitions.');
  }

  const variants = input.variants.map((variant, index) => ({
    sku: normalizedCode(variant.sku, `variants[${index}].sku`),
    name: requiredText(variant.name, `variants[${index}].name`, 1, 160),
    barcode: optionalText(variant.barcode, `variants[${index}].barcode`, 80),
    packQuantityBase: requiredPositiveInteger(
      variant.packQuantityBase,
      `variants[${index}].packQuantityBase`
    ),
    caseQuantityBase:
      variant.caseQuantityBase === undefined
        ? null
        : requiredPositiveInteger(variant.caseQuantityBase, `variants[${index}].caseQuantityBase`)
  }));

  if (new Set(variants.map((variant) => variant.sku)).size !== variants.length) {
    throw validationError('Each variant SKU must be unique within the product request.');
  }
  const barcodes = variants.flatMap((variant) => (variant.barcode ? [variant.barcode] : []));
  if (new Set(barcodes).size !== barcodes.length) {
    throw validationError('Each barcode must be unique within the product request.');
  }

  const idempotencyKey = requireIdempotencyKey(request);
  const normalizedRequest = {
    code,
    name,
    brandCode,
    brandName,
    categoryCode,
    categoryName,
    unitCode,
    unitName,
    precisionDigits,
    shelfLifeDays,
    variants
  };
  const hash = await requestHash(normalizedRequest);
  const scope = 'master-data.products.create';
  const replay = await readDomainReplay<ProductIdReplay>(
    env.TENANT_DB,
    tenantId,
    scope,
    idempotencyKey,
    hash
  );
  if (replay) {
    return { product: await loadProduct(env.TENANT_DB, tenantId, replay.productId), replayed: true };
  }

  const conflicts = await env.TENANT_DB.prepare(
    `SELECT 'product' AS conflict_type, code AS conflict_value
     FROM products WHERE tenant_id = ?1 AND code = ?2
     UNION ALL
     SELECT 'sku', sku FROM product_variants
     WHERE tenant_id = ?1 AND sku IN (SELECT value FROM json_each(?3))
     UNION ALL
     SELECT 'barcode', barcode FROM product_variants
     WHERE tenant_id = ?1 AND barcode IS NOT NULL
       AND barcode IN (SELECT value FROM json_each(?4))
     LIMIT 1`
  )
    .bind(tenantId, code, JSON.stringify(variants.map((variant) => variant.sku)), JSON.stringify(barcodes))
    .first<{ conflict_type: string; conflict_value: string }>();
  if (conflicts) {
    throw conflictError(
      'master-data-conflict',
      'Product catalog value already exists',
      `${conflicts.conflict_type} ${conflicts.conflict_value} is already in use.`
    );
  }

  const now = new Date().toISOString();
  const unitId = await resolveNamedId(
    env.TENANT_DB,
    'units_of_measure',
    tenantId,
    unitCode,
    `uom_${crypto.randomUUID()}`
  );
  const brandId = await resolveNamedId(
    env.TENANT_DB,
    'product_brands',
    tenantId,
    brandCode,
    `brd_${crypto.randomUUID()}`
  );
  const categoryId = await resolveNamedId(
    env.TENANT_DB,
    'product_categories',
    tenantId,
    categoryCode,
    `cat_${crypto.randomUUID()}`
  );
  const productId = `prd_${crypto.randomUUID()}`;
  const variantRows = variants.map((variant) => ({ ...variant, id: `sku_${crypto.randomUUID()}` }));
  const statements: D1PreparedStatement[] = [];

  if (!(await existsById(env.TENANT_DB, 'units_of_measure', tenantId, unitId))) {
    statements.push(
      env.TENANT_DB.prepare(
        `INSERT INTO units_of_measure (
           id, tenant_id, code, display_name, precision_digits,
           active, created_at, updated_at, version
         ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, 1)`
      ).bind(unitId, tenantId, unitCode, unitName, precisionDigits, now)
    );
  }
  if (!(await existsById(env.TENANT_DB, 'product_brands', tenantId, brandId))) {
    statements.push(
      env.TENANT_DB.prepare(
        `INSERT INTO product_brands (
           id, tenant_id, code, display_name, active, created_at, updated_at, version
         ) VALUES (?1, ?2, ?3, ?4, 1, ?5, ?5, 1)`
      ).bind(brandId, tenantId, brandCode, brandName, now)
    );
  }
  if (!(await existsById(env.TENANT_DB, 'product_categories', tenantId, categoryId))) {
    statements.push(
      env.TENANT_DB.prepare(
        `INSERT INTO product_categories (
           id, tenant_id, code, display_name, parent_category_id,
           active, created_at, updated_at, version
         ) VALUES (?1, ?2, ?3, ?4, NULL, 1, ?5, ?5, 1)`
      ).bind(categoryId, tenantId, categoryCode, categoryName, now)
    );
  }

  statements.push(
    env.TENANT_DB.prepare(
      `INSERT INTO products (
         id, tenant_id, code, display_name, brand_id, category_id,
         base_unit_id, shelf_life_days, active, created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, ?9, 1)`
    ).bind(productId, tenantId, code, name, brandId, categoryId, unitId, shelfLifeDays, now)
  );

  for (const variant of variantRows) {
    statements.push(
      env.TENANT_DB.prepare(
        `INSERT INTO product_variants (
           id, tenant_id, product_id, sku, display_name, barcode,
           base_unit_id, pack_quantity_base, case_quantity_base,
           active, created_at, updated_at, version
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?10, 1)`
      ).bind(
        variant.id,
        tenantId,
        productId,
        variant.sku,
        variant.name,
        variant.barcode,
        unitId,
        variant.packQuantityBase,
        variant.caseQuantityBase,
        now
      )
    );
  }

  statements.push(
    idempotencyStatement(env.TENANT_DB, {
      tenantId,
      scope,
      idempotencyKey,
      requestHash: hash,
      responseStatus: 201,
      responseBody: { productId },
      now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'master-data.product.create',
      resourceType: 'product',
      resourceId: productId,
      metadata: { code, variantCount: variantRows.length },
      now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'master-data.product.created.v1',
      aggregateType: 'product',
      aggregateId: productId,
      aggregateVersion: 1,
      payload: { productId, code, variantIds: variantRows.map((variant) => variant.id) },
      now
    })
  );

  try {
    await env.TENANT_DB.batch(statements);
  } catch (error) {
    const concurrentReplay = await readDomainReplay<ProductIdReplay>(
      env.TENANT_DB,
      tenantId,
      scope,
      idempotencyKey,
      hash
    );
    if (concurrentReplay) {
      return {
        product: await loadProduct(env.TENANT_DB, tenantId, concurrentReplay.productId),
        replayed: true
      };
    }
    throw error;
  }

  return { product: await loadProduct(env.TENANT_DB, tenantId, productId), replayed: false };
}

export async function listWarehouses(
  env: Env,
  request: Request,
  session: ResolvedSession
): Promise<WarehouseListResponse> {
  await requireDomainAccess(
    env,
    request,
    session,
    'master-data',
    'master-data.locations.read',
    'master-data.warehouses.read'
  );
  return { warehouses: await loadWarehouses(env.TENANT_DB, session.response.tenant.id) };
}

export async function createWarehouse(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: CreateWarehouseRequest
): Promise<CreateWarehouseResponse> {
  await requireDomainAccess(
    env,
    request,
    session,
    'master-data',
    'master-data.locations.manage',
    'master-data.warehouse.create'
  );
  const tenantId = session.response.tenant.id;
  const legalEntityCode = normalizedCode(input.legalEntityCode, 'legalEntityCode');
  const legalEntityName = requiredText(input.legalEntityName, 'legalEntityName', 2, 160);
  const siteCode = normalizedCode(input.siteCode, 'siteCode');
  const siteName = requiredText(input.siteName, 'siteName', 2, 160);
  const warehouseCode = normalizedCode(input.warehouseCode, 'warehouseCode');
  const warehouseName = requiredText(input.warehouseName, 'warehouseName', 2, 160);
  const timezone = validateTimezone(requiredText(input.timezone, 'timezone', 3, 80));
  const defaultZoneCode = normalizedCode(input.defaultZoneCode ?? 'GENERAL', 'defaultZoneCode');
  const defaultBinCode = normalizedCode(input.defaultBinCode ?? 'RECEIVING', 'defaultBinCode');
  const localeCountry = session.response.tenant.defaultLocale.split('-').at(-1)?.toUpperCase() ?? 'NL';
  const entityCountry = /^[A-Z]{2}$/.test(localeCountry) ? localeCountry : 'NL';

  const normalizedRequest = {
    legalEntityCode,
    legalEntityName,
    siteCode,
    siteName,
    warehouseCode,
    warehouseName,
    timezone,
    defaultZoneCode,
    defaultBinCode
  };
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash(normalizedRequest);
  const scope = 'master-data.warehouses.create';
  const replay = await readDomainReplay<WarehouseIdReplay>(
    env.TENANT_DB,
    tenantId,
    scope,
    idempotencyKey,
    hash
  );
  if (replay) {
    return { warehouse: await loadWarehouse(env.TENANT_DB, tenantId, replay.warehouseId), replayed: true };
  }

  const duplicate = await env.TENANT_DB.prepare(
    `SELECT id FROM warehouses WHERE tenant_id = ?1 AND code = ?2`
  )
    .bind(tenantId, warehouseCode)
    .first<NamedIdRow>();
  if (duplicate) throw conflictError('warehouse-code-conflict', 'Warehouse code already exists');

  const now = new Date().toISOString();
  const legalEntityId = await resolveNamedId(
    env.TENANT_DB,
    'legal_entities',
    tenantId,
    legalEntityCode,
    `len_${crypto.randomUUID()}`
  );
  const siteId = await resolveNamedId(env.TENANT_DB, 'sites', tenantId, siteCode, `sit_${crypto.randomUUID()}`);
  const warehouseId = `whs_${crypto.randomUUID()}`;
  const zoneId = `zon_${crypto.randomUUID()}`;
  const binId = `bin_${crypto.randomUUID()}`;
  const statements: D1PreparedStatement[] = [];

  if (!(await existsById(env.TENANT_DB, 'legal_entities', tenantId, legalEntityId))) {
    statements.push(
      env.TENANT_DB.prepare(
        `INSERT INTO legal_entities (
           id, tenant_id, code, display_name, country_code,
           active, created_at, updated_at, version
         ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, 1)`
      ).bind(legalEntityId, tenantId, legalEntityCode, legalEntityName, countryCode(entityCountry), now)
    );
  }
  if (!(await existsById(env.TENANT_DB, 'sites', tenantId, siteId))) {
    statements.push(
      env.TENANT_DB.prepare(
        `INSERT INTO sites (
           id, tenant_id, legal_entity_id, code, display_name, timezone,
           active, created_at, updated_at, version
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7, 1)`
      ).bind(siteId, tenantId, legalEntityId, siteCode, siteName, timezone, now)
    );
  }
  statements.push(
    env.TENANT_DB.prepare(
      `INSERT INTO warehouses (
         id, tenant_id, site_id, code, display_name,
         active, created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6, 1)`
    ).bind(warehouseId, tenantId, siteId, warehouseCode, warehouseName, now),
    env.TENANT_DB.prepare(
      `INSERT INTO warehouse_zones (
         id, tenant_id, warehouse_id, code, display_name,
         is_default, active, created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, ?4, 'General storage', 1, 1, ?5, ?5, 1)`
    ).bind(zoneId, tenantId, warehouseId, defaultZoneCode, now),
    env.TENANT_DB.prepare(
      `INSERT INTO warehouse_bins (
         id, tenant_id, warehouse_id, zone_id, code, display_name,
         is_default, active, created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, ?4, ?5, 'Default receiving bin', 1, 1, ?6, ?6, 1)`
    ).bind(binId, tenantId, warehouseId, zoneId, defaultBinCode, now),
    idempotencyStatement(env.TENANT_DB, {
      tenantId,
      scope,
      idempotencyKey,
      requestHash: hash,
      responseStatus: 201,
      responseBody: { warehouseId },
      now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'master-data.warehouse.create',
      resourceType: 'warehouse',
      resourceId: warehouseId,
      metadata: { warehouseCode, siteCode, legalEntityCode },
      now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'master-data.warehouse.created.v1',
      aggregateType: 'warehouse',
      aggregateId: warehouseId,
      aggregateVersion: 1,
      payload: { warehouseId, warehouseCode, siteId, defaultBinId: binId },
      now
    })
  );

  try {
    await env.TENANT_DB.batch(statements);
  } catch (error) {
    const concurrentReplay = await readDomainReplay<WarehouseIdReplay>(
      env.TENANT_DB,
      tenantId,
      scope,
      idempotencyKey,
      hash
    );
    if (concurrentReplay) {
      return {
        warehouse: await loadWarehouse(env.TENANT_DB, tenantId, concurrentReplay.warehouseId),
        replayed: true
      };
    }
    throw error;
  }

  return { warehouse: await loadWarehouse(env.TENANT_DB, tenantId, warehouseId), replayed: false };
}

export async function listParties(
  env: Env,
  request: Request,
  session: ResolvedSession
): Promise<PartyListResponse> {
  await requireDomainAccess(
    env,
    request,
    session,
    'master-data',
    'master-data.parties.read',
    'master-data.parties.read'
  );
  const rows = await env.TENANT_DB.prepare(
    `SELECT id, code, display_name, party_type, country_code,
            tax_id, email, phone, active, created_at, updated_at, version
     FROM business_parties
     WHERE tenant_id = ?1
     ORDER BY party_type, display_name, code`
  )
    .bind(session.response.tenant.id)
    .all<PartyRow>();
  return { parties: rows.results.map(toPartySummary) };
}

export async function createParty(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: CreatePartyRequest
): Promise<CreatePartyResponse> {
  await requireDomainAccess(
    env,
    request,
    session,
    'master-data',
    'master-data.parties.manage',
    'master-data.party.create'
  );
  const tenantId = session.response.tenant.id;
  const code = normalizedCode(input.code, 'code');
  const name = requiredText(input.name, 'name', 2, 160);
  if (!PARTY_TYPES.has(input.type)) throw validationError('type must be supplier, customer, distributor or retailer.');
  const type = input.type;
  const country = countryCode(input.countryCode);
  const taxId = optionalText(input.taxId, 'taxId', 80);
  const email = optionalEmail(input.email, 'email');
  const phone = optionalText(input.phone, 'phone', 40);
  const normalizedRequest = { code, name, type, country, taxId, email, phone };
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash(normalizedRequest);
  const scope = 'master-data.parties.create';
  const replay = await readDomainReplay<PartyIdReplay>(
    env.TENANT_DB,
    tenantId,
    scope,
    idempotencyKey,
    hash
  );
  if (replay) return { party: await loadParty(env.TENANT_DB, tenantId, replay.partyId), replayed: true };

  const duplicate = await env.TENANT_DB.prepare(
    'SELECT id FROM business_parties WHERE tenant_id = ?1 AND code = ?2'
  )
    .bind(tenantId, code)
    .first<NamedIdRow>();
  if (duplicate) throw conflictError('party-code-conflict', 'Party code already exists');

  const now = new Date().toISOString();
  const partyId = `pty_${crypto.randomUUID()}`;
  const statements = [
    env.TENANT_DB.prepare(
      `INSERT INTO business_parties (
         id, tenant_id, code, display_name, party_type, country_code,
         tax_id, email, phone, active, created_at, updated_at, version
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 1, ?10, ?10, 1)`
    ).bind(partyId, tenantId, code, name, type, country, taxId, email, phone, now),
    idempotencyStatement(env.TENANT_DB, {
      tenantId,
      scope,
      idempotencyKey,
      requestHash: hash,
      responseStatus: 201,
      responseBody: { partyId },
      now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'master-data.party.create',
      resourceType: 'business-party',
      resourceId: partyId,
      metadata: { code, type, countryCode: country },
      now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'master-data.party.created.v1',
      aggregateType: 'business-party',
      aggregateId: partyId,
      aggregateVersion: 1,
      payload: { partyId, code, type, countryCode: country },
      now
    })
  ];

  try {
    await env.TENANT_DB.batch(statements);
  } catch (error) {
    const concurrentReplay = await readDomainReplay<PartyIdReplay>(
      env.TENANT_DB,
      tenantId,
      scope,
      idempotencyKey,
      hash
    );
    if (concurrentReplay) {
      return { party: await loadParty(env.TENANT_DB, tenantId, concurrentReplay.partyId), replayed: true };
    }
    throw error;
  }

  return { party: await loadParty(env.TENANT_DB, tenantId, partyId), replayed: false };
}

export async function loadProduct(
  db: D1Database,
  tenantId: string,
  productId: string
): Promise<ProductSummary> {
  const row = await db.prepare(
    `SELECT
       p.id, p.code, p.display_name,
       b.display_name AS brand_name,
       c.display_name AS category_name,
       u.code AS base_unit_code,
       p.shelf_life_days, p.active, p.created_at, p.updated_at, p.version
     FROM products p
     JOIN product_brands b ON b.tenant_id = p.tenant_id AND b.id = p.brand_id
     JOIN product_categories c ON c.tenant_id = p.tenant_id AND c.id = p.category_id
     JOIN units_of_measure u ON u.tenant_id = p.tenant_id AND u.id = p.base_unit_id
     WHERE p.tenant_id = ?1 AND p.id = ?2`
  )
    .bind(tenantId, productId)
    .first<ProductRow>();
  if (!row) throw conflictError('product-not-found', 'Product was not found');
  const variants = await db.prepare(
    `SELECT v.id, v.product_id, v.sku, v.display_name, v.barcode,
            u.code AS base_unit_code, v.pack_quantity_base,
            v.case_quantity_base, v.active, v.version
     FROM product_variants v
     JOIN units_of_measure u ON u.tenant_id = v.tenant_id AND u.id = v.base_unit_id
     WHERE v.tenant_id = ?1 AND v.product_id = ?2
     ORDER BY v.sku, v.id`
  )
    .bind(tenantId, productId)
    .all<VariantRow>();
  return toProductSummary(row, variants.results.map(toVariantSummary));
}

export async function loadWarehouse(
  db: D1Database,
  tenantId: string,
  warehouseId: string
): Promise<WarehouseSummary> {
  const rows = await loadWarehouses(db, tenantId, warehouseId);
  const warehouse = rows[0];
  if (!warehouse) throw conflictError('warehouse-not-found', 'Warehouse was not found');
  return warehouse;
}

async function loadWarehouses(
  db: D1Database,
  tenantId: string,
  warehouseId?: string
): Promise<WarehouseSummary[]> {
  const rows = await db.prepare(
    `SELECT
       w.id, w.code, w.display_name,
       s.code AS site_code, s.display_name AS site_name,
       le.code AS legal_entity_code, s.timezone, w.active,
       z.id AS default_zone_id, b.id AS default_bin_id,
       w.created_at, w.updated_at, w.version
     FROM warehouses w
     JOIN sites s ON s.tenant_id = w.tenant_id AND s.id = w.site_id
     JOIN legal_entities le ON le.tenant_id = s.tenant_id AND le.id = s.legal_entity_id
     JOIN warehouse_zones z ON z.tenant_id = w.tenant_id AND z.warehouse_id = w.id AND z.is_default = 1
     JOIN warehouse_bins b ON b.tenant_id = w.tenant_id AND b.warehouse_id = w.id AND b.is_default = 1
     WHERE w.tenant_id = ?1 AND (?2 IS NULL OR w.id = ?2)
     ORDER BY w.display_name, w.code`
  )
    .bind(tenantId, warehouseId ?? null)
    .all<WarehouseRow>();
  return rows.results.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.display_name,
    siteCode: row.site_code,
    siteName: row.site_name,
    legalEntityCode: row.legal_entity_code,
    timezone: row.timezone,
    active: row.active === 1,
    defaultZoneId: row.default_zone_id,
    defaultBinId: row.default_bin_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version
  }));
}

async function loadParty(db: D1Database, tenantId: string, partyId: string): Promise<PartySummary> {
  const row = await db.prepare(
    `SELECT id, code, display_name, party_type, country_code,
            tax_id, email, phone, active, created_at, updated_at, version
     FROM business_parties WHERE tenant_id = ?1 AND id = ?2`
  )
    .bind(tenantId, partyId)
    .first<PartyRow>();
  if (!row) throw conflictError('party-not-found', 'Business party was not found');
  return toPartySummary(row);
}

async function resolveNamedId(
  db: D1Database,
  table: 'units_of_measure' | 'product_brands' | 'product_categories' | 'legal_entities' | 'sites',
  tenantId: string,
  code: string,
  fallbackId: string
): Promise<string> {
  const row = await db.prepare(`SELECT id FROM ${table} WHERE tenant_id = ?1 AND code = ?2`)
    .bind(tenantId, code)
    .first<NamedIdRow>();
  return row?.id ?? fallbackId;
}

async function existsById(
  db: D1Database,
  table: 'units_of_measure' | 'product_brands' | 'product_categories' | 'legal_entities' | 'sites',
  tenantId: string,
  id: string
): Promise<boolean> {
  const row = await db.prepare(`SELECT id FROM ${table} WHERE tenant_id = ?1 AND id = ?2`)
    .bind(tenantId, id)
    .first<NamedIdRow>();
  return Boolean(row);
}

function toProductSummary(row: ProductRow, variants: ProductVariantSummary[]): ProductSummary {
  return {
    id: row.id,
    code: row.code,
    name: row.display_name,
    brand: row.brand_name,
    category: row.category_name,
    baseUnitCode: row.base_unit_code,
    shelfLifeDays: row.shelf_life_days,
    active: row.active === 1,
    variants,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version
  };
}

function toVariantSummary(row: VariantRow): ProductVariantSummary {
  return {
    id: row.id,
    productId: row.product_id,
    sku: row.sku,
    name: row.display_name,
    barcode: row.barcode,
    baseUnitCode: row.base_unit_code,
    packQuantityBase: row.pack_quantity_base,
    caseQuantityBase: row.case_quantity_base,
    active: row.active === 1,
    version: row.version
  };
}

function toPartySummary(row: PartyRow): PartySummary {
  return {
    id: row.id,
    code: row.code,
    name: row.display_name,
    type: row.party_type,
    countryCode: row.country_code,
    taxId: row.tax_id,
    email: row.email,
    phone: row.phone,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version
  };
}

function toBusinessCode(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return normalized || 'GENERAL';
}
