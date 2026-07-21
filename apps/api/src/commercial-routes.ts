import type {
  ConvertQuoteRequest,
  CreateCrmAccountRequest,
  CreateCrmActivityRequest,
  CreateCrmContactRequest,
  CreateCrmTaskRequest,
  CreateOpportunityRequest,
  CreatePriceListRequest,
  CreateQuoteRequest,
  UpdateOpportunityStageRequest
} from '@fmcgbyalex/contracts/commercial';
import type { Hono } from 'hono';
import {
  completeCrmTask,
  createCrmAccount,
  createCrmActivity,
  createCrmContact,
  createCrmTask,
  createOpportunity,
  getCrmOverview,
  updateOpportunityStage
} from './crm';
import { PlatformHttpError, type ApiVariables } from './platform';
import {
  acceptQuote,
  cancelSalesOrder,
  convertQuote,
  createPriceList,
  createQuote,
  getSalesOverview,
  sendQuote
} from './sales';

type ApiApp = Hono<{ Bindings: Env; Variables: ApiVariables }>;

export function registerCommercialRoutes(app: ApiApp): void {
  app.get('/v1/crm/overview', async (c) =>
    c.json(await getCrmOverview(c.env, c.req.raw, c.get('session')))
  );

  app.post('/v1/crm/accounts', async (c) => {
    const response = await createCrmAccount(c.env, c.req.raw, c.get('session'), await readJson<CreateCrmAccountRequest>(c.req.raw));
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.post('/v1/crm/contacts', async (c) => {
    const response = await createCrmContact(c.env, c.req.raw, c.get('session'), await readJson<CreateCrmContactRequest>(c.req.raw));
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.post('/v1/crm/activities', async (c) => {
    const response = await createCrmActivity(c.env, c.req.raw, c.get('session'), await readJson<CreateCrmActivityRequest>(c.req.raw));
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.post('/v1/crm/tasks', async (c) => {
    const response = await createCrmTask(c.env, c.req.raw, c.get('session'), await readJson<CreateCrmTaskRequest>(c.req.raw));
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.post('/v1/crm/tasks/:taskId/complete', async (c) =>
    c.json(await completeCrmTask(c.env, c.req.raw, c.get('session'), c.req.param('taskId')))
  );

  app.post('/v1/crm/opportunities', async (c) => {
    const response = await createOpportunity(c.env, c.req.raw, c.get('session'), await readJson<CreateOpportunityRequest>(c.req.raw));
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.patch('/v1/crm/opportunities/:opportunityId/stage', async (c) =>
    c.json(await updateOpportunityStage(
      c.env,
      c.req.raw,
      c.get('session'),
      c.req.param('opportunityId'),
      await readJson<UpdateOpportunityStageRequest>(c.req.raw)
    ))
  );

  app.get('/v1/sales/overview', async (c) =>
    c.json(await getSalesOverview(c.env, c.req.raw, c.get('session')))
  );

  app.post('/v1/sales/price-lists', async (c) => {
    const response = await createPriceList(c.env, c.req.raw, c.get('session'), await readJson<CreatePriceListRequest>(c.req.raw));
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.post('/v1/sales/quotes', async (c) => {
    const response = await createQuote(c.env, c.req.raw, c.get('session'), await readJson<CreateQuoteRequest>(c.req.raw));
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.post('/v1/sales/quotes/:quoteId/send', async (c) =>
    c.json(await sendQuote(c.env, c.req.raw, c.get('session'), c.req.param('quoteId')))
  );

  app.post('/v1/sales/quotes/:quoteId/accept', async (c) =>
    c.json(await acceptQuote(c.env, c.req.raw, c.get('session'), c.req.param('quoteId')))
  );

  app.post('/v1/sales/quotes/:quoteId/convert', async (c) => {
    const response = await convertQuote(
      c.env,
      c.req.raw,
      c.get('session'),
      c.req.param('quoteId'),
      await readJson<ConvertQuoteRequest>(c.req.raw)
    );
    return c.json(response, response.replayed ? 200 : 201);
  });

  app.post('/v1/sales/orders/:orderId/cancel', async (c) =>
    c.json(await cancelSalesOrder(c.env, c.req.raw, c.get('session'), c.req.param('orderId')))
  );
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
