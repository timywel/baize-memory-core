// tests/ranker.test.ts
// 关键测试：RRF 公式 + MMR 多样性

import { describe, it, expect } from 'vitest';
import { rrfFuse, mmr } from '../src/retrieval/ranker';

describe('RRF (Reciprocal Rank Fusion)', () => {
  it('fuses two ranked lists with k=60', () => {
    // a: list1 rank 0 + list2 rank 1 = 1/61 + 1/62
    // b: list1 rank 1 + list2 rank 0 = 1/62 + 1/61
    // → a and b have IDENTICAL scores (symmetric)
    const r = rrfFuse([
      [{ id: 'a', rank: 0 }, { id: 'b', rank: 1 }],
      [{ id: 'b', rank: 0 }, { id: 'a', rank: 1 }],
    ]);
    const expected = 1 / 61 + 1 / 62;
    expect(r.get('a')).toBeCloseTo(expected, 4);
    expect(r.get('b')).toBeCloseTo(expected, 4);
  });

  it('handles 3+ lists', () => {
    const r = rrfFuse([
      [{ id: 'x', rank: 0 }],
      [{ id: 'x', rank: 0 }],
      [{ id: 'x', rank: 0 }],
    ]);
    expect(r.get('x')!).toBeCloseTo(3 * (1 / 61), 4);
  });

  it('empty list returns empty map', () => {
    expect(rrfFuse([]).size).toBe(0);
  });
});

describe('MMR (Maximal Marginal Relevance)', () => {
  it('MMR: b wins over c because relevance*0.7 > diversity*0.3', () => {
    // 验证 MMR 公式：λ=0.7
    // b: 0.7 * 0.85 - 0.3 * jaccard(b,a) = 0.595 - 0.3 * (1/6) ≈ 0.545
    // c: 0.7 * 0.5 - 0.3 * 0 = 0.35
    // → b wins (relevance dominates when λ=0.7)
    const candidates = [
      { id: 'a', content: 'fox jumps over', score: 0.9 },
      { id: 'b', content: 'fox runs away', score: 0.85 },
      { id: 'c', content: 'unrelated topic', score: 0.5 },
    ];
    const result = mmr(candidates, 0.7, 3);
    expect(result[0].id).toBe('a');  // highest score first
    expect(result[1].id).toBe('b');  // b's relevance outweighs diversity penalty
    expect(result[2].id).toBe('c');
  });

  it('λ=0 (pure diversity): c wins over b (when only a selected)', () => {
    const candidates = [
      { id: 'a', content: 'fox jumps', score: 0.9 },
      { id: 'b', content: 'fox runs', score: 0.85 },
      { id: 'c', content: 'unrelated', score: 0.5 },
    ];
    const result = mmr(candidates, 0.0, 3);
    // λ=0 → relevance term zero, only diversity matters
    // b similar to a (high Jaccard) → penalized
    // c unrelated → no penalty
    expect(result[0].id).toBe('a');
    expect(result[1].id).toBe('c');
  });

  it('respects k limit', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `d${i}`, content: `doc ${i}`, score: 1.0 - i * 0.1,
    }));
    const result = mmr(candidates, 0.7, 3);
    expect(result).toHaveLength(3);
  });

  it('empty candidates returns empty', () => {
    expect(mmr([], 0.7, 5)).toEqual([]);
  });
});
