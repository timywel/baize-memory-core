// src/dreaming/dreaming-adapter.ts
// 包装现有 BaiZeDreamingService：前置 heartbeat + 字符 preflight + syncAll

import { logger } from '../util/logger.js';
import { isOverLimit, countChars, softTruncate } from '../util/chars.js';
import { HeartbeatService } from '../heartbeat/heartbeat-service.js';

const log = logger('dreaming-adapter');

export interface DreamResult {
  skipped: boolean;
  candidatesScanned?: number;
  memoriesPromoted?: number;
  reason?: string;
}

export interface ExistingDreamingService {
  dream(): Promise<DreamResult>;
}

export interface DreamingDeps {
  inner: ExistingDreamingService;
  heartbeat: HeartbeatService;
  getMemoryMd: () => string;
  syncAll: () => Promise<void>;
  config?: {
    memorySoftLimit?: number;  // 默认 4000
  };
}

export class DreamingAdapter {
  constructor(private deps: DreamingDeps) {}

  async dream(): Promise<DreamResult> {
    // 1. 前置 heartbeat
    const hb = await this.deps.heartbeat.pulse();
    if (hb.actions.some(a => a.type === 'alert')) {
      log.warn('Heartbeat reported alerts, recommend checking before dreaming');
    }

    // 2. 字符 preflight
    const softLimit = this.deps.config?.memorySoftLimit ?? 4000;
    const memoryMd = this.deps.getMemoryMd();
    if (isOverLimit(memoryMd, softLimit)) {
      log.info(`memory.md preflight: ${countChars(memoryMd)} chars > ${softLimit}, summarizing`);
      // 实际写入会由 syncAll 处理，这里只记录
    }

    // 3. 委托给现有 BaiZeDreamingService
    const result = await this.deps.inner.dream();

    // 4. 晋升后 syncAll
    if (result.memoriesPromoted && result.memoriesPromoted > 0) {
      await this.deps.syncAll();
      log.info(`syncAll after ${result.memoriesPromoted} memories promoted`);
    } else {
      log.debug('No memories promoted, skipping syncAll');
    }

    return result;
  }
}
