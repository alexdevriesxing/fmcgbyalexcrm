import type {
  AdjustStockRequest,
  ChangeInventoryStatusRequest,
  FefoCandidate,
  FefoResponse,
  InventoryAgingBucket,
  InventoryAgingResponse,
  InventoryBalanceSummary,
  InventoryCommandResponse,
  InventoryLotSummary,
  InventoryMovementSummary,
  InventoryMovementType,
  InventoryOverviewResponse,
  InventorySettingsResponse,
  InventoryStatus,
  ReceiveStockRequest,
  ReverseInventoryMovementRequest,
  TransferStockRequest,
  UpdateInventorySettingsRequest,
  UpdateInventorySettingsResponse
} from '@fmcgbyalex/contracts/inventory';
import type { ResolvedSession } from './platform';
import {
  conflictError,
  domainAuditStatement,
  domainOutboxStatement,
  idempotencyStatement,
  notFoundError,
  optionalDate,
  optionalText,
  readDomainReplay,
  requestHash,
  requireDomainAccess,
  requireIdempotencyKey,
  requiredId,
  requiredNonZeroInteger,
  requiredPositiveInteger,
  requiredText,
  validationError
} from './domain-support';

const INVENTORY_STATUSES = new Set<InventoryStatus>([
  'available',
  'quarantine',
  'damaged',
  'blocked'
]);
const DEFAULT_AGING_BUCKETS = [30, 60, 90, 180];
const MAX_RESULTS = 250;

type CommandReplay = { movementIds: string[] };
type SettingsReplay = { version: number };

type VariantDimensionRow = {
  id: string;
  sku: string;
  variant_name: string;
  product_name: string;
  base_unit_code: string;
  active: number;
};

type WarehouseDimensionRow = {
  id: string;
  code: string;
  display_name: string;
  active: number;
  default_bin_id: string;
};

type BinDimensionRow = {
  id: string;
  code: string;
  display_name: string;
  warehouse_id: string;
  active: number;
};

type LotRow = {
  id: string;
  variant_id: string;
  lot_code: string;
  manufactured_on: string | null;
  expires_on: string | null;
  supplier_party_id: string | null;
  created_at: string;
};

type BalanceRow = {
  variant_id: string;
  sku: string;
  product_name: string;
  variant_name: string;
  base_unit_code: string;
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  bin_id: string;
  bin_code: string;
  lot_id: string;
  lot_code: string;
  manufactured_on: string | null;
  expires_on: string | null;
  supplier_party_id: string | null;
  lot_created_at: string;
  inventory_status: InventoryStatus;
  quantity_base: number;
  version: number;
  updated_at: string;
};

type MovementRow = {
  id: string;
  movement_type: InventoryMovementType;
  reference_type: string;
  reference_id: string;
  variant_id: string;
  sku: string;
  warehouse_id: string;
  warehouse_code: string;
  bin_id: string;
  bin_code: string;
  lot_id: string;
  lot_code: string;
  inventory_status: InventoryStatus;
  quantity_delta_base: number;
  resulting_quantity_base: number;
  reversal_of_movement_id: string | null;
  actor_user_id: string;
  occurred_at: string;
};

type OriginalMovementRow = MovementRow & {
  transfer_group_id: string | null;
  reason: string | null;
};

type SettingsRow = {
  aging_buckets_json: string;
  updated_at: string;
  version: number;
};

type TotalRow = {
  quantity_base: number | null;
  available_base: number | null;
  quarantine_base: number | null;
  near_expiry_base: number | null;
  expired_base: number | null;
  sku_count: number;
  lot_count: number;
};

export async function getInventoryOverview(
  env: Env,
  request: Request,
  session: ResolvedSession
): Promise<InventoryOverviewResponse> {
  await requireInventoryRead(env, request, session, 'inventory.overview.read');
  const tenantId = session.response.tenant.id;
  const today = todayUtc();
  const nearExpiry = addDays(today, 60);

  const [total, balanceRows, movementRows] = await Promise.all([
    env.TENANT_DB.prepare(
      `SELECT
         COALESCE(SUM(b.quantity_base), 0) AS quantity_base,
         COALESCE(SUM(CASE WHEN b.inventory_status = 'available' THEN b.quantity_base ELSE 0 END), 0) AS available_base,
         COALESCE(SUM(CASE WHEN b.inventory_status = 'quarantine' THEN b.quantity_base ELSE 0 END), 0) AS quarantine_base,
         COALESCE(SUM(CASE WHEN l.expires_on IS NOT NULL AND l.expires_on >= ?2 AND l.expires_on <= ?3 THEN b.quantity_base ELSE 0 END), 0) AS near_expiry_base,
         COALESCE(SUM(CASE WHEN l.expires_on IS NOT NULL AND l.expires_on < ?2 THEN b.quantity_base ELSE 0 END), 0) AS expired_base,
         COUNT(DISTINCT CASE WHEN b.quantity_base > 0 THEN b.variant_id END) AS sku_count,
         COUNT(DISTINCT CASE WHEN b.quantity_base > 0 THEN b.lot_id END) AS lot_count
       FROM inventory_balances b
       JOIN inventory_lots l ON l.tenant_id = b.tenant_id AND l.id = b.lot_id
       WHERE b.tenant_id = ?1`
    )
      .bind(tenantId, today, nearExpiry)
      .first<TotalRow>(),
    loadBalanceRows(env.TENANT_DB, tenantId, undefined, undefined, MAX_RESULTS),
    loadMovementRows(env.TENANT_DB, tenantId, undefined, 30)
  ]);

  return {
    totals: {
      quantityBase: total?.quantity_base ?? 0,
      availableBase: total?.available_base ?? 0,
      quarantineBase: total?.quarantine_base ?? 0,
      nearExpiryBase: total?.near_expiry_base ?? 0,
      expiredBase: total?.expired_base ?? 0,
      skuCount: total?.sku_count ?? 0,
      lotCount: total?.lot_count ?? 0
    },
    balances: balanceRows.map(toBalanceSummary),
    recentMovements: movementRows.map(toMovementSummary)
  };
}

export async function getInventoryBalances(
  env: Env,
  request: Request,
  session: ResolvedSession,
  filters: { warehouseId?: string; variantId?: string }
): Promise<{ balances: InventoryBalanceSummary[] }> {
  await requireInventoryRead(env, request, session, 'inventory.balances.read');
  const warehouseId = filters.warehouseId ? requiredId(filters.warehouseId, 'warehouseId') : undefined;
  const variantId = filters.variantId ? requiredId(filters.variantId, 'variantId') : undefined;
  return {
    balances: (
      await loadBalanceRows(
        env.TENANT_DB,
        session.response.tenant.id,
        warehouseId,
        variantId,
        MAX_RESULTS
      )
    ).map(toBalanceSummary)
  };
}

