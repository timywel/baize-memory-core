// tests/bm25.test.ts
// 关键测试：BM25 公式正确性 + CJK 分词 + 长度归一 + IDF 平滑

import { describe, it, expect } from 'vitest';
import { BM25 } from '../src/retrieval/bm25';

describe('BM25', () => {
  it('ranks relevant doc above irrelevant', () => {
    const bm25 = new BM25();
    bm25.addDocument({ id: '1', content: 'The quick brown fox' });
    bm25.addDocument({ id: '2', content: 'JavaScript is a programming language' });
    const results = bm25.search('fox');
    expect(results[0].id).toBe('1');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('handles Chinese via mixed tokenization', () => {
    const bm25 = new BM25();
    bm25.addDocument({ id: '1', content: '白泽是 AI 编程助手' });
    bm25.addDocument({ id: '2', content: 'TypeScript 是 JavaScript 超集' });
    const results = bm25.search('白泽');
    expect(results[0].id).toBe('1');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('returns empty for no matches', () => {
    const bm25 = new BM25();
    bm25.addDocument({ id: '1', content: 'hello world' });
    const results = bm25.search('xyz');
    expect(results).toEqual([]);
  });

  it('handles pure-English tokenization (regression for v3 P5)', () => {
    // 之前 tokenize 用 'zh' word-level, 纯英文搜不到
    const bm25 = new BM25();
    bm25.addDocument({ id: '1', content: 'hello world' });
    const results = bm25.search('hello');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
  });

  it('handles mixed CJK + English tokenization', () => {
    const bm25 = new BM25();
    bm25.addDocument({ id: '1', content: '白泽 TypeScript baize' });
    const results = bm25.search('TypeScript');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('1');
  });

  it('length normalization penalizes very long docs', () => {
    const bm25 = new BM25({ k1: 1.5, b: 0.75 });
    bm25.addDocument({ id: '1', content: 'fox' });
    bm25.addDocument({ id: '2', content: 'fox ' + 'padding '.repeat(1000) });
    const results = bm25.search('fox');
    // shorter doc should rank first due to b=0.75 length normalization
    expect(results[0].id).toBe('1');
  });

  it('IDF: rare terms score higher than common ones', () => {
    const bm25 = new BM25();
    bm25.addDocument({ id: '1', content: 'fox jumps' });
    bm25.addDocument({ id: '2', content: 'fox runs' });
    bm25.addDocument({ id: '3', content: 'cat sleeps' });
    bm25.addDocument({ id: '4', content: 'dog plays' });
    // 'fox' appears in 2/4 docs, 'jumps' in 1/4 — jumps should have higher IDF
    const results = bm25.search('jumps');
    expect(results[0].id).toBe('1');
    expect(results[0].score).toBeGreaterThan(0.5);
  });

  it('handles 1000 docs without performance regression', () => {
    const bm25 = new BM25();
    for (let i = 0; i < 1000; i++) {
      bm25.addDocument({ id: `d${i}`, content: `doc ${i} fox topic ${i % 10}` });
    }
    const start = Date.now();
    const results = bm25.search('fox', 10);
    const elapsed = Date.now() - start;
    expect(results.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(500); // should be < 500ms for 1000 docs
  });
});
