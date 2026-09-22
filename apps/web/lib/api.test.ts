import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './api';

function mockFetch(status: number, body: unknown) {
  return vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'x',
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe('createApiClient', () => {
  it('unwraps the data envelope and sends the bearer token + query params', async () => {
    const fetchImpl = mockFetch(200, { data: { id: 1 }, meta: { nextCursor: null } });
    const api = createApiClient({ baseUrl: 'http://x', getToken: async () => 'tok', fetchImpl });
    const res = await api.get<{ id: number }>('/jobs', {
      q: 'sde',
      category: ['SOFTWARE', 'DATA'],
    });
    expect(res.data).toEqual({ id: 1 });
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      URL,
      RequestInit,
    ];
    expect(url.toString()).toBe('http://x/api/v1/jobs?q=sde&category=SOFTWARE&category=DATA');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('maps error envelopes to ApiError', async () => {
    const fetchImpl = mockFetch(404, { error: { code: 'JOB_NOT_FOUND', message: 'nope' } });
    const api = createApiClient({ baseUrl: 'http://x', getToken: async () => null, fetchImpl });
    await expect(api.get('/jobs/1')).rejects.toMatchObject<Partial<ApiError>>({
      status: 404,
      code: 'JOB_NOT_FOUND',
    });
  });

  it('handles 204 No Content', async () => {
    const fetchImpl = mockFetch(204, null);
    const api = createApiClient({ baseUrl: 'http://x', getToken: async () => null, fetchImpl });
    await expect(api.delete('/jobs/1/save')).resolves.toEqual({ data: undefined });
  });
});
