import type {
  CancelSalesOrderResponse,
  CompleteCrmTaskResponse,
  ConvertQuoteRequest,
  ConvertQuoteResponse,
  CreateCrmAccountRequest,
  CreateCrmAccountResponse,
  CreateCrmActivityRequest,
  CreateCrmActivityResponse,
  CreateCrmContactRequest,
  CreateCrmContactResponse,
  CreateCrmTaskRequest,
  CreateCrmTaskResponse,
  CreateOpportunityRequest,
  CreateOpportunityResponse,
  CreatePriceListRequest,
  CreatePriceListResponse,
  CreateQuoteRequest,
  CrmOverviewResponse,
  QuoteCommandResponse,
  SalesOverviewResponse,
  UpdateOpportunityStageRequest,
  UpdateOpportunityStageResponse
} from '@fmcgbyalex/contracts/commercial';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren
} from 'react';
import { ApiError, FmcgApiClient, createIdempotencyKey } from '../lib/api-client';
import { useApplication } from './ApplicationProvider';

export type CommercialNotice = Readonly<{
  tone: 'success' | 'error' | 'info';
  title: string;
  detail: string;
}>;

export type CommercialContextValue = Readonly<{
  crm: CrmOverviewResponse | null;
  sales: SalesOverviewResponse | null;
  loading: boolean;
  refreshing: boolean;
  busyAction: string | null;
  error: ApiError | null;
  notice: CommercialNotice | null;
  refresh: () => Promise<void>;
  dismissNotice: () => void;
  createAccount: (input: CreateCrmAccountRequest) => Promise<CreateCrmAccountResponse>;
  createContact: (input: CreateCrmContactRequest) => Promise<CreateCrmContactResponse>;
  createActivity: (input: CreateCrmActivityRequest) => Promise<CreateCrmActivityResponse>;
  createTask: (input: CreateCrmTaskRequest) => Promise<CreateCrmTaskResponse>;
  completeTask: (taskId: string) => Promise<CompleteCrmTaskResponse>;
  createOpportunity: (input: CreateOpportunityRequest) => Promise<CreateOpportunityResponse>;
  updateOpportunityStage: (
    opportunityId: string,
    input: UpdateOpportunityStageRequest
  ) => Promise<UpdateOpportunityStageResponse>;
  createPriceList: (input: CreatePriceListRequest) => Promise<CreatePriceListResponse>;
  createQuote: (input: CreateQuoteRequest) => Promise<QuoteCommandResponse>;
  sendQuote: (quoteId: string) => Promise<QuoteCommandResponse>;
  acceptQuote: (quoteId: string) => Promise<QuoteCommandResponse>;
  convertQuote: (quoteId: string, input: ConvertQuoteRequest) => Promise<ConvertQuoteResponse>;
  cancelOrder: (orderId: string) => Promise<CancelSalesOrderResponse>;
}>;

const CommercialContext = createContext<CommercialContextValue | null>(null);

