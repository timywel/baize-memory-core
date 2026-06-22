// src/index.ts
// 包级入口：从子模块 re-export 公共 API
// 注意：tsconfig Bundler 模块解析，但运行时 Node 需要显式 .js 扩展名

export { createBaiZeMemoryCore } from './core/client.js';
export type { BaiZeMemoryCore, CoreConfig, SlotName } from './core/client.js';

export type { Layer, MemoryEntry } from './core/layers.js';
export { LayerStorage } from './core/layers.js';
export { SnapshotManager } from './core/snapshot.js';
export type { FrozenSnapshot, SnapshotData, SnapshotOptions } from './core/snapshot.js';

export { BM25 } from './retrieval/bm25.js';
export type { BM25Doc, BM25Result, BM25Options } from './retrieval/bm25.js';
export { rrfFuse, mmr } from './retrieval/ranker.js';
export type { RankedItem } from './retrieval/ranker.js';

export { MemoryTool } from './ingestion/memory-tool.js';
export { HeartbeatService } from './heartbeat/heartbeat-service.js';
export type { HeartbeatConfig, HeartbeatDeps, HeartbeatReport, HeartbeatAction } from './heartbeat/heartbeat-service.js';
export { DreamingAdapter } from './dreaming/dreaming-adapter.js';
export type { DreamingDeps, DreamResult, ExistingDreamingService } from './dreaming/dreaming-adapter.js';
export { CompactionService } from './compaction/compaction-entry.js';
export type { CompactionEntry } from './compaction/compaction-entry.js';
export { NoopProvider, RestProvider, createProvider } from './external/provider.js';
export type { ExternalMemoryProvider, RestProviderOptions } from './external/provider.js';

export { countChars, softTruncate, hardTruncate, truncateWithMarker, isOverLimit } from './util/chars.js';
export type { TruncateResult } from './util/chars.js';
export { withMutex } from './util/mutex.js';
export { logger } from './util/logger.js';
export type { Level } from './util/logger.js';

// Slot 适配 (BaizeSlot 契约)
export { createSlot, MemoryCoreSlot } from './slot.js';
export type { BaizeSlot, SlotContext, SlotManifest, SlotRequest, SlotResponse, SlotHealthStatus } from './slot.js';

export const VERSION = '0.1.0';
