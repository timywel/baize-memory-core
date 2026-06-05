// tests/external.test.ts
// 关键测试：NoopProvider + RestProvider + 401/403 + 重试 + 工厂

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NoopProvider, RestProvider, createProvider } from '../src/external/provider';

describe('NoopProvider', () => {
  it('search returns empty array', async () => {
    const p = new NoopProvider();
    expect(await p.search('anything', 10)).toEqual([]);
  });

  it('write is noop', async () => {
    const p = new NoopProvider();
    await expect(p.write('content')).resolves.toBeUndefined();
  });
});

describe('RestProvider', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('search calls /memory/search with Bearer auth', async () => {
    const mockFetch = vi.fn(async () => new Response(JSON.stringify({ results: [{ id: '1', content: 'foo', score: 0.9 }] }), { status: 200 }));
    globalThis.fetch = mockFetch as any;
    const p = new RestProvider({ baseUrl: 'https://api.example.com', apiKey: 'test-key' });
    const results = await p.search('query', 5);
    expect(results).toEqual([{ id: '1', content: 'foo', score: 0.9 }]);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.example.com/memory/search');
    expect((init as any).headers.Authorization).toBe('Bearer test-key');
  });

  it('omits Authorization when no apiKey', async () => {
    const mockFetch = vi.fn(async () => new Response('{"results":[]}', { status: 200 }));
    globalThis.fetch = mockFetch as any;
    const p = new RestProvider({ baseUrl: 'https://api.example.com' });
    await p.search('q', 5);
    const [, init] = mockFetch.mock.calls[0];
    expect((init as any).headers.Authorization).toBeUndefined();
  });

  it('throws immediately on 401 (no retry)', async () => {
    const mockFetch = vi.fn(async () => new Response('Unauthorized', { status: 401 }));
    globalThis.fetch = mockFetch as any;
    const p = new RestProvider({ baseUrl: 'https://api.example.com', apiKey: 'bad' });
    await expect(p.search('q', 5)).rejects.toThrow('auth failed');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws on 403 (no retry)', async () => {
    const mockFetch = vi.fn(async () => new Response('Forbidden', { status: 403 }));
    globalThis.fetch = mockFetch as any;
    const p = new RestProvider({ baseUrl: 'https://api.example.com' });
    await expect(p.search('q', 5)).rejects.toThrow('auth failed');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on network failure then succeeds', async () => {
    let calls = 0;
    const mockFetch = vi.fn(async () => {
      calls++;
      if (calls < 2) throw new Error('network down');
      return new Response('{"results":[]}', { status: 200 });
    });
    globalThis.fetch = mockFetch as any;
    const p = new RestProvider({ baseUrl: 'https://api.example.com', maxRetries: 3, retryDelayMs: 10 });
    const results = await p.search('q', 5);
    expect(results).toEqual([]);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries', async () => {
    const mockFetch = vi.fn(async () => { throw new Error('always fails'); });
    globalThis.fetch = mockFetch as any;
    const p = new RestProvider({ baseUrl: 'https://api.example.com', maxRetries: 1, retryDelayMs: 10 });
    await expect(p.search('q', 5)).rejects.toThrow('always fails');
    expect(mockFetch).toHaveBeenCalledTimes(2);  // initial + 1 retry
  });
});

describe('createProvider factory', () => {
  it('returns NoopProvider for type=noop', () => {
    expect(createProvider({ type: 'noop' })).toBeInstanceOf(NoopProvider);
  });

  it('returns RestProvider for type=rest', () => {
    expect(createProvider({ type: 'rest', baseUrl: 'https://x' })).toBeInstanceOf(RestProvider);
  });

  it('throws when rest missing baseUrl', () => {
    expect(() => createProvider({ type: 'rest' })).toThrow('baseUrl');
  });
});
