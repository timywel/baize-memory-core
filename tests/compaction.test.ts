// tests/compaction.test.ts
// 关键测试：压缩 + 保留 sourceLength + 可写 working 层

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { CompactionService } from '../src/compaction/compaction-entry';
import { LayerStorage } from '../src/core/layers';

describe('CompactionService', () => {
  it('compresses long content within budget', async () => {
    const cp = new CompactionService();
    const long = 'a'.repeat(1000);
    const result = await cp.compact(long, 100);
    expect(result.compacted.length).toBeLessThanOrEqual(100);
    expect(result.compactionEntry.sourceLength).toBe(1000);
  });

  it('preserves sourceLength in CompactionEntry (不丢源内容)', async () => {
    const cp = new CompactionService();
    const result = await cp.compact('x'.repeat(500), 50);
    expect(result.compactionEntry.sourceLength).toBe(500);
    expect(result.compactionEntry.type).toBe('compaction');
  });

  it('writes CompactionEntry to working layer when provided', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baize-compaction-'));
    try {
      const working = new LayerStorage(tmpDir, 'working');
      const cp = new CompactionService();
      await cp.compact('long content'.repeat(100), 50, working);
      const entries = await working.readAll();
      expect(entries).toHaveLength(1);
      const parsed = JSON.parse(entries[0].content);
      expect(parsed.type).toBe('compaction');
      expect(parsed.sourceLength).toBeGreaterThan(0);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('handles empty content gracefully', async () => {
    const cp = new CompactionService();
    const result = await cp.compact('', 100);
    expect(result.compactionEntry.sourceLength).toBe(0);
    expect(result.compacted).toBe('');
  });
});
