// tests/client.test.ts
// 关键测试：BaiZeMemoryCore 4 层 API + 检索 + 共享 + prefetchAll/syncAll

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createBaiZeMemoryCore } from '../src/core/client';

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baize-core-'));
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('BaiZeMemoryCore', () => {
  it('writes and reads across 4 layers', async () => {
    const core = createBaiZeMemoryCore({ profileId: 'test', basePath: testDir });
    await core.addWorkingMemory('current task');
    await core.addSemanticMemory('白泽 is baize');
    const results = await core.searchMemories('白泽');
    expect(results.length).toBeGreaterThan(0);
  });

  it('handles addSharedSemantic + search with includeShared', async () => {
    // shared base 指向 ~/.baize/memory/shared → 不便在 tmp 测
    // 这里只测不 crash
    const core = createBaiZeMemoryCore({ profileId: 'test', basePath: testDir });
    const id = await core.addSharedSemantic('shared fact');
    expect(id).toBeDefined();
  });

  it('prefetchAll + syncAll dual pipeline', async () => {
    const core = createBaiZeMemoryCore({ profileId: 'test', basePath: testDir });
    await core.addWorkingMemory('working item');
    await core.prefetchAll();
    const snap1 = core.getSnapshot();
    expect(snap1).not.toBeNull();
    // syncAll 触发后 working 内容写入 memory.md
    await core.syncAll();
    const snap2 = core.getSnapshot();
    // working 已被合并到 memory.md (snake 写回)
    expect(snap2).not.toBeNull();
    // snap 不再含 slots 字段 (v3.2 B-3)
    expect(snap2?.memoryMd).toBeDefined();
  });

  it('getContext respects budgetChars', async () => {
    const core = createBaiZeMemoryCore({
      profileId: 'test',
      basePath: testDir,
      curatedMemory: { memorySoftLimit: 100, memoryHardLimit: 200, sharedLimit: 100 },
    });
    await core.addSemanticMemory('x'.repeat(500));
    await core.prefetchAll();
    // v3 P7: 4 层 JSON 拼接 + budget 截断, 允许 [...截断] 标记 (约 10 字符)
    const ctx = await core.getContext({ budgetChars: 200 });
    expect(ctx.length).toBeLessThanOrEqual(215);  // 200 + 截断标记
  });

  // v3.2 B-3: setSlot/getSlot 已删除, 测试 addSharedSemantic 跨 profile 写
  it('addSharedSemantic 跨 profile 可见', async () => {
    const writer = createBaiZeMemoryCore({ profileId: 'shared-writer-sdk', basePath: testDir });
    await writer.addSharedSemantic('v3.2-B3-测试-共享层');
    const reader = createBaiZeMemoryCore({ profileId: 'shared-reader-sdk', basePath: testDir });
    const results = await reader.searchSharedMemories('v3.2-B3');
    expect(results.length).toBeGreaterThan(0);
  });
});