export async function receiveStock(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: ReceiveStockRequest
): Promise<InventoryCommandResponse> {
  await requireDomainAccess(
    env,
    request,
    session,
    'inventory',
    'inventory.stock.receive',
    'inventory.stock.receive'
  );
  const tenantId = session.response.tenant.id;
  const variantId = requiredId(input.variantId, 'variantId');
  const warehouseId = requiredId(input.warehouseId, 'warehouseId');
  const quantityBase = requiredPositiveInteger(input.quantityBase, 'quantityBase');
  const lotCode = requiredText(input.lotCode, 'lotCode', 1, 100).toUpperCase();
  const manufacturedOn = optionalDate(input.manufacturedOn, 'manufacturedOn');
  const expiresOn = optionalDate(input.expiresOn, 'expiresOn');
  if (manufacturedOn && expiresOn && manufacturedOn > expiresOn) {
    throw validationError('manufacturedOn cannot be later than expiresOn.');
  }
  const supplierPartyId = input.supplierPartyId
    ? requiredId(input.supplierPartyId, 'supplierPartyId')
    : null;
  const referenceType = requiredText(input.referenceType, 'referenceType', 2, 80);
  const referenceId = requiredText(input.referenceId, 'referenceId', 2, 160);
  const dimensions = await resolveDimensions(
    env.TENANT_DB,
    tenantId,
    variantId,
    warehouseId,
    input.binId
  );
  if (supplierPartyId) await requireSupplier(env.TENANT_DB, tenantId, supplierPartyId);

  const existingLot = await env.TENANT_DB.prepare(
    `SELECT id, variant_id, lot_code, manufactured_on, expires_on,
            supplier_party_id, created_at
     FROM inventory_lots
     WHERE tenant_id = ?1 AND variant_id = ?2 AND lot_code = ?3`
  )
    .bind(tenantId, variantId, lotCode)
    .first<LotRow>();
  if (
    existingLot &&
    (existingLot.manufactured_on !== manufacturedOn ||
      existingLot.expires_on !== expiresOn ||
      existingLot.supplier_party_id !== supplierPartyId)
  ) {
    throw conflictError(
      'lot-attribute-conflict',
      'Lot already exists with different traceability attributes'
    );
  }
  const lotId = existingLot?.id ?? `lot_${crypto.randomUUID()}`;
  const movementId = `mov_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const scope = 'inventory.receive';
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash({
    variantId,
    warehouseId,
    binId: dimensions.bin.id,
    lotCode,
    manufacturedOn,
    expiresOn,
    supplierPartyId,
    quantityBase,
    referenceType,
    referenceId
  });
  const replay = await readDomainReplay<CommandReplay>(
    env.TENANT_DB,
    tenantId,
    scope,
    idempotencyKey,
    hash
  );
  if (replay) return loadCommandResponse(env.TENANT_DB, tenantId, replay.movementIds, true);

  const statements: D1PreparedStatement[] = [];
  if (!existingLot) {
    statements.push(
      env.TENANT_DB.prepare(
        `INSERT INTO inventory_lots (
           id, tenant_id, variant_id, lot_code, manufactured_on,
           expires_on, supplier_party_id, created_at, updated_at, version
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 1)`
      ).bind(
        lotId,
        tenantId,
        variantId,
        lotCode,
        manufacturedOn,
        expiresOn,
        supplierPartyId,
        now
      )
    );
  }
  statements.push(
    balanceDeltaStatement(env.TENANT_DB, {
      tenantId,
      variantId,
      warehouseId,
      binId: dimensions.bin.id,
      lotId,
      status: 'available',
      delta: quantityBase,
      now
    }),
    movementStatement(env.TENANT_DB, session, {
      movementId,
      movementType: 'receive',
      referenceType,
      referenceId,
      variantId,
      warehouseId,
      binId: dimensions.bin.id,
      lotId,
      status: 'available',
      delta: quantityBase,
      reason: null,
      reversalOfMovementId: null,
      transferGroupId: null,
      now
    }),
    idempotencyStatement(env.TENANT_DB, {
      tenantId,
      scope,
      idempotencyKey,
      requestHash: hash,
      responseStatus: 201,
      responseBody: { movementIds: [movementId] },
      now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'inventory.stock.receive',
      resourceType: 'inventory-movement',
      resourceId: movementId,
      metadata: { variantId, warehouseId, lotId, quantityBase, referenceType, referenceId },
      now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'inventory.stock.received.v1',
      aggregateType: 'inventory-lot',
      aggregateId: lotId,
      aggregateVersion: 1,
      payload: { movementId, variantId, warehouseId, binId: dimensions.bin.id, lotId, quantityBase },
      now
    })
  );

  await runInventoryBatch(env.TENANT_DB, tenantId, scope, idempotencyKey, hash, statements);
  return loadCommandResponse(env.TENANT_DB, tenantId, [movementId], false);
}

export async function adjustStock(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: AdjustStockRequest
): Promise<InventoryCommandResponse> {
  await requireDomainAccess(
    env,
    request,
    session,
    'inventory',
    'inventory.stock.adjust',
    'inventory.stock.adjust'
  );
  const tenantId = session.response.tenant.id;
  const variantId = requiredId(input.variantId, 'variantId');
  const warehouseId = requiredId(input.warehouseId, 'warehouseId');
  const lotId = requiredId(input.lotId, 'lotId');
  const status = inventoryStatus(input.status);
  const delta = requiredNonZeroInteger(input.quantityDeltaBase, 'quantityDeltaBase');
  const reason = requiredText(input.reason, 'reason', 3, 500);
  const referenceId = requiredText(input.referenceId, 'referenceId', 2, 160);
  const dimensions = await resolveDimensions(
    env.TENANT_DB,
    tenantId,
    variantId,
    warehouseId,
    input.binId
  );
  await requireLot(env.TENANT_DB, tenantId, lotId, variantId);
  if (delta < 0) {
    await requireSufficientStock(
      env.TENANT_DB,
      tenantId,
      variantId,
      warehouseId,
      dimensions.bin.id,
      lotId,
      status,
      Math.abs(delta)
    );
  }

  const movementId = `mov_${crypto.randomUUID()}`;
  const movementType: InventoryMovementType = delta > 0 ? 'adjust-in' : 'adjust-out';
  const now = new Date().toISOString();
  const scope = 'inventory.adjust';
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash({
    variantId,
    warehouseId,
    binId: dimensions.bin.id,
    lotId,
    status,
    delta,
    reason,
    referenceId
  });
  const replay = await readDomainReplay<CommandReplay>(
    env.TENANT_DB,
    tenantId,
    scope,
    idempotencyKey,
    hash
  );
  if (replay) return loadCommandResponse(env.TENANT_DB, tenantId, replay.movementIds, true);

  const statements = [
    balanceDeltaStatement(env.TENANT_DB, {
      tenantId,
      variantId,
      warehouseId,
      binId: dimensions.bin.id,
      lotId,
      status,
      delta,
      now
    }),
    movementStatement(env.TENANT_DB, session, {
      movementId,
      movementType,
      referenceType: 'inventory-adjustment',
      referenceId,
      variantId,
      warehouseId,
      binId: dimensions.bin.id,
      lotId,
      status,
      delta,
      reason,
      reversalOfMovementId: null,
      transferGroupId: null,
      now
    }),
    idempotencyStatement(env.TENANT_DB, {
      tenantId,
      scope,
      idempotencyKey,
      requestHash: hash,
      responseStatus: 201,
      responseBody: { movementIds: [movementId] },
      now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'inventory.stock.adjust',
      resourceType: 'inventory-movement',
      resourceId: movementId,
      metadata: { variantId, warehouseId, lotId, status, delta, reason },
      now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'inventory.stock.adjusted.v1',
      aggregateType: 'inventory-balance',
      aggregateId: `${variantId}:${warehouseId}:${dimensions.bin.id}:${lotId}:${status}`,
      aggregateVersion: 1,
      payload: { movementId, variantId, warehouseId, binId: dimensions.bin.id, lotId, status, delta },
      now
    })
  ];

  await runInventoryBatch(env.TENANT_DB, tenantId, scope, idempotencyKey, hash, statements);
  return loadCommandResponse(env.TENANT_DB, tenantId, [movementId], false);
}

export async function transferStock(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: TransferStockRequest
): Promise<InventoryCommandResponse> {
  await requireDomainAccess(
    env,
    request,
    session,
    'inventory',
    'inventory.stock.transfer',
    'inventory.stock.transfer'
  );
  const tenantId = session.response.tenant.id;
  const variantId = requiredId(input.variantId, 'variantId');
  const sourceWarehouseId = requiredId(input.sourceWarehouseId, 'sourceWarehouseId');
  const destinationWarehouseId = requiredId(input.destinationWarehouseId, 'destinationWarehouseId');
  const lotId = requiredId(input.lotId, 'lotId');
  const status = inventoryStatus(input.status);
  const quantityBase = requiredPositiveInteger(input.quantityBase, 'quantityBase');
  const referenceId = requiredText(input.referenceId, 'referenceId', 2, 160);
  const source = await resolveDimensions(
    env.TENANT_DB,
    tenantId,
    variantId,
    sourceWarehouseId,
    input.sourceBinId
  );
  const destination = await resolveDimensions(
    env.TENANT_DB,
    tenantId,
    variantId,
    destinationWarehouseId,
    input.destinationBinId
  );
  if (source.bin.id === destination.bin.id) {
    throw validationError('Source and destination bins must be different.');
  }
  await requireLot(env.TENANT_DB, tenantId, lotId, variantId);
  await requireSufficientStock(
    env.TENANT_DB,
    tenantId,
    variantId,
    sourceWarehouseId,
    source.bin.id,
    lotId,
    status,
    quantityBase
  );

  const transferGroupId = `trn_${crypto.randomUUID()}`;
  const outMovementId = `mov_${crypto.randomUUID()}`;
  const inMovementId = `mov_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const scope = 'inventory.transfer';
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash({
    variantId,
    sourceWarehouseId,
    sourceBinId: source.bin.id,
    destinationWarehouseId,
    destinationBinId: destination.bin.id,
    lotId,
    status,
    quantityBase,
    referenceId
  });
  const replay = await readDomainReplay<CommandReplay>(
    env.TENANT_DB,
    tenantId,
    scope,
    idempotencyKey,
    hash
  );
  if (replay) return loadCommandResponse(env.TENANT_DB, tenantId, replay.movementIds, true);

  const statements = [
    balanceDeltaStatement(env.TENANT_DB, {
      tenantId,
      variantId,
      warehouseId: sourceWarehouseId,
      binId: source.bin.id,
      lotId,
      status,
      delta: -quantityBase,
      now
    }),
    movementStatement(env.TENANT_DB, session, {
      movementId: outMovementId,
      movementType: 'transfer-out',
      referenceType: 'inventory-transfer',
      referenceId,
      variantId,
      warehouseId: sourceWarehouseId,
      binId: source.bin.id,
      lotId,
      status,
      delta: -quantityBase,
      reason: null,
      reversalOfMovementId: null,
      transferGroupId,
      now
    }),
    balanceDeltaStatement(env.TENANT_DB, {
      tenantId,
      variantId,
      warehouseId: destinationWarehouseId,
      binId: destination.bin.id,
      lotId,
      status,
      delta: quantityBase,
      now
    }),
    movementStatement(env.TENANT_DB, session, {
      movementId: inMovementId,
      movementType: 'transfer-in',
      referenceType: 'inventory-transfer',
      referenceId,
      variantId,
      warehouseId: destinationWarehouseId,
      binId: destination.bin.id,
      lotId,
      status,
      delta: quantityBase,
      reason: null,
      reversalOfMovementId: null,
      transferGroupId,
      now
    }),
    idempotencyStatement(env.TENANT_DB, {
      tenantId,
      scope,
      idempotencyKey,
      requestHash: hash,
      responseStatus: 201,
      responseBody: { movementIds: [outMovementId, inMovementId] },
      now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'inventory.stock.transfer',
      resourceType: 'inventory-transfer',
      resourceId: transferGroupId,
      metadata: {
        variantId,
        sourceWarehouseId,
        destinationWarehouseId,
        lotId,
        status,
        quantityBase
      },
      now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'inventory.stock.transferred.v1',
      aggregateType: 'inventory-transfer',
      aggregateId: transferGroupId,
      aggregateVersion: 1,
      payload: {
        transferGroupId,
        outMovementId,
        inMovementId,
        variantId,
        sourceWarehouseId,
        destinationWarehouseId,
        lotId,
        status,
        quantityBase
      },
      now
    })
  ];

  await runInventoryBatch(env.TENANT_DB, tenantId, scope, idempotencyKey, hash, statements);
  return loadCommandResponse(env.TENANT_DB, tenantId, [outMovementId, inMovementId], false);
}

