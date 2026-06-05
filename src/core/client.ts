// src/core/client.ts
// BaiZeMemoryCore 主类：组合所有子服务，对外暴露 4 层 API + slots + heartbeat + dreaming + compaction + external

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { LayerStorage, type Layer, type MemoryEntry } from './layers.js';
import { SnapshotManager, type FrozenSnapshot } from './snapshot.js';
import { BM25 } from '../retrieval/bm25.js';
import { rrfFuse, mmr } from '../retrieval/ranker.js';
import { MemoryTool } from '../ingestion/memory-tool.js';
import { HeartbeatService } from '../heartbeat/heartbeat-service.js';
import { DreamingAdapter, type ExistingDreamingService } from '../dreaming/dreaming-adapter.js';
import { CompactionService } from '../compaction/compaction-entry.js';
import { createProvider, type ExternalMemoryProvider } from '../external/provider.js';
import { logger } from '../util/logger.js';

const log = logger('memory-core');

export type SlotName = 'persona' | 'user_preferences' | 'tool_guidelines' | 'project_context' | 'pending_items' | 'session_patterns' | 'self_notes';

export interface CoreConfig {
  profileId: string;
  basePath: string;
  curatedMemory?: {
    memorySoftLimit?: number;
    memoryHardLimit?: number;
    sharedLimit?: number;
    frozenSnapshot?: boolean;
  };
  heartbeat?: {
    enabled: boolean;
    intervalMs: number;
  };
  existingDreamingService?: ExistingDreamingService;  // 适配 baize 现有 BaiZeDreamingService
}

export interface BaiZeMemoryCore {
  /* 4 层 API */
  addWorkingMemory(content: string, metadata?: Record<string, unknown>): Promise<string>;
  addEpisodicMemory(content: string, metadata?: Record<string, unknown>): Promise<string>;
  addSemanticMemory(content: string, metadata?: Record<string, unknown>): Promise<string>;
  addProceduralMemory(content: string, metadata?: Record<string, unknown>): Promise<string>;

  /* 检索 */
  searchMemories(query: string, options?: { layer?: Layer | 'all'; limit?: number; includeShared?: boolean }): Promise<MemoryEntry[]>;
  getContext(options?: { includeShared?: boolean; budgetChars?: number }): Promise<string>;

  /* 借鉴 hermes 双阶段管线 */
  prefetchAll(): Promise<void>;
  syncAll(): Promise<void>;
  getSnapshot(): FrozenSnapshot | null;

  /* 借鉴 hermes memory 工具 */
  memoryTool(): MemoryTool;

  /* Slots (API 兼容) */
  getSlot(name: SlotName | string): Promise<string | null>;
  setSlot(name: SlotName | string, content: string): Promise<void>;

  /* 共享层 (API 兼容) */
  addSharedSemantic(fact: string, metadata?: Record<string, unknown>): Promise<string>;
  addSharedProcedural(procedure: string, metadata?: Record<string, unknown>): Promise<string>;
  searchSharedMemories(query: string, options?: { layer?: 'semantic' | 'procedural'; limit?: number }): Promise<MemoryEntry[]>;

  /* 心跳/做梦/压缩/外部 */
  heartbeat(): HeartbeatService;
  startHeartbeat(): NodeJS.Timeout;
  stopHeartbeat(): void;
  dreaming(): DreamingAdapter;
  compact(): CompactionService;
  external(): ExternalMemoryProvider;

  /* 生命周期 */
  onSessionStart(): Promise<void>;
  onSessionEnd(): Promise<void>;
}

const SHARED_BASE = '~/.baize/memory/shared';  // 跨 profile 共享（与 baize 现有兼容）

