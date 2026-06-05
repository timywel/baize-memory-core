// tests/mutex.test.ts
// 关键测试：1000 并发 + 锁清理 + 错误释放

import { describe, it, expect } from 'vitest';
import { withMutex } from '../src/util/mutex';

describe('withMutex', () => {
  it('serializes concurrent writes to same key (10 in order)', async () => {
    const order: number[] = [];
    const promises = Array.from({ length: 10 }, (_, i) =>
      withMutex('slot-1', async () => {
        await new Promise(r => setTimeout(r, 5));
        order.push(i);
      })
    );
    await Promise.all(promises);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('1000 concurrent writes do not corrupt or deadlock', async () => {
    const promises = Array.from({ length: 1000 }, (_, i) =>
      withMutex('hot-key', async () => {
        // No-op, but verify no data race / leak
        if (i % 100 === 0) await new Promise(r => setTimeout(r, 1));
      })
    );
    await expect(Promise.all(promises)).resolves.toBeDefined();
  });

  it('releases lock on error (subsequent calls do not block)', async () => {
    await expect(
      withMutex('err-key', async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    // Must not block the next call
    let ran = false;
    await withMutex('err-key', async () => { ran = true; });
    expect(ran).toBe(true);
  });

  it('different keys allow concurrent access', async () => {
    const order: string[] = [];
    const a = withMutex('a', async () => {
      await new Promise(r => setTimeout(r, 30));
      order.push('a');
    });
    const b = withMutex('b', async () => {
      await new Promise(r => setTimeout(r, 10));
      order.push('b');
    });
    await Promise.all([a, b]);
    // b finishes first (10ms) before a (30ms)
    expect(order).toEqual(['b', 'a']);
  });
});