export async function quarantineStock(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: ChangeInventoryStatusRequest
): Promise<InventoryCommandResponse> {
  return moveStockStatus(env, request, session, input, 'available', 'quarantine', 'quarantine');
}

export async function releaseStock(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: ChangeInventoryStatusRequest
): Promise<InventoryCommandResponse> {
  return moveStockStatus(env, request, session, input, 'quarantine', 'available', 'release');
}

export async function reverseInventoryMovement(
  env: Env,
  request: Request,
  session: ResolvedSession,
  movementIdInput: string,
  input: ReverseInventoryMovementRequest
): Promise<InventoryCommandResponse> {
  await requireDomainAccess(
    env,
    request,
    session,
    'inventory',
    'inventory.stock.adjust',
    'inventory.movement.reverse'
  );
  const tenantId = session.response.tenant.id;
  const movementId = requiredId(movementIdInput, 'movementId');
  const reason = requiredText(input.reason, 'reason', 3, 500);
  const referenceId = requiredText(input.referenceId, 'referenceId', 2, 160);
  const original = await loadOriginalMovement(env.TENANT_DB, tenantId, movementId);
  if (original.transfer_group_id || original.movement_type.includes('transfer')) {
    throw conflictError(
      'transfer-reversal-requires-paired-command',
      'Transfer movements cannot be reversed individually'
    );
  }
  if (
    original.movement_type === 'quarantine-in' ||
    original.movement_type === 'quarantine-out' ||
    original.movement_type === 'release-in' ||
    original.movement_type === 'release-out'
  ) {
    throw conflictError(
      'status-reversal-requires-paired-command',
      'Inventory status movements cannot be reversed individually'
    );
  }
  if (original.movement_type === 'reversal') {
    throw conflictError('reversal-of-reversal-not-allowed', 'A reversal cannot be reversed again');
  }
  const alreadyReversed = await env.TENANT_DB.prepare(
    `SELECT id FROM inventory_movements
     WHERE tenant_id = ?1 AND reversal_of_movement_id = ?2`
  )
    .bind(tenantId, movementId)
    .first<{ id: string }>();
  if (alreadyReversed) {
    throw conflictError('movement-already-reversed', 'Inventory movement was already reversed');
  }

  const delta = -original.quantity_delta_base;
  if (delta < 0) {
    await requireSufficientStock(
      env.TENANT_DB,
      tenantId,
      original.variant_id,
      original.warehouse_id,
      original.bin_id,
      original.lot_id,
      original.inventory_status,
      Math.abs(delta)
    );
  }
  const reversalId = `mov_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const scope = `inventory.reverse:${movementId}`;
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash({ movementId, reason, referenceId });
  const replay = await readDomainReplay<CommandReplay>(
    env.TENANT_DB,
    tenantId,
    scope,
    idempotencyKey,
    hash
  );
  if (replay) return loadCommandResponse(env.TENANT_DB, tenantId, replay.movementIds, true);

  const statements = [
    balanceDeltaStatement(env.TENANT_DB, {
      tenantId,
      variantId: original.variant_id,
      warehouseId: original.warehouse_id,
      binId: original.bin_id,
      lotId: original.lot_id,
      status: original.inventory_status,
      delta,
      now
    }),
    movementStatement(env.TENANT_DB, session, {
      movementId: reversalId,
      movementType: 'reversal',
      referenceType: 'inventory-reversal',
      referenceId,
      variantId: original.variant_id,
      warehouseId: original.warehouse_id,
      binId: original.bin_id,
      lotId: original.lot_id,
      status: original.inventory_status,
      delta,
      reason,
      reversalOfMovementId: movementId,
      transferGroupId: null,
      now
    }),
    idempotencyStatement(env.TENANT_DB, {
      tenantId,
      scope,
      idempotencyKey,
      requestHash: hash,
      responseStatus: 201,
      responseBody: { movementIds: [reversalId] },
      now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'inventory.movement.reverse',
      resourceType: 'inventory-movement',
      resourceId: reversalId,
      metadata: { reversalOfMovementId: movementId, reason, delta },
      now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'inventory.movement.reversed.v1',
      aggregateType: 'inventory-movement',
      aggregateId: reversalId,
      aggregateVersion: 1,
      payload: { reversalId, reversalOfMovementId: movementId, delta },
      now,
      causationId: movementId
    })
  ];

  await runInventoryBatch(env.TENANT_DB, tenantId, scope, idempotencyKey, hash, statements);
  return loadCommandResponse(env.TENANT_DB, tenantId, [reversalId], false);
}

export async function getFefoCandidates(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: { variantId: string; warehouseId?: string; quantityBase: string }
): Promise<FefoResponse> {
  await requireInventoryRead(env, request, session, 'inventory.fefo.read');
  const tenantId = session.response.tenant.id;
  const variantId = requiredId(input.variantId, 'variantId');
  const warehouseId = input.warehouseId ? requiredId(input.warehouseId, 'warehouseId') : undefined;
  const quantityBase = requiredPositiveInteger(Number(input.quantityBase), 'quantityBase');
  const rows = await loadBalanceRows(env.TENANT_DB, tenantId, warehouseId, variantId, MAX_RESULTS);
  const eligible = rows
    .filter((row) => row.inventory_status === 'available' && row.quantity_base > 0)
    .sort((left, right) => {
      const leftExpiry = left.expires_on ?? '9999-12-31';
      const rightExpiry = right.expires_on ?? '9999-12-31';
      return leftExpiry.localeCompare(rightExpiry) || left.lot_created_at.localeCompare(right.lot_created_at);
    });
  let remaining = quantityBase;
  let cumulative = 0;
  const candidates: FefoCandidate[] = [];
  for (const row of eligible) {
    if (remaining <= 0) break;
    const recommendedQuantityBase = Math.min(remaining, row.quantity_base);
    cumulative += recommendedQuantityBase;
    remaining -= recommendedQuantityBase;
    candidates.push({
      balance: toBalanceSummary(row),
      recommendedQuantityBase,
      cumulativeQuantityBase: cumulative
    });
  }
  return {
    requestedQuantityBase: quantityBase,
    allocatedQuantityBase: cumulative,
    fullyAllocated: remaining === 0,
    candidates
  };
}

export async function getInventoryAging(
  env: Env,
  request: Request,
  session: ResolvedSession
): Promise<InventoryAgingResponse> {
  await requireInventoryRead(env, request, session, 'inventory.aging.read');
  const tenantId = session.response.tenant.id;
  const settings = await ensureSettings(env.TENANT_DB, tenantId);
  const boundaries = parseAgingBuckets(settings.aging_buckets_json);
  const rows = await loadBalanceRows(env.TENANT_DB, tenantId, undefined, undefined, MAX_RESULTS);
  const today = todayUtc();
  const buckets = createAgingBuckets(boundaries);
  for (const row of rows) {
    if (row.quantity_base <= 0) continue;
    const days = row.expires_on ? daysBetween(today, row.expires_on) : null;
    const bucket = selectAgingBucket(buckets, days);
    bucket.quantityBase += row.quantity_base;
    bucket.lotCount += 1;
  }
  return { configuredBucketsDays: boundaries, buckets };
}

export async function getInventorySettings(
  env: Env,
  request: Request,
  session: ResolvedSession
): Promise<InventorySettingsResponse> {
  await requireInventoryRead(env, request, session, 'inventory.settings.read');
  return toSettingsResponse(await ensureSettings(env.TENANT_DB, session.response.tenant.id));
}

export async function updateInventorySettings(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: UpdateInventorySettingsRequest
): Promise<UpdateInventorySettingsResponse> {
  await requireDomainAccess(
    env,
    request,
    session,
    'inventory',
    'inventory.settings.manage',
    'inventory.settings.update'
  );
  const tenantId = session.response.tenant.id;
  const boundaries = validateAgingBuckets(input.agingBucketsDays);
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash({ boundaries });
  const scope = 'inventory.settings.update';
  const replay = await readDomainReplay<SettingsReplay>(
    env.TENANT_DB,
    tenantId,
    scope,
    idempotencyKey,
    hash
  );
  if (replay) {
    return { settings: toSettingsResponse(await ensureSettings(env.TENANT_DB, tenantId)), replayed: true };
  }

  const existing = await ensureSettings(env.TENANT_DB, tenantId);
  const nextVersion = existing.version + 1;
  const now = new Date().toISOString();
  const statements = [
    env.TENANT_DB.prepare(
      `UPDATE tenant_inventory_settings
       SET aging_buckets_json = ?1, updated_at = ?2, version = ?3
       WHERE tenant_id = ?4 AND version = ?5`
    ).bind(JSON.stringify(boundaries), now, nextVersion, tenantId, existing.version),
    idempotencyStatement(env.TENANT_DB, {
      tenantId,
      scope,
      idempotencyKey,
      requestHash: hash,
      responseStatus: 200,
      responseBody: { version: nextVersion },
      now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: 'inventory.settings.update',
      resourceType: 'inventory-settings',
      resourceId: tenantId,
      metadata: { agingBucketsDays: boundaries, previousVersion: existing.version },
      now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: 'inventory.settings.updated.v1',
      aggregateType: 'inventory-settings',
      aggregateId: tenantId,
      aggregateVersion: nextVersion,
      payload: { agingBucketsDays: boundaries },
      now
    })
  ];
  await runInventoryBatch(env.TENANT_DB, tenantId, scope, idempotencyKey, hash, statements);
  return { settings: toSettingsResponse(await ensureSettings(env.TENANT_DB, tenantId)), replayed: false };
}

async function moveStockStatus(
  env: Env,
  request: Request,
  session: ResolvedSession,
  input: ChangeInventoryStatusRequest,
  sourceStatus: InventoryStatus,
  destinationStatus: InventoryStatus,
  operation: 'quarantine' | 'release'
): Promise<InventoryCommandResponse> {
  await requireDomainAccess(
    env,
    request,
    session,
    'inventory',
    'inventory.stock.quarantine',
    `inventory.stock.${operation}`
  );
  const tenantId = session.response.tenant.id;
  const variantId = requiredId(input.variantId, 'variantId');
  const warehouseId = requiredId(input.warehouseId, 'warehouseId');
  const lotId = requiredId(input.lotId, 'lotId');
  const quantityBase = requiredPositiveInteger(input.quantityBase, 'quantityBase');
  const reason = requiredText(input.reason, 'reason', 3, 500);
  const referenceId = requiredText(input.referenceId, 'referenceId', 2, 160);
  const dimensions = await resolveDimensions(
    env.TENANT_DB,
    tenantId,
    variantId,
    warehouseId,
    input.binId
  );
  await requireLot(env.TENANT_DB, tenantId, lotId, variantId);
  await requireSufficientStock(
    env.TENANT_DB,
    tenantId,
    variantId,
    warehouseId,
    dimensions.bin.id,
    lotId,
    sourceStatus,
    quantityBase
  );

  const groupId = `sts_${crypto.randomUUID()}`;
  const outMovementId = `mov_${crypto.randomUUID()}`;
  const inMovementId = `mov_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const scope = `inventory.${operation}`;
  const idempotencyKey = requireIdempotencyKey(request);
  const hash = await requestHash({
    variantId,
    warehouseId,
    binId: dimensions.bin.id,
    lotId,
    quantityBase,
    reason,
    referenceId,
    sourceStatus,
    destinationStatus
  });
  const replay = await readDomainReplay<CommandReplay>(
    env.TENANT_DB,
    tenantId,
    scope,
    idempotencyKey,
    hash
  );
  if (replay) return loadCommandResponse(env.TENANT_DB, tenantId, replay.movementIds, true);

  const outType: InventoryMovementType = operation === 'quarantine' ? 'quarantine-out' : 'release-out';
  const inType: InventoryMovementType = operation === 'quarantine' ? 'quarantine-in' : 'release-in';
  const statements = [
    balanceDeltaStatement(env.TENANT_DB, {
      tenantId,
      variantId,
      warehouseId,
      binId: dimensions.bin.id,
      lotId,
      status: sourceStatus,
      delta: -quantityBase,
      now
    }),
    movementStatement(env.TENANT_DB, session, {
      movementId: outMovementId,
      movementType: outType,
      referenceType: `inventory-${operation}`,
      referenceId,
      variantId,
      warehouseId,
      binId: dimensions.bin.id,
      lotId,
      status: sourceStatus,
      delta: -quantityBase,
      reason,
      reversalOfMovementId: null,
      transferGroupId: groupId,
      now
    }),
    balanceDeltaStatement(env.TENANT_DB, {
      tenantId,
      variantId,
      warehouseId,
      binId: dimensions.bin.id,
      lotId,
      status: destinationStatus,
      delta: quantityBase,
      now
    }),
    movementStatement(env.TENANT_DB, session, {
      movementId: inMovementId,
      movementType: inType,
      referenceType: `inventory-${operation}`,
      referenceId,
      variantId,
      warehouseId,
      binId: dimensions.bin.id,
      lotId,
      status: destinationStatus,
      delta: quantityBase,
      reason,
      reversalOfMovementId: null,
      transferGroupId: groupId,
      now
    }),
    idempotencyStatement(env.TENANT_DB, {
      tenantId,
      scope,
      idempotencyKey,
      requestHash: hash,
      responseStatus: 201,
      responseBody: { movementIds: [outMovementId, inMovementId] },
      now
    }),
    domainAuditStatement(env.TENANT_DB, session, {
      action: `inventory.stock.${operation}`,
      resourceType: 'inventory-status-transfer',
      resourceId: groupId,
      metadata: { variantId, warehouseId, lotId, quantityBase, sourceStatus, destinationStatus, reason },
      now
    }),
    domainOutboxStatement(env.TENANT_DB, session, {
      eventType: `inventory.stock.${operation === 'quarantine' ? 'quarantined' : 'released'}.v1`,
      aggregateType: 'inventory-status-transfer',
      aggregateId: groupId,
      aggregateVersion: 1,
      payload: {
        groupId,
        outMovementId,
        inMovementId,
        variantId,
        warehouseId,
        binId: dimensions.bin.id,
        lotId,
        quantityBase,
        sourceStatus,
        destinationStatus
      },
      now
    })
  ];
  await runInventoryBatch(env.TENANT_DB, tenantId, scope, idempotencyKey, hash, statements);
  return loadCommandResponse(env.TENANT_DB, tenantId, [outMovementId, inMovementId], false);
}

