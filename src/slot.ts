// Copyright (c) 2026 Tim Ywel
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * src/slot.ts
 *
 * baize-memory-core 的 BaizeSlot 适配层.
 * 把 createBaiZeMemoryCore() 包装成 4 个 capability 的路由:
 *   - memory.episode.commit       → addEpisodicMemory
 *   - memory.episode.recall       → searchMemories (episodic 层)
 *   - memory.semantic.search      → searchMemories (semantic 层 + shared)
 *   - memory.procedural.load      → searchMemories (procedural 层)
 *
 * 关联:
 * - baize-loop/meta/slot-api/types.ts (BaizeSlot 契约)
 * - plan/baize-chat/17-full-specification.md §7.0 (三 Slot 协作)
 * - plan/baize-chat/13-memory-core-upgrade-20260622-093256.md
 */

import * as path from 'node:path';
import { homedir } from 'node:os';
import { createBaiZeMemoryCore, type BaiZeMemoryCore } from './core/client.js';
import type { Layer, MemoryEntry } from './core/layers.js';

/**
 * BaizeSlot 契约的类型本地副本 — 与 baize-loop/meta/slot-api/types.ts 保持结构一致.
 * 设计: 插槽自包含, 不在编译期依赖 baize-loop 仓库 (跨仓).
 * 主控加载器在运行时按结构匹配校验, 不依赖 TS 类型.
 */

export interface SlotHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'stopped';
  lastCheckAt: string;
  latencyMs?: number;
  detail?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export interface SlotManifest {
  id: string;
  version: string;
  type: 'process' | 'http' | 'websocket';
  entry: { process?: string; http?: { baseUrl: string }; ws?: { url: string } };
  capabilities: string[];
  subscribes?: string[];
  healthDegradedMs?: number;
  healthUnhealthyMs?: number;
  allowBreakingVersion?: boolean;
}

export interface SlotContext {
  slotId: string;
  bus: {
    on(event: string, listener: (e: { event: string; ts: string; publisher: string; payload: unknown; correlation_id?: string }) => void): () => void;
    emit(event: string, payload: unknown, options?: { correlation_id?: string }): void;
    off(event: string, listener: (e: unknown) => void): void;
  };
  config: {
    get<T = unknown>(key: string, defaultValue?: T): T;
    set(key: string, value: unknown): Promise<void>;
  };
  logger: {
    debug(msg: string, meta?: Record<string, unknown>): void;
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
    error(msg: string, meta?: Record<string, unknown>): void;
  };
  metrics: {
    counter(name: string, value?: number, tags?: Record<string, string>): void;
    histogram(name: string, value: number, tags?: Record<string, string>): void;
  };
}

export interface SlotRequest {
  route: string;
  params?: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  requestId: string;
  auth?: { userId: string; token: string; roles?: string[] };
  timeoutMs?: number;
}

export interface SlotResponse {
  status: number;
  body?: unknown;
  error?: { code: string; message: string; i18nKey?: string; detail?: unknown };
  latencyMs: number;
}

export interface BaizeSlot {
  readonly id: string;
  readonly version: string;
  readonly capabilities: readonly string[];
  load(ctx: SlotContext, manifest: SlotManifest): Promise<void>;
  init(): Promise<void>;
  handle?(request: SlotRequest): Promise<SlotResponse>;
  unload(): Promise<void>;
  health(): Promise<SlotHealthStatus>;
  onReload?(): Promise<void>;
}

const REQUIRED_CAPABILITIES = [
  'memory.episode.commit',
  'memory.episode.recall',
  'memory.semantic.search',
  'memory.procedural.load',
] as const;

const SUPPORTED_EVENTS = ['chat.message.done', 'chat.agent.status'] as const;

export class MemoryCoreSlot implements BaizeSlot {
  readonly id: string;
  readonly version: string;
  readonly capabilities: readonly string[];

  private ctx: SlotContext | null = null;
  private service: BaiZeMemoryCore | null = null;
  private subscriptions: Array<() => void> = [];
  private profileId = 'default';

  constructor(manifest: SlotManifest) {
    this.id = manifest.id;
    this.version = manifest.version;
    this.capabilities = manifest.capabilities;
  }

  async load(ctx: SlotContext, manifest: SlotManifest): Promise<void> {
    // 1. 校验 capabilities 完整性 (manifest 必须含全部 4 个能力)
    for (const cap of REQUIRED_CAPABILITIES) {
      if (!manifest.capabilities.includes(cap)) {
        throw new Error(`MemoryCoreSlot 缺少 capability: ${cap}`);
      }
    }
    this.ctx = ctx;
    ctx.logger.info('memory-core slot loaded', { id: this.id, version: this.version });
  }

  async init(): Promise<void> {
    if (!this.ctx) throw new Error('load() must be called before init()');
    // 1. 从 config 拿 profileId (主控注入), 缺省 'default'
    this.profileId = this.ctx.config.get<string>('profileId', 'default');

    // 2. 构造基础路径: ~/.baize/memory/<profileId>
    const basePath = path.join(homedir(), '.baize', 'memory', this.profileId);

    // 3. 初始化内部 MemoryService
    this.service = createBaiZeMemoryCore({
      profileId: this.profileId,
      basePath,
      heartbeat: { enabled: false, intervalMs: 5 * 60 * 1000 },
    });
    await this.service.prefetchAll();

    // 4. 订阅事件 (反向依赖: chat 事件触发记忆写入/读取)
    for (const evt of SUPPORTED_EVENTS) {
      const unsub = this.ctx.bus.on(evt, () => {
        // 占位: 真实逻辑由 chat 编排, 此处只做事件计数
        this.ctx?.metrics.counter(`memory_core.event.${evt}`);
      });
      this.subscriptions.push(unsub);
    }

    // 5. 上报 metrics
    this.ctx.metrics.counter('memory_core.slot.initialized');
    this.ctx.logger.info('memory-core slot initialized', { profileId: this.profileId });
  }

