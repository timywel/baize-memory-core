// src/retrieval/bm25.ts
// 真实 BM25 (k1=1.5, b=0.75)，借鉴 hermes/pi 标准实现
// 关键设计：avgDocLength 在 addDocument 时即时重算（O(1) 更新）

import { logger } from '../util/logger.js';

const log = logger('bm25');

const SEGMENTER = new Intl.Segmenter('zh', { granularity: 'word' });

function tokenize(text: string): string[] {
  return Array.from(SEGMENTER.segment(text.toLowerCase()), seg => seg.segment)
    .filter(t => t.trim().length > 0);
}

export interface BM25Doc {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface BM25Options {
  k1?: number;
  b?: number;
}

export interface BM25Result {
  id: string;
  score: number;
  content: string;
  metadata?: Record<string, unknown>;
}

interface InternalDoc {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  tokens: string[];
}

export class BM25 {
  private docs = new Map<string, InternalDoc>();
  private docFreq = new Map<string, number>(); // term → number of docs containing it
  private docLengths: number[] = [];
  private avgDocLength = 0;
  private readonly k1: number;
  private readonly b: number;

  constructor(options: BM25Options = {}) {
    this.k1 = options.k1 ?? 1.5;
    this.b = options.b ?? 0.75;
  }

  addDocument(doc: BM25Doc): void {
    const tokens = tokenize(doc.content);
    this.docs.set(doc.id, { ...doc, tokens });
    this.docLengths.push(tokens.length);
    this.avgDocLength = this.docLengths.reduce((a, b) => a + b, 0) / this.docLengths.length;
    // 增量更新 docFreq
    for (const term of new Set(tokens)) {
      this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
    }
  }

  search(query: string, limit = 20): BM25Result[] {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0 || this.docs.size === 0) return [];
    const N = this.docs.size;
    const scores: BM25Result[] = [];

    for (const doc of this.docs.values()) {
      const docLen = doc.tokens.length;
      if (docLen === 0) continue;
      let score = 0;
      for (const qt of queryTokens) {
        const tf = doc.tokens.filter(t => t === qt).length;
        if (tf === 0) continue;
        const df = this.docFreq.get(qt) ?? 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        const tfNorm = (tf * (this.k1 + 1)) /
          (tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLength)));
        score += idf * tfNorm;
      }
      if (score > 0) {
        scores.push({ id: doc.id, score, content: doc.content, metadata: doc.metadata });
      }
    }
    return scores.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // 暴露给测试
  get size(): number { return this.docs.size; }
  get docCount(): number { return this.docs.size; }
}