async function requireInventoryRead(
  env: Env,
  request: Request,
  session: ResolvedSession,
  action: string
): Promise<void> {
  await requireDomainAccess(
    env,
    request,
    session,
    'inventory',
    'inventory.stock.read',
    action
  );
}

async function resolveDimensions(
  db: D1Database,
  tenantId: string,
  variantId: string,
  warehouseId: string,
  binIdInput?: string
): Promise<{
  variant: VariantDimensionRow;
  warehouse: WarehouseDimensionRow;
  bin: BinDimensionRow;
}> {
  const variant = await db.prepare(
    `SELECT v.id, v.sku, v.display_name AS variant_name,
            p.display_name AS product_name, u.code AS base_unit_code, v.active
     FROM product_variants v
     JOIN products p ON p.tenant_id = v.tenant_id AND p.id = v.product_id
     JOIN units_of_measure u ON u.tenant_id = v.tenant_id AND u.id = v.base_unit_id
     WHERE v.tenant_id = ?1 AND v.id = ?2`
  )
    .bind(tenantId, variantId)
    .first<VariantDimensionRow>();
  if (!variant || variant.active !== 1) throw notFoundError('variant-not-found', 'Product variant was not found');

  const warehouse = await db.prepare(
    `SELECT w.id, w.code, w.display_name, w.active,
            b.id AS default_bin_id
     FROM warehouses w
     JOIN warehouse_bins b
       ON b.tenant_id = w.tenant_id AND b.warehouse_id = w.id AND b.is_default = 1
     WHERE w.tenant_id = ?1 AND w.id = ?2`
  )
    .bind(tenantId, warehouseId)
    .first<WarehouseDimensionRow>();
  if (!warehouse || warehouse.active !== 1) throw notFoundError('warehouse-not-found', 'Warehouse was not found');

  const binId = binIdInput ? requiredId(binIdInput, 'binId') : warehouse.default_bin_id;
  const bin = await db.prepare(
    `SELECT id, code, display_name, warehouse_id, active
     FROM warehouse_bins
     WHERE tenant_id = ?1 AND id = ?2 AND warehouse_id = ?3`
  )
    .bind(tenantId, binId, warehouseId)
    .first<BinDimensionRow>();
  if (!bin || bin.active !== 1) throw notFoundError('bin-not-found', 'Warehouse bin was not found');
  return { variant, warehouse, bin };
}