  async handle(request: SlotRequest): Promise<SlotResponse> {
    if (!this.service) {
      return this.err(503, 'UNKNOWN', 'service not initialized', request.requestId);
    }
    const t0 = Date.now();
    try {
      switch (request.route) {
        case 'memory.episode.commit':
          return await this.handleEpisodeCommit(request, t0);
        case 'memory.episode.recall':
          return await this.handleEpisodeRecall(request, t0);
        case 'memory.semantic.search':
          return await this.handleSemanticSearch(request, t0);
        case 'memory.procedural.load':
          return await this.handleProceduralLoad(request, t0);
        default:
          return this.err(400, 'INVALID_REQUEST', `unsupported route: ${request.route}`, request.requestId);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.ctx?.logger.error('memory-core handle failed', { route: request.route, err: msg });
      return this.err(500, 'UNKNOWN', msg, request.requestId, Date.now() - t0);
    }
  }

  private async handleEpisodeCommit(req: SlotRequest, t0: number): Promise<SlotResponse> {
    const body = (req.body ?? {}) as { content?: string; metadata?: Record<string, unknown> };
    if (!body.content) return this.err(400, 'INVALID_REQUEST', 'content required', req.requestId);
    const id = await this.service!.addEpisodicMemory(body.content, body.metadata);
    this.ctx?.metrics.counter('memory_core.episode.commit');
    this.ctx?.bus.emit('memory.episode.committed', {
      episode_id: id, user_id: this.profileId, content_preview: body.content.slice(0, 200),
    });
    return { status: 200, body: { episode_id: id }, latencyMs: Date.now() - t0 };
  }

  private async handleEpisodeRecall(req: SlotRequest, t0: number): Promise<SlotResponse> {
    const body = (req.body ?? {}) as { query: string; limit?: number };
    if (!body.query) return this.err(400, 'INVALID_REQUEST', 'query required', req.requestId);
    const entries = await this.service!.searchMemories(body.query, { layer: 'episodic', limit: body.limit ?? 10 });
    this.ctx?.metrics.histogram('memory_core.episode.recall.latency', Date.now() - t0);
    return { status: 200, body: { entries: this.serialize(entries) }, latencyMs: Date.now() - t0 };
  }

  private async handleSemanticSearch(req: SlotRequest, t0: number): Promise<SlotResponse> {
    const body = (req.body ?? {}) as { query: string; limit?: number; includeShared?: boolean };
    if (!body.query) return this.err(400, 'INVALID_REQUEST', 'query required', req.requestId);
    const entries = await this.service!.searchMemories(body.query, {
      layer: 'semantic', limit: body.limit ?? 10, includeShared: body.includeShared ?? true,
    });
    this.ctx?.metrics.histogram('memory_core.semantic.search.latency', Date.now() - t0);
    return { status: 200, body: { entries: this.serialize(entries) }, latencyMs: Date.now() - t0 };
  }

  private async handleProceduralLoad(req: SlotRequest, t0: number): Promise<SlotResponse> {
    const body = (req.body ?? {}) as { query: string; limit?: number };
    if (!body.query) return this.err(400, 'INVALID_REQUEST', 'query required', req.requestId);
    const entries = await this.service!.searchMemories(body.query, { layer: 'procedural', limit: body.limit ?? 10 });
    this.ctx?.metrics.histogram('memory_core.procedural.load.latency', Date.now() - t0);
    return { status: 200, body: { entries: this.serialize(entries) }, latencyMs: Date.now() - t0 };
  }

  async unload(): Promise<void> {
    // 幂等: 多次调用安全
    for (const unsub of this.subscriptions) {
      try { unsub(); } catch { /* ignore */ }
    }
    this.subscriptions = [];
    if (this.service) {
      this.service._destroy();
      this.service = null;
    }
    this.ctx?.logger.info('memory-core slot unloaded', { id: this.id });
  }

  async health(): Promise<SlotHealthStatus> {
    return {
      status: this.service ? 'healthy' : 'stopped',
      lastCheckAt: new Date().toISOString(),
      detail: { profileId: this.profileId, subscriptions: this.subscriptions.length },
    };
  }

  private serialize(entries: MemoryEntry[]) {
    return entries.map((e: MemoryEntry) => ({
      id: e.id, content: e.content, layer: e.layer as Layer, metadata: e.metadata ?? {}, createdAt: e.createdAt,
    }));
  }

  private err(status: number, code: 'INVALID_REQUEST' | 'UNKNOWN' | 'SLOT_INIT_FAILED', message: string, requestId: string, latencyMs = 0): SlotResponse {
    return { status, error: { code, message }, latencyMs, body: { requestId } };
  }
}

export function createSlot(manifest: SlotManifest): MemoryCoreSlot {
  return new MemoryCoreSlot(manifest);
}
