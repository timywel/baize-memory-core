// src/util/mutex.ts
// Promise-chain mutex，同 key 串行化（审计后修复：锁清理改引用比较防内存泄漏）

const mutexes = new Map<string, { promise: Promise<void> }>();

export async function withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = mutexes.get(key);
  let resolveNext!: () => void;
  const nextPromise = new Promise<void>(r => { resolveNext = r; });
  const current = { promise: nextPromise };
  mutexes.set(key, current);
  if (prev) {
    await prev.promise.catch(() => { /* swallow previous error */ });
  }
  try {
    return await fn();
  } finally {
    // 引用比较：只有当自己仍是当前 key 的 holder 时才清理
    if (mutexes.get(key) === current) {
      mutexes.delete(key);
    }
    resolveNext();
  }
}