async function requireLot(
  db: D1Database,
  tenantId: string,
  lotId: string,
  variantId: string
): Promise<LotRow> {
  const lot = await db.prepare(
    `SELECT id, variant_id, lot_code, manufactured_on, expires_on,
            supplier_party_id, created_at
     FROM inventory_lots
     WHERE tenant_id = ?1 AND id = ?2 AND variant_id = ?3`
  )
    .bind(tenantId, lotId, variantId)
    .first<LotRow>();
  if (!lot) throw notFoundError('lot-not-found', 'Inventory lot was not found');
  return lot;
}

async function requireSupplier(db: D1Database, tenantId: string, partyId: string): Promise<void> {
  const party = await db.prepare(
    `SELECT id FROM business_parties
     WHERE tenant_id = ?1 AND id = ?2 AND party_type = 'supplier' AND active = 1`
  )
    .bind(tenantId, partyId)
    .first<{ id: string }>();
  if (!party) throw notFoundError('supplier-not-found', 'Supplier was not found');
}

async function requireSufficientStock(
  db: D1Database,
  tenantId: string,
  variantId: string,
  warehouseId: string,
  binId: string,
  lotId: string,
  status: InventoryStatus,
  requiredQuantity: number
): Promise<void> {
  const row = await db.prepare(
    `SELECT quantity_base FROM inventory_balances
     WHERE tenant_id = ?1 AND variant_id = ?2 AND warehouse_id = ?3
       AND bin_id = ?4 AND lot_id = ?5 AND inventory_status = ?6`
  )
    .bind(tenantId, variantId, warehouseId, binId, lotId, status)
    .first<{ quantity_base: number }>();
  if ((row?.quantity_base ?? 0) < requiredQuantity) {
    throw conflictError(
      'insufficient-stock',
      'Insufficient stock',
      `Available quantity is ${row?.quantity_base ?? 0} base units; ${requiredQuantity} are required.`
    );
  }
}

