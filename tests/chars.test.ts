// tests/chars.test.ts
// 关键测试：算法正确性（字符边界 + soft/hard 区别 + Unicode 安全）

import { describe, it, expect } from 'vitest';
import {
  countChars,
  softTruncate,
  hardTruncate,
  isOverLimit,
  truncateWithMarker,
} from '../src/util/chars';

describe('countChars', () => {
  it('handles ASCII', () => {
    expect(countChars('hello')).toBe(5);
  });
  it('handles CJK as single graphemes', () => {
    expect(countChars('你好')).toBe(2);
  });
  it('handles emoji as single graphemes (ZWSJ family = 1)', () => {
    expect(countChars('👨‍👩‍👧')).toBe(1);
  });
  it('handles empty string', () => {
    expect(countChars('')).toBe(0);
  });
});

describe('softTruncate vs hardTruncate', () => {
  it('soft appends "..." marker when over limit', () => {
    const r = softTruncate('a'.repeat(100), 50);
    expect(r.truncated).toBe(true);
    expect(r.content).toMatch(/\.\.\.$/);
    // 50 - 3 (marker) = 47 chars + "..."
    expect(r.content.length).toBeLessThanOrEqual(50);
  });

  it('hard does NOT append marker when over limit', () => {
    const r = hardTruncate('a'.repeat(100), 50);
    expect(r.truncated).toBe(true);
    expect(r.content).not.toMatch(/\.\.\.$/);
    expect(r.content).toHaveLength(50);
  });

  it('returns content unchanged when under limit', () => {
    expect(softTruncate('hi', 50).truncated).toBe(false);
    expect(hardTruncate('hi', 50).truncated).toBe(false);
  });
});

describe('truncateWithMarker', () => {
  it('uses custom marker', () => {
    const r = truncateWithMarker('a'.repeat(20), 10, '###');
    expect(r.content).toMatch(/###$/);
  });

  it('does not split grapheme (Unicode safe)', () => {
    const text = '你'.repeat(60);
    const r = softTruncate(text, 10);
    // 10 - 3 = 7 个你 + ...
    expect(r.content).toMatch(/^[你好]+\.\.\.$|^你好{0,7}\.\.\.$/);
    expect(r.truncated).toBe(true);
  });
});

describe('isOverLimit', () => {
  it('returns true over limit, false under, false at exact limit', () => {
    expect(isOverLimit('aaa', 2)).toBe(true);
    expect(isOverLimit('aa', 2)).toBe(false);
    expect(isOverLimit('a', 2)).toBe(false);
  });
});
