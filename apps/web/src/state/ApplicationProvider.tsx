import type {
  ApprovalWorkspaceResponse,
  CreateInvitationRequest,
  CreateInvitationResponse,
  DecideApprovalRequestRequest,
  DecideApprovalRequestResponse,
  DevelopmentBootstrapRequest,
  DevelopmentBootstrapResponse,
  OnboardTenantRequest,
  OnboardTenantResponse,
  RevokeInvitationResponse,
  SessionContextResponse,
  TenantAdministrationResponse,
  TenantOption,
  TenantOptionsResponse,
  UpdateMembershipRequest,
  UpdateMembershipResponse
} from '@fmcgbyalex/contracts';
import type {
  AdjustStockRequest,
  ChangeInventoryStatusRequest,
  CreatePartyRequest,
  CreatePartyResponse,
  CreateProductRequest,
  CreateProductResponse,
  CreateWarehouseRequest,
  CreateWarehouseResponse,
  FefoResponse,
  InventoryAgingResponse,
  InventoryCommandResponse,
  InventoryOverviewResponse,
  InventorySettingsResponse,
  PartyListResponse,
  PartySummary,
  ProductCatalogResponse,
  ProductSummary,
  ReceiveStockRequest,
  ReverseInventoryMovementRequest,
  TransferStockRequest,
  UpdateInventorySettingsRequest,
  UpdateInventorySettingsResponse,
  WarehouseListResponse,
  WarehouseSummary
} from '@fmcgbyalex/contracts/inventory';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren
} from 'react';
import {
  ApiError,
  FmcgApiClient,
  createIdempotencyKey,
  type ClientAuthentication
} from '../lib/api-client';
import { applicationRuntime, type ApplicationRuntime } from '../lib/runtime';

const DEVELOPMENT_AUTH_STORAGE = 'fmcgbyalex.development-identity';
const OIDC_TOKEN_STORAGE = 'fmcgbyalex.oidc-token';
const TENANT_STORAGE = 'fmcgbyalex.tenant-id';

export type ApplicationStatus =
  | 'authentication-required'
  | 'loading'
  | 'tenant-required'
  | 'ready'
  | 'error';

export type ApplicationData = Readonly<{
  products: ProductSummary[];
  warehouses: WarehouseSummary[];
  parties: PartySummary[];
  inventory: InventoryOverviewResponse | null;
  aging: InventoryAgingResponse | null;
  inventorySettings: InventorySettingsResponse | null;
  approvals: ApprovalWorkspaceResponse | null;
  administration: TenantAdministrationResponse | null;
}>;

export type ApplicationNotice = Readonly<{
  tone: 'success' | 'error' | 'info';
  title: string;
  detail: string;
}>;

export type ApplicationContextValue = Readonly<{
  runtime: ApplicationRuntime;
  status: ApplicationStatus;
  authentication: ClientAuthentication | null;
  tenants: TenantOption[];
  tenantId: string | null;
  session: SessionContextResponse | null;
  data: ApplicationData;
  error: ApiError | null;
  busyAction: string | null;
  refreshing: boolean;
  notice: ApplicationNotice | null;
  hasPermission: (permission: string) => boolean;
  authenticateDevelopment: (input: { subject: string; email: string; displayName: string }) => void;
  authenticateOidc: (accessToken: string) => void;
  signOut: () => void;
  retry: () => Promise<void>;
  selectTenant: (tenantId: string) => Promise<void>;
  bootstrapDevelopment: (input: DevelopmentBootstrapRequest) => Promise<DevelopmentBootstrapResponse>;
  onboardTenant: (input: OnboardTenantRequest) => Promise<OnboardTenantResponse>;
  refreshAll: () => Promise<void>;
  dismissNotice: () => void;
  createProduct: (input: CreateProductRequest) => Promise<CreateProductResponse>;
  createWarehouse: (input: CreateWarehouseRequest) => Promise<CreateWarehouseResponse>;
  createParty: (input: CreatePartyRequest) => Promise<CreatePartyResponse>;
  receiveStock: (input: ReceiveStockRequest) => Promise<InventoryCommandResponse>;
  transferStock: (input: TransferStockRequest) => Promise<InventoryCommandResponse>;
  adjustStock: (input: AdjustStockRequest) => Promise<InventoryCommandResponse>;
  quarantineStock: (input: ChangeInventoryStatusRequest) => Promise<InventoryCommandResponse>;
  releaseStock: (input: ChangeInventoryStatusRequest) => Promise<InventoryCommandResponse>;
  reverseMovement: (movementId: string, input: ReverseInventoryMovementRequest) => Promise<InventoryCommandResponse>;
  planFefo: (variantId: string, quantityBase: number, warehouseId: string | null) => Promise<FefoResponse>;
  updateInventorySettings: (input: UpdateInventorySettingsRequest) => Promise<UpdateInventorySettingsResponse>;
  decideApproval: (requestId: string, input: DecideApprovalRequestRequest) => Promise<DecideApprovalRequestResponse>;
  inviteMember: (input: CreateInvitationRequest) => Promise<CreateInvitationResponse>;
  updateMember: (userId: string, input: UpdateMembershipRequest) => Promise<UpdateMembershipResponse>;
  revokeInvitation: (invitationId: string) => Promise<RevokeInvitationResponse>;
}>;