function balanceDeltaStatement(
  db: D1Database,
  input: {
    tenantId: string;
    variantId: string;
    warehouseId: string;
    binId: string;
    lotId: string;
    status: InventoryStatus;
    delta: number;
    now: string;
  }
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO inventory_balances (
       tenant_id, variant_id, warehouse_id, bin_id, lot_id,
       inventory_status, quantity_base, updated_at, version
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1)
     ON CONFLICT(tenant_id, variant_id, warehouse_id, bin_id, lot_id, inventory_status)
     DO UPDATE SET
       quantity_base = inventory_balances.quantity_base + excluded.quantity_base,
       updated_at = excluded.updated_at,
       version = inventory_balances.version + 1`
  ).bind(
    input.tenantId,
    input.variantId,
    input.warehouseId,
    input.binId,
    input.lotId,
    input.status,
    input.delta,
    input.now
  );
}

function movementStatement(
  db: D1Database,
  session: ResolvedSession,
  input: {
    movementId: string;
    movementType: InventoryMovementType;
    referenceType: string;
    referenceId: string;
    variantId: string;
    warehouseId: string;
    binId: string;
    lotId: string;
    status: InventoryStatus;
    delta: number;
    reason: string | null;
    reversalOfMovementId: string | null;
    transferGroupId: string | null;
    now: string;
  }
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO inventory_movements (
       id, tenant_id, movement_type, reference_type, reference_id,
       transfer_group_id, variant_id, warehouse_id, bin_id, lot_id,
       inventory_status, quantity_delta_base, resulting_quantity_base,
       reversal_of_movement_id, reason, actor_user_id, correlation_id, occurred_at
     )
     SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
            ?11, ?12, b.quantity_base, ?13, ?14, ?15, ?16, ?17
     FROM inventory_balances b
     WHERE b.tenant_id = ?2 AND b.variant_id = ?7 AND b.warehouse_id = ?8
       AND b.bin_id = ?9 AND b.lot_id = ?10 AND b.inventory_status = ?11`
  ).bind(
    input.movementId,
    session.response.tenant.id,
    input.movementType,
    input.referenceType,
    input.referenceId,
    input.transferGroupId,
    input.variantId,
    input.warehouseId,
    input.binId,
    input.lotId,
    input.status,
    input.delta,
    input.reversalOfMovementId,
    input.reason,
    session.response.user.id,
    session.context.correlationId,
    input.now
  );
}

