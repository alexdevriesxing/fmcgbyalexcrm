import type { ProblemDetails } from '@fmcgbyalex/contracts';
import type { ApplicationRuntime } from './runtime';

export type ClientAuthentication =
  | Readonly<{
      mode: 'development';
      subject: string;
      email: string;
      displayName: string;
    }>
  | Readonly<{
      mode: 'oidc';
      accessToken: string;
    }>;

export type ApiRequestOptions = Readonly<{
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  tenantId?: string;
  idempotencyKey?: string;
  body?: unknown;
  signal?: AbortSignal;
}>;

export class ApiError extends Error {
  readonly status: number;
  readonly problem: ProblemDetails;
  readonly correlationId: string | null;

  constructor(status: number, problem: ProblemDetails, correlationId: string | null) {
    super(problem.detail ?? problem.title);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
    this.correlationId = correlationId;
  }
}

export class FmcgApiClient {
  readonly runtime: ApplicationRuntime;
  readonly authentication: ClientAuthentication;

  constructor(runtime: ApplicationRuntime, authentication: ClientAuthentication) {
    this.runtime = runtime;
    this.authentication = authentication;
  }

  async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const headers = new Headers({ Accept: 'application/json' });
    headers.set('X-Correlation-Id', `web-${crypto.randomUUID()}`);

    if (this.authentication.mode === 'development') {
      headers.set('X-Dev-Identity-Subject', this.authentication.subject);
      headers.set('X-Dev-Identity-Email', this.authentication.email);
      headers.set('X-Dev-Identity-Name', this.authentication.displayName);
    } else {
      headers.set('Authorization', `Bearer ${this.authentication.accessToken}`);
    }

    if (options.tenantId) {
      headers.set('X-Tenant-Id', options.tenantId);
    }
    if (options.idempotencyKey) {
      headers.set('Idempotency-Key', options.idempotencyKey);
    }
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }

    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers,
      credentials: 'include'
    };
    if (options.body !== undefined) {
      init.body = JSON.stringify(options.body);
    }
    if (options.signal) {
      init.signal = options.signal;
    }

    let response: Response;
    try {
      response = await fetch(`${this.runtime.apiBaseUrl}${normalizePath(path)}`, init);
    } catch (error) {
      throw new ApiError(
        0,
        {
          type: 'https://fmcgbyalex.com/problems/network-unavailable',
          title: 'The API could not be reached',
          status: 0,
          detail: error instanceof Error ? error.message : 'Check the API URL and network connection.'
        },
        null
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const correlationId = response.headers.get('X-Correlation-Id');
    const contentType = response.headers.get('Content-Type') ?? '';
    const payload = contentType.includes('application/json')
      ? ((await response.json()) as unknown)
      : await response.text();

    if (!response.ok) {
      const problem = isProblemDetails(payload)
        ? payload
        : {
            type: 'https://fmcgbyalex.com/problems/request-failed',
            title: `Request failed with status ${response.status}`,
            status: response.status,
            ...(typeof payload === 'string' && payload ? { detail: payload } : {})
          };
      throw new ApiError(response.status, problem, correlationId);
    }

    return payload as T;
  }

  get<T>(path: string, tenantId?: string): Promise<T> {
    return this.request<T>(path, tenantId ? { tenantId } : {});
  }

  mutate<T>(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
    tenantId?: string,
    idempotencyKey?: string
  ): Promise<T> {
    return this.request<T>(path, {
      method,
      body,
      ...(tenantId ? { tenantId } : {}),
      ...(idempotencyKey ? { idempotencyKey } : {})
    });
  }
}

export function createIdempotencyKey(scope: string): string {
  return `web:${scope}:${crypto.randomUUID()}`;
}

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function isProblemDetails(value: unknown): value is ProblemDetails {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.type === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.status === 'number'
  );
}
