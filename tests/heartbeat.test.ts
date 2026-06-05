// tests/heartbeat.test.ts
// 关键测试：触发条件 + 节流 + 重复检测

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HeartbeatService } from '../src/heartbeat/heartbeat-service';
import { LayerStorage } from '../src/core/layers';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

let testDir: string;
let working: LayerStorage;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baize-heartbeat-'));
  working = new LayerStorage(testDir, 'working');
});

async function cleanup() {
  await fs.rm(testDir, { recursive: true, force: true });
}

describe('HeartbeatService', () => {
  it('pulse returns all_healthy when below thresholds', async () => {
    const hs = new HeartbeatService(
      {
        getWorkingStorage: () => working,
        getMemoryMd: () => 'short',
        getSharedMd: () => '',
        getContextTokenRatio: () => 0.2,
      },
      { triggers: { workingCount: 10, memoryHardLimit: 8000, staleHours: 24 } }
    );
    const report = await hs.pulse();
    expect(report.workingCount).toBe(0);
    expect(report.actions.some(a => a.type === 'noop')).toBe(true);
  });

  it('triggers compact when working count exceeds threshold', async () => {
    for (let i = 0; i < 5; i++) await working.write(`item ${i}`);
    const hs = new HeartbeatService(
      {
        getWorkingStorage: () => working,
        getMemoryMd: () => 'short',
        getSharedMd: () => '',
        getContextTokenRatio: () => 0.2,
      },
      { triggers: { workingCount: 3, memoryHardLimit: 8000, staleHours: 24 } }
    );
    const report = await hs.pulse();
    expect(report.actions.some(a => a.type === 'compact')).toBe(true);
    await cleanup();
  });

  it('triggers summarize when memory.md too long', async () => {
    const hs = new HeartbeatService(
      {
        getWorkingStorage: () => working,
        getMemoryMd: () => 'x'.repeat(9000),
        getSharedMd: () => '',
        getContextTokenRatio: () => 0.2,
      },
      { triggers: { workingCount: 50, memoryHardLimit: 8000, staleHours: 24 } }
    );
    const report = await hs.pulse();
    expect(report.actions.some(a => a.type === 'summarize')).toBe(true);
  });

  it('detects duplicates', async () => {
    await working.write('duplicate content');
    await working.write('duplicate content');
    await working.write('unique content');
    const hs = new HeartbeatService(
      {
        getWorkingStorage: () => working,
        getMemoryMd: () => 'short',
        getSharedMd: () => '',
        getContextTokenRatio: () => 0.2,
      },
      { triggers: { workingCount: 50, memoryHardLimit: 8000, staleHours: 24 } }
    );
    const report = await hs.pulse();
    expect(report.actions.some(a => a.type === 'alert')).toBe(true);
    await cleanup();
  });
});