const emptyData: ApplicationData = {
  products: [],
  warehouses: [],
  parties: [],
  inventory: null,
  aging: null,
  inventorySettings: null,
  approvals: null,
  administration: null
};

const ApplicationContext = createContext<ApplicationContextValue | null>(null);

export function ApplicationProvider({ children }: PropsWithChildren) {
  const [authentication, setAuthentication] = useState<ClientAuthentication | null>(() => loadAuthentication());
  const [status, setStatus] = useState<ApplicationStatus>(authentication ? 'loading' : 'authentication-required');
  const [tenants, setTenants] = useState<TenantOption[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [session, setSession] = useState<SessionContextResponse | null>(null);
  const [data, setData] = useState<ApplicationData>(emptyData);
  const [error, setError] = useState<ApiError | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<ApplicationNotice | null>(null);
  const loadGeneration = useRef(0);

  const client = useMemo(
    () => (authentication ? new FmcgApiClient(applicationRuntime, authentication) : null),
    [authentication]
  );

  useEffect(() => {
    if (!authentication) {
      setStatus('authentication-required');
      setTenants([]);
      setTenantId(null);
      setSession(null);
      setData(emptyData);
      return;
    }
    void initialize(authentication);
  }, [authentication]);

  async function initialize(nextAuthentication: ClientAuthentication): Promise<void> {
    const generation = ++loadGeneration.current;
    setStatus('loading');
    setError(null);
    const nextClient = new FmcgApiClient(applicationRuntime, nextAuthentication);

    try {
      const options = await nextClient.get<TenantOptionsResponse>('/v1/tenant-options');
      if (generation !== loadGeneration.current) return;
      setTenants(options.tenants);

      if (options.tenants.length === 0) {
        setTenantId(null);
        setSession(null);
        setData(emptyData);
        setStatus('tenant-required');
        return;
      }

      const persistedTenantId = localStorage.getItem(TENANT_STORAGE);
      const selected =
        options.tenants.find((tenant) => tenant.id === persistedTenantId) ?? options.tenants[0];
      if (!selected) {
        setStatus('tenant-required');
        return;
      }

      localStorage.setItem(TENANT_STORAGE, selected.id);
      setTenantId(selected.id);
      await loadTenantData(nextClient, selected.id, generation);
    } catch (caught) {
      if (generation !== loadGeneration.current) return;
      handleLoadFailure(caught);
    }
  }

  async function loadTenantData(
    nextClient: FmcgApiClient,
    selectedTenantId: string,
    generation: number
  ): Promise<void> {
    const nextSession = await nextClient.get<SessionContextResponse>('/v1/session', selectedTenantId);
    const permissions = new Set(nextSession.permissions);
    const enabledModules = new Map(nextSession.modules.map((module) => [module.key, module.enabled]));

    const catalogPromise = enabledModules.get('master-data') && permissions.has('master-data.catalog.read')
      ? nextClient.get<ProductCatalogResponse>('/v1/master-data/products', selectedTenantId)
      : Promise.resolve({ products: [] });
    const warehousesPromise = enabledModules.get('master-data') && permissions.has('master-data.locations.read')
      ? nextClient.get<WarehouseListResponse>('/v1/master-data/warehouses', selectedTenantId)
      : Promise.resolve({ warehouses: [] });
    const partiesPromise = enabledModules.get('master-data') && permissions.has('master-data.parties.read')
      ? nextClient.get<PartyListResponse>('/v1/master-data/parties', selectedTenantId)
      : Promise.resolve({ parties: [] });
    const inventoryPromise = enabledModules.get('inventory') && permissions.has('inventory.stock.read')
      ? nextClient.get<InventoryOverviewResponse>('/v1/inventory/overview', selectedTenantId)
      : Promise.resolve(null);
    const agingPromise = enabledModules.get('inventory') && permissions.has('inventory.stock.read')
      ? nextClient.get<InventoryAgingResponse>('/v1/inventory/aging', selectedTenantId)
      : Promise.resolve(null);
    const settingsPromise = enabledModules.get('inventory') && permissions.has('inventory.stock.read')
      ? nextClient.get<InventorySettingsResponse>('/v1/inventory/settings', selectedTenantId)
      : Promise.resolve(null);
    const approvalsPromise = permissions.has('platform.approvals.read')
      ? nextClient.get<ApprovalWorkspaceResponse>('/v1/approvals', selectedTenantId)
      : Promise.resolve(null);
    const administrationPromise = permissions.has('platform.memberships.read')
      ? nextClient.get<TenantAdministrationResponse>('/v1/admin/access', selectedTenantId)
      : Promise.resolve(null);

    const [catalog, warehouseList, partyList, inventory, aging, inventorySettings, approvals, administration] =
      await Promise.all([
        catalogPromise,
        warehousesPromise,
        partiesPromise,
        inventoryPromise,
        agingPromise,
        settingsPromise,
        approvalsPromise,
        administrationPromise
      ]);

    if (generation !== loadGeneration.current) return;
    setSession(nextSession);
    setData({
      products: catalog.products,
      warehouses: warehouseList.warehouses,
      parties: partyList.parties,
      inventory,
      aging,
      inventorySettings,
      approvals,
      administration
    });
    setError(null);
    setStatus('ready');
  }

  function handleLoadFailure(caught: unknown): void {
    const apiError = toApiError(caught);
    setError(apiError);
    setSession(null);
    setData(emptyData);
    if (apiError.status === 401) {
      clearPersistedAuthentication();
      setAuthentication(null);
      setStatus('authentication-required');
      return;
    }
    setStatus('error');
  }

  function authenticateDevelopment(input: { subject: string; email: string; displayName: string }): void {
    const nextAuthentication: ClientAuthentication = {
      mode: 'development',
      subject: input.subject.trim(),
      email: input.email.trim().toLowerCase(),
      displayName: input.displayName.trim()
    };
    localStorage.setItem(DEVELOPMENT_AUTH_STORAGE, JSON.stringify(nextAuthentication));
    sessionStorage.removeItem(OIDC_TOKEN_STORAGE);
    setAuthentication(nextAuthentication);
  }

  function authenticateOidc(accessToken: string): void {
    const token = accessToken.trim();
    sessionStorage.setItem(OIDC_TOKEN_STORAGE, token);
    localStorage.removeItem(DEVELOPMENT_AUTH_STORAGE);
    setAuthentication({ mode: 'oidc', accessToken: token });
  }

  function signOut(): void {
    ++loadGeneration.current;
    clearPersistedAuthentication();
    localStorage.removeItem(TENANT_STORAGE);
    setAuthentication(null);
    setNotice(null);
  }

  async function retry(): Promise<void> {
    if (!authentication) {
      setStatus('authentication-required');
      return;
    }
    await initialize(authentication);
  }

  async function selectTenant(nextTenantId: string): Promise<void> {
    if (!client || !tenants.some((tenant) => tenant.id === nextTenantId)) {
      return;
    }
    const generation = ++loadGeneration.current;
    setStatus('loading');
    setError(null);
    localStorage.setItem(TENANT_STORAGE, nextTenantId);
    setTenantId(nextTenantId);
    try {
      await loadTenantData(client, nextTenantId, generation);
    } catch (caught) {
      if (generation === loadGeneration.current) handleLoadFailure(caught);
    }
  }

  async function bootstrapDevelopment(input: DevelopmentBootstrapRequest): Promise<DevelopmentBootstrapResponse> {
    const activeClient = requireClient();
    setBusyAction('Creating company');
    try {
      const response = await activeClient.mutate<DevelopmentBootstrapResponse>(
        'POST',
        '/v1/development/bootstrap',
        input
      );
      setNotice({ tone: 'success', title: 'Company created', detail: 'The development tenant is ready to use.' });
      await initialize(activeClient.authentication);
      return response;
    } catch (caught) {
      throw handleMutationFailure(caught);
    } finally {
      setBusyAction(null);
    }
  }

  async function onboardTenant(input: OnboardTenantRequest): Promise<OnboardTenantResponse> {
    const activeClient = requireClient();
    setBusyAction('Creating company');
    try {
      const response = await activeClient.mutate<OnboardTenantResponse>(
        'POST',
        '/v1/onboarding/tenant',
        input,
        undefined,
        createIdempotencyKey('tenant-onboarding')
      );
      setNotice({ tone: 'success', title: 'Company created', detail: 'Your tenant and administrator access are ready.' });
      await initialize(activeClient.authentication);
      return response;
    } catch (caught) {
      throw handleMutationFailure(caught);
    } finally {
      setBusyAction(null);
    }
  }

  async function refreshAll(): Promise<void> {
    const activeClient = requireClient();
    const activeTenantId = requireTenantId();
    const generation = ++loadGeneration.current;
    setRefreshing(true);
    try {
      await loadTenantData(activeClient, activeTenantId, generation);
    } catch (caught) {
      if (generation === loadGeneration.current) {
        const apiError = toApiError(caught);
        setError(apiError);
        setNotice({ tone: 'error', title: apiError.problem.title, detail: apiError.problem.detail ?? 'Refresh failed.' });
      }
    } finally {
      setRefreshing(false);
    }
  }

  async function runMutation<T>(
    label: string,
    successTitle: string,
    successDetail: string,
    operation: (activeClient: FmcgApiClient, activeTenantId: string) => Promise<T>
  ): Promise<T> {
    const activeClient = requireClient();
    const activeTenantId = requireTenantId();
    setBusyAction(label);
    setNotice(null);
    try {
      const response = await operation(activeClient, activeTenantId);
      await refreshAll();
      setNotice({ tone: 'success', title: successTitle, detail: successDetail });
      return response;
    } catch (caught) {
      throw handleMutationFailure(caught);
    } finally {
      setBusyAction(null);
    }
  }

  function handleMutationFailure(caught: unknown): ApiError {
    const apiError = toApiError(caught);
    setNotice({
      tone: 'error',
      title: apiError.problem.title,
      detail: apiError.problem.detail ?? `Request failed${apiError.correlationId ? ` · ${apiError.correlationId}` : ''}`
    });
    return apiError;
  }

  function requireClient(): FmcgApiClient {
    if (!client) {
      throw new Error('Authentication is required.');
    }
    return client;
  }

  function requireTenantId(): string {
    if (!tenantId) {
      throw new Error('A tenant must be selected.');
    }
    return tenantId;
  }

  const value: ApplicationContextValue = {
    runtime: applicationRuntime,
    status,
    authentication,
    tenants,
    tenantId,
    session,
    data,
    error,
    busyAction,
    refreshing,
    notice,
    hasPermission: (permission) => session?.permissions.includes(permission) ?? false,
    authenticateDevelopment,
    authenticateOidc,
    signOut,
    retry,
    selectTenant,
    bootstrapDevelopment,
    onboardTenant,
    refreshAll,
    dismissNotice: () => setNotice(null),
    createProduct: (input) => runMutation(
      'Creating product',
      'Product created',
      `${input.name} is available in the tenant catalog.`,
      (activeClient, activeTenantId) => activeClient.mutate<CreateProductResponse>(
        'POST', '/v1/master-data/products', input, activeTenantId, createIdempotencyKey('product-create')
      )
    ),
    createWarehouse: (input) => runMutation(
      'Creating warehouse',
      'Warehouse created',
      `${input.warehouseName} is ready for stock operations.`,
      (activeClient, activeTenantId) => activeClient.mutate<CreateWarehouseResponse>(
        'POST', '/v1/master-data/warehouses', input, activeTenantId, createIdempotencyKey('warehouse-create')
      )
    ),
    createParty: (input) => runMutation(
      'Creating party',
      'Business party created',
      `${input.name} is available to operational workflows.`,
      (activeClient, activeTenantId) => activeClient.mutate<CreatePartyResponse>(
        'POST', '/v1/master-data/parties', input, activeTenantId, createIdempotencyKey('party-create')
      )
    ),
    receiveStock: (input) => runMutation(
      'Receiving stock',
      'Stock received',
      `${input.quantityBase.toLocaleString()} base units were posted to the append-only ledger.`,
      (activeClient, activeTenantId) => activeClient.mutate<InventoryCommandResponse>(
        'POST', '/v1/inventory/receipts', input, activeTenantId, createIdempotencyKey('stock-receive')
      )
    ),
    transferStock: (input) => runMutation(
      'Transferring stock',
      'Stock transferred',
      'The balanced transfer pair was posted successfully.',
      (activeClient, activeTenantId) => activeClient.mutate<InventoryCommandResponse>(
        'POST', '/v1/inventory/transfers', input, activeTenantId, createIdempotencyKey('stock-transfer')
      )
    ),
    adjustStock: (input) => runMutation(
      'Adjusting stock',
      'Adjustment posted',
      'The controlled adjustment is now reflected in the ledger and balance projection.',
      (activeClient, activeTenantId) => activeClient.mutate<InventoryCommandResponse>(
        'POST', '/v1/inventory/adjustments', input, activeTenantId, createIdempotencyKey('stock-adjust')
      )
    ),
    quarantineStock: (input) => runMutation(
      'Quarantining stock',
      'Stock quarantined',
      'The selected quantity is no longer available for allocation.',
      (activeClient, activeTenantId) => activeClient.mutate<InventoryCommandResponse>(
        'POST', '/v1/inventory/quarantine', input, activeTenantId, createIdempotencyKey('stock-quarantine')
      )
    ),
    releaseStock: (input) => runMutation(
      'Releasing stock',
      'Stock released',
      'The selected quantity returned to available inventory.',
      (activeClient, activeTenantId) => activeClient.mutate<InventoryCommandResponse>(
        'POST', '/v1/inventory/releases', input, activeTenantId, createIdempotencyKey('stock-release')
      )
    ),
    reverseMovement: (movementId, input) => runMutation(
      'Reversing movement',
      'Movement reversed',
      'A linked reversal entry was posted without editing history.',
      (activeClient, activeTenantId) => activeClient.mutate<InventoryCommandResponse>(
        'POST', `/v1/inventory/movements/${encodeURIComponent(movementId)}/reversal`, input, activeTenantId,
        createIdempotencyKey('movement-reverse')
      )
    ),
    planFefo: async (variantId, quantityBase, warehouseId) => {
      const activeClient = requireClient();
      const activeTenantId = requireTenantId();
      const query = new URLSearchParams({ variantId, quantityBase: String(quantityBase) });
      if (warehouseId) query.set('warehouseId', warehouseId);
      return activeClient.get<FefoResponse>(`/v1/inventory/fefo?${query.toString()}`, activeTenantId);
    },
    updateInventorySettings: (input) => runMutation(
      'Updating inventory settings',
      'Aging buckets updated',
      'Expiry reporting now uses the new tenant configuration.',
      (activeClient, activeTenantId) => activeClient.mutate<UpdateInventorySettingsResponse>(
        'PUT', '/v1/inventory/settings', input, activeTenantId, createIdempotencyKey('inventory-settings')
      )
    ),
    decideApproval: (requestId, input) => runMutation(
      input.decision === 'approve' ? 'Approving request' : 'Rejecting request',
      input.decision === 'approve' ? 'Request approved' : 'Request rejected',
      'The immutable approval record and execution state were refreshed.',
      (activeClient, activeTenantId) => activeClient.mutate<DecideApprovalRequestResponse>(
        'POST', `/v1/approvals/${encodeURIComponent(requestId)}/decisions`, input, activeTenantId,
        createIdempotencyKey('approval-decision')
      )
    ),
    inviteMember: (input) => runMutation(
      'Inviting team member',
      'Invitation created',
      `An invitation was created for ${input.email}.`,
      (activeClient, activeTenantId) => activeClient.mutate<CreateInvitationResponse>(
        'POST', '/v1/admin/invitations', input, activeTenantId, createIdempotencyKey('member-invite')
      )
    ),
    updateMember: (userId, input) => runMutation(
      'Updating member',
      'Member access updated',
      'The membership status and assigned roles were refreshed.',
      (activeClient, activeTenantId) => activeClient.mutate<UpdateMembershipResponse>(
        'PATCH', `/v1/admin/members/${encodeURIComponent(userId)}`, input, activeTenantId,
        createIdempotencyKey('member-update')
      )
    ),
    revokeInvitation: (invitationId) => runMutation(
      'Revoking invitation',
      'Invitation revoked',
      'The acceptance token can no longer be used.',
      (activeClient, activeTenantId) => activeClient.mutate<RevokeInvitationResponse>(
        'DELETE', `/v1/admin/invitations/${encodeURIComponent(invitationId)}`, {}, activeTenantId,
        createIdempotencyKey('invitation-revoke')
      )
    )
  };

  return <ApplicationContext.Provider value={value}>{children}</ApplicationContext.Provider>;
}

export function useApplication(): ApplicationContextValue {
  const context = useContext(ApplicationContext);
  if (!context) {
    throw new Error('useApplication must be used within ApplicationProvider.');
  }
  return context;
}

function loadAuthentication(): ClientAuthentication | null {
  if (applicationRuntime.authenticationMode === 'development') {
    const stored = localStorage.getItem(DEVELOPMENT_AUTH_STORAGE);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as Partial<ClientAuthentication>;
        if (
          parsed.mode === 'development' &&
          typeof parsed.subject === 'string' &&
          typeof parsed.email === 'string' &&
          typeof parsed.displayName === 'string'
        ) {
          return {
            mode: 'development',
            subject: parsed.subject,
            email: parsed.email,
            displayName: parsed.displayName
          };
        }
      } catch {
        localStorage.removeItem(DEVELOPMENT_AUTH_STORAGE);
      }
    }
    return {
      mode: 'development',
      subject: 'local-admin',
      email: 'alex@fmcgbyalex.com',
      displayName: 'Alex de Vries'
    };
  }

  const accessToken = sessionStorage.getItem(OIDC_TOKEN_STORAGE)?.trim();
  return accessToken ? { mode: 'oidc', accessToken } : null;
}

function clearPersistedAuthentication(): void {
  localStorage.removeItem(DEVELOPMENT_AUTH_STORAGE);
  sessionStorage.removeItem(OIDC_TOKEN_STORAGE);
}

function toApiError(caught: unknown): ApiError {
  if (caught instanceof ApiError) return caught;
  return new ApiError(
    0,
    {
      type: 'https://fmcgbyalex.com/problems/client-error',
      title: 'The operation could not be completed',
      status: 0,
      detail: caught instanceof Error ? caught.message : 'An unexpected client error occurred.'
    },
    null
  );
}
