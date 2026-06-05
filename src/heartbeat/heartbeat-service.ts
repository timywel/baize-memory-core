// src/heartbeat/heartbeat-service.ts
// 高频被动体检：监控 working 数量 / token 预算 / 重复写入，触发应急动作

import { logger } from '../util/logger.js';
import { isOverLimit, countChars, softTruncate } from '../util/chars.js';
import { CompactionService } from '../compaction/compaction-entry.js';
import { LayerStorage } from '../core/layers.js';
import { MemoryEntry } from '../core/layers.js';

const log = logger('heartbeat');

export type HeartbeatAction =
  | { type: 'compact'; reason: 'working_count_exceeded'; targetLayer: 'working'; count: number }
  | { type: 'summarize'; reason: 'memory_md_too_long'; sourceChars: number; targetChars: number }
  | { type: 'decay'; reason: 'stale_working'; count: number }
  | { type: 'alert'; reason: 'duplicate_writes'; entries: string[] }
  | { type: 'noop'; reason: 'all_healthy' };

export interface HeartbeatReport {
  ts: string;
  workingCount: number;
  episodicCount: number;
  semanticCount: number;
  proceduralCount: number;
  memoryMdChars: number;
  sharedMdChars: number;
  contextTokenRatio: number;
  actions: HeartbeatAction[];
}

export interface HeartbeatConfig {
  intervalMs: number;          // 默认 5 分钟
  triggers: {
    workingCount: number;      // 默认 50
    memoryHardLimit: number;   // 默认 8000
    staleHours: number;        // 默认 24
  };
  /** 上次 compaction 时间（节流用） */
  lastCompactAt?: number;
}

export interface HeartbeatDeps {
  getWorkingStorage: () => LayerStorage;
  getMemoryMd: () => string;
  getSharedMd: () => string;
  getContextTokenRatio: () => number;  // 0-1
}

export class HeartbeatService {
  private timer: NodeJS.Timeout | null = null;
  private deps: HeartbeatDeps;
  private config: HeartbeatConfig;

  constructor(deps: HeartbeatDeps, config: Partial<HeartbeatConfig> = {}) {
    this.deps = deps;
    this.config = {
      intervalMs: config.intervalMs ?? 5 * 60 * 1000,
      triggers: {
        workingCount: config.triggers?.workingCount ?? 50,
        memoryHardLimit: config.triggers?.memoryHardLimit ?? 8000,
        staleHours: config.triggers?.staleHours ?? 24,
      },
      lastCompactAt: config.lastCompactAt ?? 0,
    };
  }

  /** 单次心跳 */
  async pulse(): Promise<HeartbeatReport> {
    const workingStorage = this.deps.getWorkingStorage();
    const working = await workingStorage.readAll();
    const episodic = await this.deps.getWorkingStorage().readAll();
    const memoryMd = this.deps.getMemoryMd();
    const sharedMd = this.deps.getSharedMd();

    const actions: HeartbeatAction[] = [];

    // 1. working 数量超阈值 → 触发 compaction
    if (working.length > this.config.triggers.workingCount) {
      // 节流：5 分钟内最多 1 次
      if (Date.now() - (this.config.lastCompactAt ?? 0) > 5 * 60 * 1000) {
        const compaction = new CompactionService();
        const longWorking = working.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
        if (longWorking) {
          await compaction.compact(longWorking.content, 200, workingStorage);
        }
        this.config.lastCompactAt = Date.now();
        actions.push({ type: 'compact', reason: 'working_count_exceeded', targetLayer: 'working', count: working.length });
      }
    }

    // 2. memory.md 超硬上限 → 截断
    if (isOverLimit(memoryMd, this.config.triggers.memoryHardLimit)) {
      const truncated = softTruncate(memoryMd, this.config.triggers.memoryHardLimit);
      actions.push({
        type: 'summarize',
        reason: 'memory_md_too_long',
        sourceChars: countChars(memoryMd),
        targetChars: this.config.triggers.memoryHardLimit,
      });
      log.warn(`memory.md too long: ${countChars(memoryMd)} chars, should summarize`);
    }

    // 3. 重复写入检测
    const dupes = this.detectDuplicates(working);
    if (dupes.length > 0) {
      actions.push({ type: 'alert', reason: 'duplicate_writes', entries: dupes });
    }

    // 4. 全部健康
    if (actions.length === 0) {
      actions.push({ type: 'noop', reason: 'all_healthy' });
    }

    return {
      ts: new Date().toISOString(),
      workingCount: working.length,
      episodicCount: episodic.length,
      semanticCount: 0,  // 简化：未来可扩展
      proceduralCount: 0,
      memoryMdChars: countChars(memoryMd),
      sharedMdChars: countChars(sharedMd),
      contextTokenRatio: this.deps.getContextTokenRatio(),
      actions,
    };
  }

  private detectDuplicates(entries: MemoryEntry[]): string[] {
    const seen = new Map<string, string[]>();
    for (const e of entries) {
      const key = e.content.trim().slice(0, 100);
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(e.id);
    }
    return [...seen.values()].filter(ids => ids.length > 1).map(ids => ids.join(','));
  }

  start(): NodeJS.Timeout {
    if (this.timer) return this.timer;
    this.timer = setInterval(() => {
      this.pulse().catch(err => log.error('pulse failed:', err));
    }, this.config.intervalMs);
    log.info(`HeartbeatService started (intervalMs=${this.config.intervalMs})`);
    return this.timer;
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log.info('HeartbeatService stopped');
    }
  }
}