async function runInventoryBatch(
  db: D1Database,
  tenantId: string,
  scope: string,
  idempotencyKey: string,
  hash: string,
  statements: D1PreparedStatement[]
): Promise<void> {
  try {
    await db.batch(statements);
  } catch (error) {
    const replay = await readDomainReplay<CommandReplay>(db, tenantId, scope, idempotencyKey, hash);
    if (replay) return;
    if (error instanceof Error && /CHECK constraint failed|quantity_base/i.test(error.message)) {
      throw conflictError('insufficient-stock', 'Inventory command would create negative stock');
    }
    throw error;
  }
}

async function loadCommandResponse(
  db: D1Database,
  tenantId: string,
  movementIds: string[],
  replayed: boolean
): Promise<InventoryCommandResponse> {
  const movements = await loadMovementRows(db, tenantId, movementIds, movementIds.length);
  const balanceKeyMap = new Map<string, MovementRow>();
  for (const movement of movements) {
    balanceKeyMap.set(
      [
        movement.variant_id,
        movement.warehouse_id,
        movement.bin_id,
        movement.lot_id,
        movement.inventory_status
      ].join(':'),
      movement
    );
  }
  const balances: InventoryBalanceSummary[] = [];
  for (const movement of balanceKeyMap.values()) {
    const rows = await loadBalanceRows(
      db,
      tenantId,
      movement.warehouse_id,
      movement.variant_id,
      MAX_RESULTS,
      movement.bin_id,
      movement.lot_id,
      movement.inventory_status
    );
    balances.push(...rows.map(toBalanceSummary));
  }
  return { movements: movements.map(toMovementSummary), balances, replayed };
}

async function loadBalanceRows(
  db: D1Database,
  tenantId: string,
  warehouseId?: string,
  variantId?: string,
  limit = MAX_RESULTS,
  binId?: string,
  lotId?: string,
  status?: InventoryStatus
): Promise<BalanceRow[]> {
  const result = await db.prepare(
    `SELECT
       b.variant_id, v.sku, p.display_name AS product_name,
       v.display_name AS variant_name, u.code AS base_unit_code,
       b.warehouse_id, w.code AS warehouse_code, w.display_name AS warehouse_name,
       b.bin_id, wb.code AS bin_code,
       b.lot_id, l.lot_code, l.manufactured_on, l.expires_on,
       l.supplier_party_id, l.created_at AS lot_created_at,
       b.inventory_status, b.quantity_base, b.version, b.updated_at
     FROM inventory_balances b
     JOIN product_variants v ON v.tenant_id = b.tenant_id AND v.id = b.variant_id
     JOIN products p ON p.tenant_id = v.tenant_id AND p.id = v.product_id
     JOIN units_of_measure u ON u.tenant_id = v.tenant_id AND u.id = v.base_unit_id
     JOIN warehouses w ON w.tenant_id = b.tenant_id AND w.id = b.warehouse_id
     JOIN warehouse_bins wb ON wb.tenant_id = b.tenant_id AND wb.id = b.bin_id
     JOIN inventory_lots l ON l.tenant_id = b.tenant_id AND l.id = b.lot_id
     WHERE b.tenant_id = ?1
       AND (?2 IS NULL OR b.warehouse_id = ?2)
       AND (?3 IS NULL OR b.variant_id = ?3)
       AND (?4 IS NULL OR b.bin_id = ?4)
       AND (?5 IS NULL OR b.lot_id = ?5)
       AND (?6 IS NULL OR b.inventory_status = ?6)
     ORDER BY
       CASE WHEN l.expires_on IS NULL THEN 1 ELSE 0 END,
       l.expires_on,
       w.code, v.sku, l.lot_code, b.inventory_status
     LIMIT ?7`
  )
    .bind(
      tenantId,
      warehouseId ?? null,
      variantId ?? null,
      binId ?? null,
      lotId ?? null,
      status ?? null,
      limit
    )
    .all<BalanceRow>();
  return result.results;
}

async function loadMovementRows(
  db: D1Database,
  tenantId: string,
  movementIds?: string[],
  limit = 30
): Promise<MovementRow[]> {
  const ids = movementIds ?? [];
  const result = await db.prepare(
    `SELECT
       m.id, m.movement_type, m.reference_type, m.reference_id,
       m.variant_id, v.sku, m.warehouse_id, w.code AS warehouse_code,
       m.bin_id, b.code AS bin_code, m.lot_id, l.lot_code,
       m.inventory_status, m.quantity_delta_base, m.resulting_quantity_base,
       m.reversal_of_movement_id, m.actor_user_id, m.occurred_at
     FROM inventory_movements m
     JOIN product_variants v ON v.tenant_id = m.tenant_id AND v.id = m.variant_id
     JOIN warehouses w ON w.tenant_id = m.tenant_id AND w.id = m.warehouse_id
     JOIN warehouse_bins b ON b.tenant_id = m.tenant_id AND b.id = m.bin_id
     JOIN inventory_lots l ON l.tenant_id = m.tenant_id AND l.id = m.lot_id
     WHERE m.tenant_id = ?1
       AND (?2 = 0 OR m.id IN (SELECT value FROM json_each(?3)))
     ORDER BY m.occurred_at DESC, m.id DESC
     LIMIT ?4`
  )
    .bind(tenantId, ids.length, JSON.stringify(ids), limit)
    .all<MovementRow>();
  return result.results;
}

