// tests/snapshot.test.ts
// 关键测试：frozen 不可变 + 字符预算 + slots 注入

import { describe, it, expect } from 'vitest';
import { SnapshotManager } from '../src/core/snapshot';

describe('SnapshotManager', () => {
  it('captures snapshot with all fields', () => {
    const sm = new SnapshotManager();
    const snap = sm.capture({
      memoryMd: 'persona content',
      sharedMd: 'user prefs',
      slots: { persona: 'I am coder' },
    });
    expect(snap.memoryMd).toBe('persona content');
    expect(snap.sharedMd).toBe('user prefs');
    expect(snap.slots.persona).toBe('I am coder');
    expect(snap.capturedAt).toMatch(/T/);
  });

  it('snapshot is immutable within session (immutability test)', () => {
    const sm = new SnapshotManager();
    sm.capture({ memoryMd: 'initial', sharedMd: '', slots: {} });
    const snap1 = sm.getCurrent();
    // 即使外部 data 引用变了，snapshot 内容不变
    sm.capture({ memoryMd: 'updated', sharedMd: '', slots: {} });
    const snap2 = sm.getCurrent();
    expect(snap1?.memoryMd).toBe('initial');
    expect(snap2?.memoryMd).toBe('updated');
  });

  it('respects character budget (truncates memoryMd)', () => {
    const sm = new SnapshotManager({ maxChars: 100 });
    const snap = sm.capture({
      memoryMd: 'a'.repeat(500),
      sharedMd: '',
      slots: {},
    });
    expect(snap.truncated).toBe(true);
    // softTruncate 会加 '...'
    expect(snap.memoryMd.length).toBeLessThanOrEqual(100);
  });

  it('injectIntoPrompt formats all sections', () => {
    const sm = new SnapshotManager();
    sm.capture({
      memoryMd: 'mem content',
      sharedMd: 'shared content',
      slots: { persona: 'coder' },
    });
    const prompt = sm.injectIntoPrompt();
    expect(prompt).toContain('## 持久记忆');
    expect(prompt).toContain('mem content');
    expect(prompt).toContain('## 跨 profile 共享');
    expect(prompt).toContain('## persona');
  });

  it('returns empty string when no snapshot', () => {
    const sm = new SnapshotManager();
    expect(sm.injectIntoPrompt()).toBe('');
    expect(sm.getCurrent()).toBeNull();
  });
});
