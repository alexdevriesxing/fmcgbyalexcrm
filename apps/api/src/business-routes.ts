import type {
  AdjustStockRequest,
  ChangeInventoryStatusRequest,
  CreatePartyRequest,
  CreateProductRequest,
  CreateWarehouseRequest,
  ReceiveStockRequest,
  ReverseInventoryMovementRequest,
  TransferStockRequest,
  UpdateInventorySettingsRequest
} from '@fmcgbyalex/contracts/inventory';
import type { Hono } from 'hono';
import {
  adjustStock,
  getFefoCandidates,
  getInventoryAging,
  getInventoryBalances,
  getInventoryOverview,
  getInventorySettings,
  quarantineStock,
  receiveStock,
  releaseStock,
  reverseInventoryMovement,
  transferStock,
  updateInventorySettings
} from './inventory';
import {
  createParty,
  createProduct,
  createWarehouse,
  listParties,
  listProducts,
  listWarehouses
} from './master-data';
import { PlatformHttpError, type ApiVariables } from './platform';

type ApiApp = Hono<{ Bindings: Env; Variables: ApiVariables }>;

export function registerBusinessRoutes(app: ApiApp): void {
  app.get('/v1/master-data/products', async (c) =>
    c.json(await listProducts(c.env, c.req.raw, c.get('session')))
  );

  app.post('/v1/master-data/products', async (c) => {
    const response = await createProduct(
      c.env,
      c.req.raw,
      c.get('session'),
      await readJson<CreateProductRequest>(c.req.raw)
    );
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.get('/v1/master-data/warehouses', async (c) =>
    c.json(await listWarehouses(c.env, c.req.raw, c.get('session')))
  );

  app.post('/v1/master-data/warehouses', async (c) => {
    const response = await createWarehouse(
      c.env,
      c.req.raw,
      c.get('session'),
      await readJson<CreateWarehouseRequest>(c.req.raw)
    );
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.get('/v1/master-data/parties', async (c) =>
    c.json(await listParties(c.env, c.req.raw, c.get('session')))
  );

  app.post('/v1/master-data/parties', async (c) => {
    const response = await createParty(
      c.env,
      c.req.raw,
      c.get('session'),
      await readJson<CreatePartyRequest>(c.req.raw)
    );
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.get('/v1/inventory/overview', async (c) =>
    c.json(await getInventoryOverview(c.env, c.req.raw, c.get('session')))
  );

  app.get('/v1/inventory/balances', async (c) => {
    const warehouseId = c.req.query('warehouseId');
    const variantId = c.req.query('variantId');
    const filters: { warehouseId?: string; variantId?: string } = {};
    if (warehouseId) filters.warehouseId = warehouseId;
    if (variantId) filters.variantId = variantId;
    return c.json(await getInventoryBalances(c.env, c.req.raw, c.get('session'), filters));
  });

  app.post('/v1/inventory/receipts', async (c) => {
    const response = await receiveStock(
      c.env,
      c.req.raw,
      c.get('session'),
      await readJson<ReceiveStockRequest>(c.req.raw)
    );
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.post('/v1/inventory/adjustments', async (c) => {
    const response = await adjustStock(
      c.env,
      c.req.raw,
      c.get('session'),
      await readJson<AdjustStockRequest>(c.req.raw)
    );
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.post('/v1/inventory/transfers', async (c) => {
    const response = await transferStock(
      c.env,
      c.req.raw,
      c.get('session'),
      await readJson<TransferStockRequest>(c.req.raw)
    );
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.post('/v1/inventory/quarantine', async (c) => {
    const response = await quarantineStock(
      c.env,
      c.req.raw,
      c.get('session'),
      await readJson<ChangeInventoryStatusRequest>(c.req.raw)
    );
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.post('/v1/inventory/releases', async (c) => {
    const response = await releaseStock(
      c.env,
      c.req.raw,
      c.get('session'),
      await readJson<ChangeInventoryStatusRequest>(c.req.raw)
    );
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.post('/v1/inventory/movements/:movementId/reversal', async (c) => {
    const response = await reverseInventoryMovement(
      c.env,
      c.req.raw,
      c.get('session'),
      c.req.param('movementId'),
      await readJson<ReverseInventoryMovementRequest>(c.req.raw)
    );
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.get('/v1/inventory/fefo', async (c) => {
    const variantId = c.req.query('variantId');
    const quantityBase = c.req.query('quantityBase');
    const warehouseId = c.req.query('warehouseId');
    if (!variantId || !quantityBase) {
      throw validationError('variantId and quantityBase query parameters are required.');
    }
    const fefoInput: { variantId: string; warehouseId?: string; quantityBase: string } = {
      variantId,
      quantityBase
    };
    if (warehouseId) fefoInput.warehouseId = warehouseId;
    return c.json(await getFefoCandidates(c.env, c.req.raw, c.get('session'), fefoInput));
  });

  app.get('/v1/inventory/aging', async (c) =>
    c.json(await getInventoryAging(c.env, c.req.raw, c.get('session')))
  );

  app.get('/v1/inventory/settings', async (c) =>
    c.json(await getInventorySettings(c.env, c.req.raw, c.get('session')))
  );

  app.put('/v1/inventory/settings', async (c) => {
    const response = await updateInventorySettings(
      c.env,
      c.req.raw,
      c.get('session'),
      await readJson<UpdateInventorySettingsRequest>(c.req.raw)
    );
    return c.json(response);
  });
}

async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get('Content-Type') ?? '';
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new PlatformHttpError({
      status: 415,
      type: 'https://fmcgbyalex.com/problems/unsupported-media-type',
      title: 'Content-Type must be application/json'
    });
  }
  try {
    return (await request.json()) as T;
  } catch {
    throw new PlatformHttpError({
      status: 400,
      type: 'https://fmcgbyalex.com/problems/invalid-json',
      title: 'Request body is not valid JSON'
    });
  }
}

function validationError(detail: string): PlatformHttpError {
  return new PlatformHttpError({
    status: 400,
    type: 'https://fmcgbyalex.com/problems/validation-error',
    title: 'Request validation failed',
    detail
  });
}
