// tests/dreaming.test.ts
// 关键测试：adapter 包装 + 顺序 + syncAll 触发

import { describe, it, expect, vi } from 'vitest';
import { DreamingAdapter } from '../src/dreaming/dreaming-adapter';
import { HeartbeatService } from '../src/heartbeat/heartbeat-service';
import { LayerStorage } from '../src/core/layers';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

describe('DreamingAdapter', () => {
  it('runs heartbeat.pulse() before inner.dream()', async () => {
    const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baize-dreaming-'));
    try {
      const working = new LayerStorage(testDir, 'working');
      const heartbeat = new HeartbeatService({
        getWorkingStorage: () => working,
        getMemoryMd: () => 'short',
        getSharedMd: () => '',
        getContextTokenRatio: () => 0.2,
      });
      const callOrder: string[] = [];
      const inner = {
        dream: vi.fn(async () => {
          callOrder.push('inner.dream');
          return { skipped: true };
        }),
      };
      const heartbeatSpy = vi.spyOn(heartbeat, 'pulse').mockImplementation(async () => {
        callOrder.push('heartbeat.pulse');
        return {
          ts: '', workingCount: 0, episodicCount: 0, semanticCount: 0, proceduralCount: 0,
          memoryMdChars: 0, sharedMdChars: 0, contextTokenRatio: 0,
          actions: [{ type: 'noop', reason: 'all_healthy' }],
        };
      });
      const adapter = new DreamingAdapter({
        inner,
        heartbeat,
        getMemoryMd: () => 'short',
        syncAll: async () => {},
      });
      await adapter.dream();
      expect(callOrder).toEqual(['heartbeat.pulse', 'inner.dream']);
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('triggers syncAll when memoriesPromoted > 0', async () => {
    const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baize-dreaming-'));
    try {
      const working = new LayerStorage(testDir, 'working');
      const heartbeat = new HeartbeatService({
        getWorkingStorage: () => working,
        getMemoryMd: () => 'short',
        getSharedMd: () => '',
        getContextTokenRatio: () => 0.2,
      });
      vi.spyOn(heartbeat, 'pulse').mockResolvedValue({
        ts: '', workingCount: 0, episodicCount: 0, semanticCount: 0, proceduralCount: 0,
        memoryMdChars: 0, sharedMdChars: 0, contextTokenRatio: 0,
        actions: [{ type: 'noop', reason: 'all_healthy' }],
      });
      const inner = {
        dream: vi.fn(async () => ({ skipped: false, memoriesPromoted: 3 })),
      };
      const syncAll = vi.fn(async () => {});
      const adapter = new DreamingAdapter({
        inner,
        heartbeat,
        getMemoryMd: () => 'short',
        syncAll,
      });
      await adapter.dream();
      expect(syncAll).toHaveBeenCalledTimes(1);
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });

  it('skips syncAll when no memories promoted', async () => {
    const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baize-dreaming-'));
    try {
      const working = new LayerStorage(testDir, 'working');
      const heartbeat = new HeartbeatService({
        getWorkingStorage: () => working,
        getMemoryMd: () => 'short',
        getSharedMd: () => '',
        getContextTokenRatio: () => 0.2,
      });
      vi.spyOn(heartbeat, 'pulse').mockResolvedValue({
        ts: '', workingCount: 0, episodicCount: 0, semanticCount: 0, proceduralCount: 0,
        memoryMdChars: 0, sharedMdChars: 0, contextTokenRatio: 0,
        actions: [{ type: 'noop', reason: 'all_healthy' }],
      });
      const inner = { dream: vi.fn(async () => ({ skipped: true })) };
      const syncAll = vi.fn(async () => {});
      const adapter = new DreamingAdapter({
        inner, heartbeat, getMemoryMd: () => 'short', syncAll,
      });
      await adapter.dream();
      expect(syncAll).not.toHaveBeenCalled();
    } finally {
      await fs.rm(testDir, { recursive: true, force: true });
    }
  });
});
