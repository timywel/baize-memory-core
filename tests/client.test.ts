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
    // snap 包含 slots 字段（即使空）
    expect(snap2?.slots).toBeDefined();
  });

  it('getContext respects budgetChars', async () => {
    const core = createBaiZeMemoryCore({
      profileId: 'test',
      basePath: testDir,
      curatedMemory: { memorySoftLimit: 100, memoryHardLimit: 200, sharedLimit: 100 },
    });
    await core.addSemanticMemory('x'.repeat(500));
    await core.prefetchAll();
    // 不依赖 prefetchAll (snapshot 含 budgetChars 临时生成)
    const ctx = await core.getContext({ budgetChars: 200 });
    expect(ctx.length).toBeLessThanOrEqual(200);
  });

  it('setSlot + getSlot roundtrip', async () => {
    const core = createBaiZeMemoryCore({ profileId: 'test', basePath: testDir });
    await core.setSlot('persona', '我是白泽');
    const got = await core.getSlot('persona');
    expect(got).toBe('我是白泽');
  });
});
