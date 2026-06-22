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

// v3.2 B-3: SlotName 类型已删除
export type SlotName = never;

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

  /* Slots (v3.2 B-3 收口: 业务改走 addSemanticMemory) */
  // getSlot/setSlot 已删除, 减少 ATTACKER_PWNED 类攻击面

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
  _destroy(): void;  // v3 P9: SIGTERM cleanup
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

  // v3.2 B-3: slot 通道已删除, ATTACKER_PWNED 根除
  //   原 getSlot/setSlot/slotDir/isValidSlotName 全部移除
  //   业务改走 addSemanticMemory 写偏好事实

  async function prefetchAll(): Promise<void> {
    // 1. 读所有 4 层 + shared → 加载 BM25
    const allEntries = [
      ...(await working.readAll()),
      ...(await episodic.readAll()),
      ...(await semantic.readAll()),
      ...(await procedural.readAll()),
    ];
    await loadBm25(allEntries);

    // 2. 读 memory.md + shared.md (v3.2 B-3: slots 已删除)
    const memoryMd = await tool.read();
    const sharedMd = await sharedTool.read();

    // 3. 冻结 snapshot (如果启用)
    if (frozenSnapshotEnabled) {
      snapshot.capture({ memoryMd, sharedMd });
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
      // v3 P7 fix: 4 层 JSON 拼入 context, 不只 memory.md
      // 之前: 只读 memory.md (snapshot.injectIntoPrompt 或 tool.read) → 用户写入的 semantic/xxx.json 不被读到
      // 修复: 同时输出 memory.md + 4 层 JSON 最近内容 + shared
      const sections: string[] = [];

      // 1. memory.md (snapshot 或临时)
      const prompt = snapshot.injectIntoPrompt();
      if (prompt) {
        sections.push(prompt);
      } else {
        const memoryMd = await tool.read();
        if (memoryMd) sections.push(memoryMd);
        // v3.2 B-3: slots 读取已删除
      }

      // 2. 4 层 JSON (semantic/working/episodic/procedural)
      // v3 P8 fix: 按 importance 降序 (高重要度先), 同重要度按时间倒序 (recent 先)
      // 解决"早期写入被截断"问题
      try {
        // 合并所有 4 层 entry, 加 layer 标签
        type EntryWithLayer = { id: string; content: string; layer: string; importance: number; createdAt: string };
        const allRaw: EntryWithLayer[] = [];
        const getImportance = (e: { metadata?: Record<string, unknown> }): number => {
          const v = (e.metadata?.['importance'] as number | undefined) ?? 0.5;
          return typeof v === 'number' ? v : 0.5;
        };
        for (const e of await semantic.readAll()) allRaw.push({ id: e.id, content: e.content, layer: 'semantic', importance: getImportance(e), createdAt: e.createdAt });
        for (const e of await working.readAll()) allRaw.push({ id: e.id, content: e.content, layer: 'working', importance: getImportance(e), createdAt: e.createdAt });
        for (const e of await episodic.readAll()) allRaw.push({ id: e.id, content: e.content, layer: 'episodic', importance: getImportance(e), createdAt: e.createdAt });
        for (const e of await procedural.readAll()) allRaw.push({ id: e.id, content: e.content, layer: 'procedural', importance: getImportance(e), createdAt: e.createdAt });

        // 排序: importance 降序, 同重要度 createdAt 降序 (recent 先)
        allRaw.sort((a, b) => {
          const imp = (b.importance ?? 0.5) - (a.importance ?? 0.5);
          if (imp !== 0) return imp;
          return b.createdAt.localeCompare(a.createdAt);
        });

        // v3.2 B-3: 移除硬 maxLen 截断, 让整体 join 后由末尾 budget 截断处理
        const allEntries: string[] = [];
        for (const e of allRaw.slice(0, 35)) {
          const layerShort = e.layer;
          allEntries.push(`- [${layerShort} imp=${(e.importance ?? 0.5).toFixed(2)}] ${e.content}`);
        }
        if (allEntries.length > 0) {
          sections.push(`## 4 层记忆 (按 importance+时间排序)\n${allEntries.join('\n')}`);
        }
      } catch { /* 降级 */ }

      // 3. shared (如果未在 #1 拼入)
      if (includeShared && !prompt) {
        try {
          const sharedSemanticEntries = await sharedSemantic.readAll();
          const sharedProcEntries = await sharedProcedural.readAll();
          const sharedLines: string[] = [];
          for (const e of sharedSemanticEntries.slice(-5)) {
            sharedLines.push(`- [shared-semantic] ${e.content.slice(0, 100)}`);
          }
          for (const e of sharedProcEntries.slice(-5)) {
            sharedLines.push(`- [shared-procedural] ${e.content.slice(0, 100)}`);
          }
          if (sharedLines.length > 0) {
            sections.push(`## 共享层\n${sharedLines.join('\n')}`);
          }
        } catch { /* 降级 */ }
      }

      // 拼装并按 budgetChars 截断
      const result = sections.join('\n\n');
      if (result.length <= budgetChars) return result;
      return result.slice(0, budgetChars) + '\n[...截断]';
    },

    prefetchAll,
    syncAll,
    getSnapshot: () => snapshot.getCurrent(),

    memoryTool: () => tool,

    // v3.2 B-3: getSlot/setSlot 已删除 (ATTACKER_PWNED 根除)

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

    // v3 P9 fix: SIGTERM 自清理, 防止短脚本场景下定时器阻止 Node 退出
    _destroy: () => {
      heartbeatService.stop();
    },

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