export function createBaiZeMemoryCore(config: CoreConfig): BaiZeMemoryCore {
  const {
    profileId,
    basePath,
    curatedMemory: cm = {},
    heartbeat: hb = { enabled: true, intervalMs: 5 * 60 * 1000 },
    existingDreamingService,
  } = config;

  const memorySoftLimit = cm.memorySoftLimit ?? 4000;
  const memoryHardLimit = cm.memoryHardLimit ?? 8000;
  const sharedLimit = cm.sharedLimit ?? 4000;
  const frozenSnapshotEnabled = cm.frozenSnapshot ?? true;

  // 4 层 storage
  const working = new LayerStorage(basePath, 'working');
  const episodic = new LayerStorage(basePath, 'episodic');
  const semantic = new LayerStorage(basePath, 'semantic');
  const procedural = new LayerStorage(basePath, 'procedural');

  // 共享层（跨 profile）
  const sharedBase = SHARED_BASE.replace('~', process.env.HOME || '/root');
  const sharedSemantic = new LayerStorage(sharedBase, 'semantic');
  const sharedProcedural = new LayerStorage(sharedBase, 'procedural');

  // frozen snapshot
  const snapshot = new SnapshotManager({ maxChars: memoryHardLimit });

  // memory tool（指向 semantic/memory.md 和 semantic/shared.md）
  const memoryMdPath = path.join(basePath, 'semantic', 'memory.md');
  const sharedMdPath = path.join(basePath, 'semantic', 'shared.md');
  const tool = new MemoryTool(memoryMdPath);
  const sharedTool = new MemoryTool(sharedMdPath);

  // 检索
  const bm25 = new BM25();

  // external provider
  const external = createProvider({ type: 'noop' });

  // 辅助：把 MemoryEntry[] 加载到 BM25
  async function loadBm25(entries: MemoryEntry[]): Promise<void> {
    for (const e of entries) {
      bm25.addDocument({ id: e.id, content: e.content, metadata: e.metadata });
    }
  }

  // heartbeat
  const heartbeatService = new HeartbeatService(
    {
      getWorkingStorage: () => working,
      getMemoryMd: () => tool.readCached(),
      getSharedMd: () => sharedTool.readCached(),
      getContextTokenRatio: () => 0,
    },
    { intervalMs: hb.intervalMs, triggers: { workingCount: 50, memoryHardLimit, staleHours: 24 } }
  );

  // dreaming
  const dreamingAdapter = existingDreamingService
    ? new DreamingAdapter({
        inner: existingDreamingService,
        heartbeat: heartbeatService,
        getMemoryMd: () => tool.readCached(),  // 缓存读取，无 IO
        syncAll: syncAll,
      })
    : null;

  // compaction
  const compactionService = new CompactionService();

  /* Slots (支持 scope 路由：user_preferences/self_notes → 全局) */
  const GLOBAL_SLOTS = new Set(['user_preferences', 'self_notes']);
  const globalSlotsDir = path.join(process.env.HOME || '/root', '.baize', 'memory', 'slots');

  function slotDir(name: string): string {
    if (GLOBAL_SLOTS.has(name)) {
      return globalSlotsDir;
    }
    return path.join(basePath, 'slots');
  }

  async function prefetchAll(): Promise<void> {
    // 1. 读所有 4 层 + shared → 加载 BM25
    const allEntries = [
      ...(await working.readAll()),
      ...(await episodic.readAll()),
      ...(await semantic.readAll()),
      ...(await procedural.readAll()),
    ];
    await loadBm25(allEntries);

    // 2. 读 memory.md + shared.md + slots
    const memoryMd = await tool.read();
    const sharedMd = await sharedTool.read();
    const slots: Record<string, string> = {};
    const slotsDir = path.join(basePath, 'slots');
    try {
      const files = await fs.readdir(slotsDir);
      for (const f of files) {
        if (f.endsWith('.md')) {
          const name = f.replace(/\.md$/, '');
          slots[name] = await fs.readFile(path.join(slotsDir, f), 'utf-8');
        }
      }
    } catch { /* 目录不存在 */ }

    // 3. 冻结 snapshot (如果启用)
    if (frozenSnapshotEnabled) {
      snapshot.capture({ memoryMd, sharedMd, slots });
    }
  }

  async function syncAll(): Promise<void> {
    // working → semantic/memory.md (按规则)
    const workingEntries = await working.readAll();
    if (workingEntries.length > 0) {
      const summary = workingEntries.map(e => `- ${e.content}`).join('\n');
      await tool.add(summary);
    }
    // 重新冻结 snapshot
    await prefetchAll();
  }

  return {
    /* 4 层 API */
    addWorkingMemory: (content, metadata) => working.write(content, metadata),
    addEpisodicMemory: (content, metadata) => episodic.write(content, metadata),
    addSemanticMemory: (content, metadata) => semantic.write(content, metadata),
    addProceduralMemory: (content, metadata) => procedural.write(content, metadata),

    /* 检索 */
    async searchMemories(query, options = {}) {
      const { layer = 'all', limit = 20, includeShared = false } = options;
      const layers: Layer[] = layer === 'all'
        ? ['working', 'episodic', 'semantic', 'procedural']
        : [layer as Layer];

      const all: MemoryEntry[] = [];
      for (const l of layers) {
        const storage = l === 'working' ? working : l === 'episodic' ? episodic :
                        l === 'semantic' ? semantic : procedural;
        all.push(...(await storage.readAll()));
      }

      if (includeShared) {
        all.push(...(await sharedSemantic.readAll()));
        all.push(...(await sharedProcedural.readAll()));
      }

      // 重新加载 BM25（支持运行时新增条目）
      const fresh = new BM25();
      for (const e of all) {
        fresh.addDocument({ id: e.id, content: e.content, metadata: e.metadata });
      }
      const results = fresh.search(query, limit);
      // BM25Result → MemoryEntry (用查表保留 layer/createdAt)
      const lookup = new Map(all.map(e => [e.id, e]));
      return results.map(r => {
        const orig = lookup.get(r.id);
        return {
          id: r.id,
          content: r.content,
          layer: orig?.layer ?? 'semantic',
          metadata: { ...(orig?.metadata ?? {}), _score: r.score },
          createdAt: orig?.createdAt ?? new Date().toISOString(),
        };
      });
    },

    async getContext(options = {}) {
      const { includeShared = true, budgetChars = memorySoftLimit } = options;
      const prompt = snapshot.injectIntoPrompt();
      // 如果有 snapshot 直接用；否则 injectIntoPrompt 返回空
      if (prompt) {
        return prompt.slice(0, budgetChars);
      }
      // 无 snapshot → 临时生成
      const memoryMd = await tool.read();
      const sharedMd = includeShared ? await sharedTool.read() : '';
      const tmp = new SnapshotManager({ maxChars: memoryHardLimit });
      const slots: Record<string, string> = {};
      try {
        const slotsDir = path.join(basePath, 'slots');
        const files = await fs.readdir(slotsDir);
        for (const f of files) {
          if (f.endsWith('.md')) {
            slots[f.replace(/\.md$/, '')] = await fs.readFile(path.join(slotsDir, f), 'utf-8');
          }
        }
      } catch { /* 目录不存在 */ }
      tmp.capture({ memoryMd, sharedMd, slots });
      return tmp.injectIntoPrompt().slice(0, budgetChars);
    },

    prefetchAll,
    syncAll,
    getSnapshot: () => snapshot.getCurrent(),

    memoryTool: () => tool,

    /* Slots (支持 scope 路由) */
    async getSlot(name) {
      try {
        return await fs.readFile(path.join(slotDir(name), `${name}.md`), 'utf-8');
      } catch {
        return null;
      }
    },

    async setSlot(name, content) {
      const dir = slotDir(name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${name}.md`), content, 'utf-8');
    },

    /* 共享层 */
    addSharedSemantic: (fact, metadata) => sharedSemantic.write(fact, metadata),
    addSharedProcedural: (procedure, metadata) => sharedProcedural.write(procedure, metadata),

    async searchSharedMemories(query, options = {}) {
      const { layer = 'semantic', limit = 20 } = options;
      const all: MemoryEntry[] = [];
      if (layer === 'semantic') {
        all.push(...(await sharedSemantic.readAll()));
      } else if (layer === 'procedural') {
        all.push(...(await sharedProcedural.readAll()));
      }
      const fresh = new BM25();
      for (const e of all) {
        fresh.addDocument({ id: e.id, content: e.content, metadata: e.metadata });
      }
      const results = fresh.search(query, limit);
      const lookup = new Map(all.map(e => [e.id, e]));
      return results.map(r => {
        const orig = lookup.get(r.id);
        return {
          id: r.id,
          content: r.content,
          layer: orig?.layer ?? (layer === 'procedural' ? 'procedural' : 'semantic'),
          metadata: { ...(orig?.metadata ?? {}), _score: r.score, _shared: true },
          createdAt: orig?.createdAt ?? new Date().toISOString(),
        };
      });
    },

    heartbeat: () => heartbeatService,
    startHeartbeat: () => hb.enabled ? heartbeatService.start() : (setTimeout(() => {}, 0) as unknown as NodeJS.Timeout),
    stopHeartbeat: () => heartbeatService.stop(),

    dreaming: () => {
      if (!dreamingAdapter) {
        throw new Error('DreamingAdapter not configured: pass existingDreamingService in CoreConfig');
      }
      return dreamingAdapter;
    },

    compact: () => compactionService,
    external: () => external,

    async onSessionStart() {
      await prefetchAll();
      if (hb.enabled) heartbeatService.start();
    },

    async onSessionEnd() {
      await syncAll();
      heartbeatService.stop();
    },
  };
}
