import type { ApiErrorBody, ApiSuccess } from '@jobsentinel/types';
import { publicEnv } from '@/lib/env';

/** Thrown for any non-2xx API response; `code` matches docs/architecture/03-api-contract.md. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl?: string;
  /** Returns the current Supabase access token, or null when logged out. */
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | string[] | undefined>;
  signal?: AbortSignal;
}

/**
 * Minimal typed client over the API envelope (`{ data, meta }` / `{ error }`).
 * Hooks in `hooks/` wrap this with TanStack Query; components never call fetch directly.
 */
export function createApiClient(opts: ApiClientOptions) {
  const baseUrl = (opts.baseUrl ?? publicEnv.apiBaseUrl).replace(/\/$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function request<T>(path: string, ro: RequestOptions = {}): Promise<ApiSuccess<T>> {
    const url = new URL(`${baseUrl}/api/v1${path}`);
    for (const [k, v] of Object.entries(ro.query ?? {})) {
      if (v === undefined) continue;
      if (Array.isArray(v)) v.forEach((item) => url.searchParams.append(k, item));
      else url.searchParams.set(k, String(v));
    }
    const token = await opts.getToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (ro.body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await fetchImpl(url, {
      method: ro.method ?? 'GET',
      headers,
      body: ro.body === undefined ? undefined : JSON.stringify(ro.body),
      signal: ro.signal,
    });

    if (res.status === 204) return { data: undefined as T };
    const json = (await res.json().catch(() => null)) as ApiSuccess<T> | ApiErrorBody | null;
    if (!res.ok) {
      const err = json && 'error' in json ? json.error : undefined;
      throw new ApiError(
        res.status,
        err?.code ?? 'HTTP_ERROR',
        err?.message ?? res.statusText,
        err?.details,
        err?.requestId,
      );
    }
    if (!json || !('data' in json))
      throw new ApiError(res.status, 'MALFORMED_RESPONSE', 'Missing data envelope');
    return json;
  }

  /** multipart upload (resumes). Content-Type is set by the browser from the FormData boundary. */
  async function upload<T>(path: string, form: FormData): Promise<ApiSuccess<T>> {
    const token = await opts.getToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetchImpl(`${baseUrl}/api/v1${path}`, {
      method: 'POST',
      headers,
      body: form,
    });
    const json = (await res.json().catch(() => null)) as ApiSuccess<T> | ApiErrorBody | null;
    if (!res.ok) {
      const err = json && 'error' in json ? json.error : undefined;
      throw new ApiError(
        res.status,
        err?.code ?? 'HTTP_ERROR',
        err?.message ?? res.statusText,
        err?.details,
        err?.requestId,
      );
    }
    if (!json || !('data' in json))
      throw new ApiError(res.status, 'MALFORMED_RESPONSE', 'Missing data envelope');
    return json;
  }

  return {
    upload,
    get: <T>(path: string, query?: RequestOptions['query'], signal?: AbortSignal) =>
      request<T>(path, { query, signal }),
    post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
    put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
    patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