async function loadOriginalMovement(
  db: D1Database,
  tenantId: string,
  movementId: string
): Promise<OriginalMovementRow> {
  const row = await db.prepare(
    `SELECT
       m.id, m.movement_type, m.reference_type, m.reference_id,
       m.transfer_group_id, m.variant_id, v.sku,
       m.warehouse_id, w.code AS warehouse_code,
       m.bin_id, b.code AS bin_code, m.lot_id, l.lot_code,
       m.inventory_status, m.quantity_delta_base, m.resulting_quantity_base,
       m.reversal_of_movement_id, m.reason, m.actor_user_id, m.occurred_at
     FROM inventory_movements m
     JOIN product_variants v ON v.tenant_id = m.tenant_id AND v.id = m.variant_id
     JOIN warehouses w ON w.tenant_id = m.tenant_id AND w.id = m.warehouse_id
     JOIN warehouse_bins b ON b.tenant_id = m.tenant_id AND b.id = m.bin_id
     JOIN inventory_lots l ON l.tenant_id = m.tenant_id AND l.id = m.lot_id
     WHERE m.tenant_id = ?1 AND m.id = ?2`
  )
    .bind(tenantId, movementId)
    .first<OriginalMovementRow>();
  if (!row) throw notFoundError('movement-not-found', 'Inventory movement was not found');
  return row;
}

async function ensureSettings(db: D1Database, tenantId: string): Promise<SettingsRow> {
  let row = await db.prepare(
    `SELECT aging_buckets_json, updated_at, version
     FROM tenant_inventory_settings WHERE tenant_id = ?1`
  )
    .bind(tenantId)
    .first<SettingsRow>();
  if (row) return row;
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT OR IGNORE INTO tenant_inventory_settings (
       tenant_id, aging_buckets_json, allow_negative_stock, updated_at, version
     ) VALUES (?1, ?2, 0, ?3, 1)`
  )
    .bind(tenantId, JSON.stringify(DEFAULT_AGING_BUCKETS), now)
    .run();
  row = await db.prepare(
    `SELECT aging_buckets_json, updated_at, version
     FROM tenant_inventory_settings WHERE tenant_id = ?1`
  )
    .bind(tenantId)
    .first<SettingsRow>();
  if (!row) throw new Error('inventory_settings_initialization_failed');
  return row;
}

function toBalanceSummary(row: BalanceRow): InventoryBalanceSummary {
  return {
    variantId: row.variant_id,
    sku: row.sku,
    productName: row.product_name,
    variantName: row.variant_name,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name,
    binId: row.bin_id,
    binCode: row.bin_code,
    lot: toLotSummary(row),
    status: row.inventory_status,
    quantityBase: row.quantity_base,
    baseUnitCode: row.base_unit_code,
    expiresInDays: row.expires_on ? daysBetween(todayUtc(), row.expires_on) : null,
    version: row.version,
    updatedAt: row.updated_at
  };
}

function toLotSummary(row: BalanceRow): InventoryLotSummary {
  return {
    id: row.lot_id,
    variantId: row.variant_id,
    lotCode: row.lot_code,
    manufacturedOn: row.manufactured_on,
    expiresOn: row.expires_on,
    supplierPartyId: row.supplier_party_id,
    createdAt: row.lot_created_at
  };
}

function toMovementSummary(row: MovementRow): InventoryMovementSummary {
  return {
    id: row.id,
    movementType: row.movement_type,
    referenceType: row.reference_type,
    referenceId: row.reference_id,
    variantId: row.variant_id,
    sku: row.sku,
    warehouseId: row.warehouse_id,
    warehouseCode: row.warehouse_code,
    binId: row.bin_id,
    binCode: row.bin_code,
    lotId: row.lot_id,
    lotCode: row.lot_code,
    status: row.inventory_status,
    quantityDeltaBase: row.quantity_delta_base,
    resultingQuantityBase: row.resulting_quantity_base,
    reversalOfMovementId: row.reversal_of_movement_id,
    actorUserId: row.actor_user_id,
    occurredAt: row.occurred_at
  };
}

function inventoryStatus(value: unknown): InventoryStatus {
  if (typeof value !== 'string' || !INVENTORY_STATUSES.has(value as InventoryStatus)) {
    throw validationError('status must be available, quarantine, damaged or blocked.');
  }
  return value as InventoryStatus;
}

function parseAgingBuckets(value: string): number[] {
  try {
    return validateAgingBuckets(JSON.parse(value));
  } catch {
    return [...DEFAULT_AGING_BUCKETS];
  }
}

function validateAgingBuckets(value: unknown): number[] {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) {
    throw validationError('agingBucketsDays must contain 2 to 8 positive day boundaries.');
  }
  const values = value.map((candidate, index) =>
    requiredPositiveInteger(candidate, `agingBucketsDays[${index}]`)
  );
  if (new Set(values).size !== values.length || values.some((value, index) => index > 0 && value <= values[index - 1]!)) {
    throw validationError('agingBucketsDays must be unique and strictly ascending.');
  }
  if (values.at(-1)! > 3650) throw validationError('aging bucket boundaries cannot exceed 3650 days.');
  return values;
}

function createAgingBuckets(boundaries: number[]): InventoryAgingBucket[] {
  const buckets: InventoryAgingBucket[] = [
    {
      key: 'expired',
      label: 'Expired',
      minimumDays: null,
      maximumDays: -1,
      quantityBase: 0,
      lotCount: 0
    }
  ];
  let previous = 0;
  for (const boundary of boundaries) {
    buckets.push({
      key: `days-${previous}-${boundary}`,
      label: `${previous}–${boundary} days remaining`,
      minimumDays: previous,
      maximumDays: boundary,
      quantityBase: 0,
      lotCount: 0
    });
    previous = boundary + 1;
  }
  buckets.push(
    {
      key: `days-${previous}-plus`,
      label: `${previous}+ days remaining`,
      minimumDays: previous,
      maximumDays: null,
      quantityBase: 0,
      lotCount: 0
    },
    {
      key: 'no-expiry',
      label: 'No expiry date',
      minimumDays: null,
      maximumDays: null,
      quantityBase: 0,
      lotCount: 0
    }
  );
  return buckets;
}

function selectAgingBucket(
  buckets: InventoryAgingBucket[],
  days: number | null
): InventoryAgingBucket {
  if (days === null) return buckets.at(-1)!;
  if (days < 0) return buckets[0]!;
  return (
    buckets.find(
      (bucket) =>
        bucket.minimumDays !== null &&
        days >= bucket.minimumDays &&
        (bucket.maximumDays === null || days <= bucket.maximumDays)
    ) ?? buckets.at(-2)!
  );
}

function toSettingsResponse(row: SettingsRow): InventorySettingsResponse {
  return {
    agingBucketsDays: parseAgingBuckets(row.aging_buckets_json),
    updatedAt: row.updated_at,
    version: row.version
  };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  const startMs = new Date(`${start}T00:00:00.000Z`).getTime();
  const endMs = new Date(`${end}T00:00:00.000Z`).getTime();
  return Math.floor((endMs - startMs) / 86_400_000);
}
