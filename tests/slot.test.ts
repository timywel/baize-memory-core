// tests/slot.test.ts
// BaizeSlot 适配层测试 — load / init / handle / unload + 错误路径
// 注: slot.ts 走 ~/.baize/memory/<profileId>, 测试时通过改 HOME 隔离

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSlot, type SlotManifest, type SlotContext } from '../src/slot.js';

let tmpDir: string;
let originalHome: string;
let busListeners: Map<string, Array<(e: unknown) => void>>;
let metricsCounters: Array<{ name: string; value?: number; tags?: Record<string, string> }>;
let metricsHistograms: Array<{ name: string; value: number; tags?: Record<string, string> }>;
let logs: Array<{ level: string; msg: string; meta?: Record<string, unknown> }>;
let configStore: Map<string, unknown>;
let emittedEvents: Array<{ event: string; payload: unknown }>;

function makeContext(overrides: Partial<{ profileId: string }> = {}): SlotContext {
  busListeners = new Map();
  metricsCounters = [];
  metricsHistograms = [];
  logs = [];
  configStore = new Map([['profileId', overrides.profileId ?? 'test-profile']]);
  emittedEvents = [];
  return {
    slotId: 'baize-memory-core',
    bus: {
      on: (event, listener) => {
        if (!busListeners.has(event)) busListeners.set(event, []);
        busListeners.get(event)!.push(listener as (e: unknown) => void);
        return () => {
          const arr = busListeners.get(event);
          if (arr) {
            const i = arr.indexOf(listener as (e: unknown) => void);
            if (i >= 0) arr.splice(i, 1);
          }
        };
      },
      off: () => {},
      emit: (event, payload) => { emittedEvents.push({ event, payload }); },
    },
    config: {
      get: <T = unknown>(key: string, def?: T): T => (configStore.has(key) ? (configStore.get(key) as T) : (def as T)),
      set: async (key, val) => { configStore.set(key, val); },
    },
    logger: {
      debug: (msg, meta) => { logs.push({ level: 'debug', msg, meta }); },
      info: (msg, meta) => { logs.push({ level: 'info', msg, meta }); },
      warn: (msg, meta) => { logs.push({ level: 'warn', msg, meta }); },
      error: (msg, meta) => { logs.push({ level: 'error', msg, meta }); },
    },
    metrics: {
      counter: (name, value, tags) => { metricsCounters.push({ name, value, tags }); },
      histogram: (name, value, tags) => { metricsHistograms.push({ name, value, tags }); },
    },
  };
}

function makeManifest(): SlotManifest {
  return {
    id: 'baize-memory-core',
    version: '0.3.0',
    type: 'process',
    entry: { process: './src/slot.ts' },
    capabilities: ['memory.episode.commit', 'memory.episode.recall', 'memory.semantic.search', 'memory.procedural.load'],
    subscribes: ['chat.message.done', 'chat.agent.status'],
    healthDegradedMs: 30000,
    healthUnhealthyMs: 60000,
  };
}

beforeEach(() => {
  originalHome = process.env.HOME || '';
  tmpDir = mkdtempSync(join(tmpdir(), 'baize-slot-test-'));
  process.env.HOME = tmpDir;
});

afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  process.env.HOME = originalHome;
});

describe('MemoryCoreSlot', () => {
  it('load: 校验 4 个 capability, 缺一抛错', async () => {
    const slot = createSlot({ ...makeManifest(), capabilities: ['memory.episode.commit'] });
    const ctx = makeContext();
    await expect(slot.load(ctx, { ...makeManifest(), capabilities: ['memory.episode.commit'] }))
      .rejects.toThrow(/缺少 capability/);
  });

  it('load: 完整 manifest 接受, 不抛错', async () => {
    const slot = createSlot(makeManifest());
    const ctx = makeContext();
    await expect(slot.load(ctx, makeManifest())).resolves.toBeUndefined();
    expect(logs.some(l => l.msg === 'memory-core slot loaded')).toBe(true);
  });

  it('init: 初始化 service, 订阅 2 个事件, 上报 metrics', async () => {
    const slot = createSlot(makeManifest());
    const ctx = makeContext({ profileId: 'alice' });
    await slot.load(ctx, makeManifest());
    await slot.init();
    expect(busListeners.get('chat.message.done')?.length).toBe(1);
    expect(busListeners.get('chat.agent.status')?.length).toBe(1);
    expect(metricsCounters.some(c => c.name === 'memory_core.slot.initialized')).toBe(true);
  });

  it('handle: memory.episode.commit 写 episodic + emit memory.episode.committed', async () => {
    const slot = createSlot(makeManifest());
    const ctx = makeContext({ profileId: 'alice' });
    await slot.load(ctx, makeManifest());
    await slot.init();
    const res = await slot.handle!({
      route: 'memory.episode.commit',
      requestId: 'r1',
      body: { content: 'hello world', metadata: { src: 'test' } },
    });
    expect(res.status).toBe(200);
    expect((res.body as { episode_id: string }).episode_id).toBeTruthy();
    expect(emittedEvents[0]?.event).toBe('memory.episode.committed');
    expect(metricsCounters.some(c => c.name === 'memory_core.episode.commit')).toBe(true);
  });

  it('handle: memory.episode.recall 检索 episodic 层', async () => {
    const slot = createSlot(makeManifest());
    const ctx = makeContext({ profileId: 'alice' });
    await slot.load(ctx, makeManifest());
    await slot.init();
    await slot.handle!({ route: 'memory.episode.commit', requestId: 'r0', body: { content: '白泽记忆系统' } });
    const res = await slot.handle!({ route: 'memory.episode.recall', requestId: 'r1', body: { query: '白泽' } });
    expect(res.status).toBe(200);
    expect((res.body as { entries: unknown[] }).entries.length).toBeGreaterThan(0);
  });

  it('handle: 未知 route 返回 400 INVALID_REQUEST', async () => {
    const slot = createSlot(makeManifest());
    const ctx = makeContext();
    await slot.load(ctx, makeManifest());
    await slot.init();
    const res = await slot.handle!({ route: 'unknown.route', requestId: 'r1', body: {} });
    expect(res.status).toBe(400);
    expect(res.error?.code).toBe('INVALID_REQUEST');
  });

  it('handle: 未初始化时返回 503', async () => {
    const slot = createSlot(makeManifest());
    const ctx = makeContext();
    await slot.load(ctx, makeManifest());
    // 跳过 init
    const res = await slot.handle!({ route: 'memory.episode.commit', requestId: 'r1', body: { content: 'x' } });
    expect(res.status).toBe(503);
  });

  it('unload: 幂等, 取消订阅, 健康降为 stopped', async () => {
    const slot = createSlot(makeManifest());
    const ctx = makeContext({ profileId: 'alice' });
    await slot.load(ctx, makeManifest());
    await slot.init();
    await slot.unload();
    await slot.unload(); // 二次调用不抛错
    expect(busListeners.get('chat.message.done')?.length ?? 0).toBe(0);
    const h = await slot.health();
    expect(h.status).toBe('stopped');
  });

  it('health: active 时返回 healthy', async () => {
    const slot = createSlot(makeManifest());
    const ctx = makeContext({ profileId: 'alice' });
    await slot.load(ctx, makeManifest());
    await slot.init();
    const h = await slot.health();
    expect(h.status).toBe('healthy');
    expect(h.detail?.profileId).toBe('alice');
  });
});