export function CommercialProvider({ children }: PropsWithChildren) {
  const application = useApplication();
  const [crm, setCrm] = useState<CrmOverviewResponse | null>(null);
  const [sales, setSales] = useState<SalesOverviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<CommercialNotice | null>(null);
  const generation = useRef(0);

  const client = useMemo(
    () => application.authentication
      ? new FmcgApiClient(application.runtime, application.authentication)
      : null,
    [application.authentication, application.runtime]
  );

  useEffect(() => {
    if (
      application.status !== 'ready' ||
      !application.tenantId ||
      !application.session ||
      !client
    ) {
      ++generation.current;
      setCrm(null);
      setSales(null);
      setLoading(false);
      setError(null);
      return;
    }
    void loadCommercialData(client, application.tenantId, true);
  }, [application.status, application.tenantId, application.session, client]);

  async function loadCommercialData(
    activeClient: FmcgApiClient,
    tenantId: string,
    initial: boolean
  ): Promise<void> {
    const currentGeneration = ++generation.current;
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);

    const modules = new Map(
      (application.session?.modules ?? []).map((module) => [module.key, module.enabled])
    );
    const permissions = new Set(application.session?.permissions ?? []);
    const crmReadable = modules.get('crm') === true &&
      permissions.has('crm.accounts.read') &&
      permissions.has('crm.activities.read') &&
      permissions.has('crm.pipeline.read');
    const salesReadable = modules.get('sales') === true &&
      permissions.has('sales.pricing.read') &&
      permissions.has('sales.quotes.read') &&
      permissions.has('sales.orders.read');

    try {
      const [nextCrm, nextSales] = await Promise.all([
        crmReadable
          ? activeClient.get<CrmOverviewResponse>('/v1/crm/overview', tenantId)
          : Promise.resolve(null),
        salesReadable
          ? activeClient.get<SalesOverviewResponse>('/v1/sales/overview', tenantId)
          : Promise.resolve(null)
      ]);
      if (currentGeneration !== generation.current) return;
      setCrm(nextCrm);
      setSales(nextSales);
    } catch (caught) {
      if (currentGeneration !== generation.current) return;
      const apiError = toApiError(caught);
      setError(apiError);
      setNotice({
        tone: 'error',
        title: apiError.problem.title,
        detail: apiError.problem.detail ?? 'Commercial data could not be loaded.'
      });
    } finally {
      if (currentGeneration === generation.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  async function refresh(): Promise<void> {
    const activeClient = requireClient();
    const tenantId = requireTenantId();
    await loadCommercialData(activeClient, tenantId, false);
  }

  async function runMutation<T>(
    label: string,
    successTitle: string,
    successDetail: string,
    operation: (activeClient: FmcgApiClient, tenantId: string) => Promise<T>
  ): Promise<T> {
    const activeClient = requireClient();
    const tenantId = requireTenantId();
    setBusyAction(label);
    setNotice(null);
    try {
      const response = await operation(activeClient, tenantId);
      await loadCommercialData(activeClient, tenantId, false);
      setNotice({ tone: 'success', title: successTitle, detail: successDetail });
      return response;
    } catch (caught) {
      const apiError = toApiError(caught);
      setError(apiError);
      setNotice({
        tone: 'error',
        title: apiError.problem.title,
        detail: apiError.problem.detail ?? `Request failed${apiError.correlationId ? ` · ${apiError.correlationId}` : ''}`
      });
      throw apiError;
    } finally {
      setBusyAction(null);
    }
  }

  function requireClient(): FmcgApiClient {
    if (!client) throw new Error('Authentication is required.');
    return client;
  }

  function requireTenantId(): string {
    if (!application.tenantId) throw new Error('A tenant must be selected.');
    return application.tenantId;
  }

  const value: CommercialContextValue = {
    crm,
    sales,
    loading,
    refreshing,
    busyAction,
    error,
    notice,
    refresh,
    dismissNotice: () => setNotice(null),
    createAccount: (input) => runMutation(
      'Creating account',
      'CRM account created',
      `${input.name} is available for contacts, opportunities and quotations.`,
      (activeClient, tenantId) => activeClient.mutate<CreateCrmAccountResponse>(
        'POST', '/v1/crm/accounts', input, tenantId, createIdempotencyKey('crm-account-create')
      )
    ),
    createContact: (input) => runMutation(
      'Creating contact',
      'Contact created',
      'The contact is now linked to the selected account.',
      (activeClient, tenantId) => activeClient.mutate<CreateCrmContactResponse>(
        'POST', '/v1/crm/contacts', input, tenantId, createIdempotencyKey('crm-contact-create')
      )
    ),
    createActivity: (input) => runMutation(
      'Logging activity',
      'Activity recorded',
      'The interaction was added to the immutable account history.',
      (activeClient, tenantId) => activeClient.mutate<CreateCrmActivityResponse>(
        'POST', '/v1/crm/activities', input, tenantId, createIdempotencyKey('crm-activity-create')
      )
    ),
    createTask: (input) => runMutation(
      'Creating follow-up',
      'Follow-up scheduled',
      'The task now appears in the commercial priority queue.',
      (activeClient, tenantId) => activeClient.mutate<CreateCrmTaskResponse>(
        'POST', '/v1/crm/tasks', input, tenantId, createIdempotencyKey('crm-task-create')
      )
    ),
    completeTask: (taskId) => runMutation(
      'Completing follow-up',
      'Follow-up completed',
      'The task was closed and remains available in account history.',
      (activeClient, tenantId) => activeClient.mutate<CompleteCrmTaskResponse>(
        'POST', `/v1/crm/tasks/${encodeURIComponent(taskId)}/complete`, {}, tenantId,
        createIdempotencyKey('crm-task-complete')
      )
    ),
    createOpportunity: (input) => runMutation(
      'Creating opportunity',
      'Opportunity created',
      `${input.name} was added to the weighted pipeline.`,
      (activeClient, tenantId) => activeClient.mutate<CreateOpportunityResponse>(
        'POST', '/v1/crm/opportunities', input, tenantId,
        createIdempotencyKey('crm-opportunity-create')
      )
    ),
    updateOpportunityStage: (opportunityId, input) => runMutation(
      'Updating opportunity',
      'Pipeline stage updated',
      'Weighted pipeline and next-action views were recalculated.',
      (activeClient, tenantId) => activeClient.mutate<UpdateOpportunityStageResponse>(
        'PATCH', `/v1/crm/opportunities/${encodeURIComponent(opportunityId)}/stage`, input,
        tenantId, createIdempotencyKey('crm-opportunity-stage')
      )
    ),
    createPriceList: (input) => runMutation(
      'Creating price list',
      'Price list created',
      `${input.name} is available for commercial planning.`,
      (activeClient, tenantId) => activeClient.mutate<CreatePriceListResponse>(
        'POST', '/v1/sales/price-lists', input, tenantId,
        createIdempotencyKey('sales-price-list-create')
      )
    ),
    createQuote: (input) => runMutation(
      'Creating quotation',
      'Quotation created',
      'All line totals, discounts and taxes were recomputed by the server.',
      (activeClient, tenantId) => activeClient.mutate<QuoteCommandResponse>(
        'POST', '/v1/sales/quotes', input, tenantId, createIdempotencyKey('sales-quote-create')
      )
    ),
    sendQuote: (quoteId) => runMutation(
      'Sending quotation',
      'Quotation marked as sent',
      'The quotation moved into the customer-decision stage.',
      (activeClient, tenantId) => activeClient.mutate<QuoteCommandResponse>(
        'POST', `/v1/sales/quotes/${encodeURIComponent(quoteId)}/send`, {}, tenantId,
        createIdempotencyKey('sales-quote-send')
      )
    ),
    acceptQuote: (quoteId) => runMutation(
      'Accepting quotation',
      'Quotation accepted',
      'The accepted quotation can now be converted into an inventory-backed order.',
      (activeClient, tenantId) => activeClient.mutate<QuoteCommandResponse>(
        'POST', `/v1/sales/quotes/${encodeURIComponent(quoteId)}/accept`, {}, tenantId,
        createIdempotencyKey('sales-quote-accept')
      )
    ),
    convertQuote: (quoteId, input) => runMutation(
      'Converting quotation',
      'Sales order allocated',
      'The order and its warehouse reservations were committed atomically.',
      (activeClient, tenantId) => activeClient.mutate<ConvertQuoteResponse>(
        'POST', `/v1/sales/quotes/${encodeURIComponent(quoteId)}/convert`, input, tenantId,
        createIdempotencyKey('sales-quote-convert')
      )
    ),
    cancelOrder: (orderId) => runMutation(
      'Cancelling order',
      'Sales order cancelled',
      'All active inventory reservations were released.',
      (activeClient, tenantId) => activeClient.mutate<CancelSalesOrderResponse>(
        'POST', `/v1/sales/orders/${encodeURIComponent(orderId)}/cancel`, {}, tenantId,
        createIdempotencyKey('sales-order-cancel')
      )
    )
  };

  return <CommercialContext.Provider value={value}>{children}</CommercialContext.Provider>;
}

export function useCommercial(): CommercialContextValue {
  const context = useContext(CommercialContext);
  if (!context) throw new Error('useCommercial must be used within CommercialProvider.');
  return context;
}

function toApiError(caught: unknown): ApiError {
  if (caught instanceof ApiError) return caught;
  return new ApiError(
    0,
    {
      type: 'https://fmcgbyalex.com/problems/client-error',
      title: 'The commercial operation could not be completed',
      status: 0,
      detail: caught instanceof Error ? caught.message : 'An unexpected client error occurred.'
    },
    null
  );
}
