// src/external/provider.ts
// 借鉴 hermes 单一可插拔 provider 抽象：NoopProvider（默认）+ RestProvider（云端）

import { logger } from '../util/logger.js';

const log = logger('external');

export interface ExternalMemoryProvider {
  search(query: string, limit: number): Promise<Array<{ id: string; content: string; score: number }>>;
  write(content: string, metadata?: Record<string, unknown>): Promise<void>;
}

export class NoopProvider implements ExternalMemoryProvider {
  async search(): Promise<Array<{ id: string; content: string; score: number }>> {
    return [];
  }
  async write(): Promise<void> {
    // noop
  }
}

export interface RestProviderOptions {
  baseUrl: string;
  apiKey?: string;
  maxRetries?: number;       // 默认 2
  retryDelayMs?: number;     // 默认 500
  timeoutMs?: number;         // 默认 5000
}

export class RestProvider implements ExternalMemoryProvider {
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: RestProviderOptions) {
    this.maxRetries = options.maxRetries ?? 2;
    this.retryDelayMs = options.retryDelayMs ?? 500;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async search(query: string, limit: number): Promise<Array<{ id: string; content: string; score: number }>> {
    const url = `${this.options.baseUrl}/memory/search`;
    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ query, limit }),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error(`RestProvider auth failed: ${response.status}`);
      }
      throw new Error(`RestProvider search failed: ${response.status}`);
    }
    const data: any = await response.json();
    return (data.results ?? []).map((r: any) => ({
      id: r.id,
      content: r.content ?? '',
      score: r.score ?? 0,
    }));
  }

  async write(content: string, metadata?: Record<string, unknown>): Promise<void> {
    const url = `${this.options.baseUrl}/memory/write`;
    const response = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ content, metadata: metadata ?? {} }),
    });
    if (!response.ok) {
      throw new Error(`RestProvider write failed: ${response.status}`);
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.options.apiKey) {
      h['Authorization'] = `Bearer ${this.options.apiKey}`;
    }
    return h;
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          const response = await fetch(url, { ...init, signal: controller.signal });
          clearTimeout(timer);
          // 401/403 不重试（认证错误重试无意义）
          if (response.status === 401 || response.status === 403) {
            return response;
          }
          if (response.ok) return response;
          lastError = new Error(`HTTP ${response.status}`);
        } finally {
          clearTimeout(timer);
        }
      } catch (err) {
        lastError = err;
        log.warn(`attempt ${attempt + 1} failed:`, err);
      }
      if (attempt < this.maxRetries) {
        await new Promise(r => setTimeout(r, this.retryDelayMs * (attempt + 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error('fetch failed');
  }
}

export function createProvider(config: { type: 'noop' | 'rest'; baseUrl?: string; apiKey?: string }): ExternalMemoryProvider {
  if (config.type === 'rest') {
    if (!config.baseUrl) throw new Error('RestProvider requires baseUrl');
    return new RestProvider({ baseUrl: config.baseUrl, apiKey: config.apiKey });
  }
  return new NoopProvider();
}
