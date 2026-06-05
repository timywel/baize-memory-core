// src/util/chars.ts
// 借鉴 hermes 字符硬上限，提供字符计数、软/硬截断、unicode 安全的字符工具

const SEGMENTER = new Intl.Segmenter('zh', { granularity: 'grapheme' });

function toGraphemes(s: string): string[] {
  return Array.from(SEGMENTER.segment(s), seg => seg.segment);
}

export function countChars(s: string): number {
  let count = 0;
  for (const _ of SEGMENTER.segment(s)) count++;
  return count;
}

export interface TruncateResult {
  content: string;
  truncated: boolean;
  originalLength: number;
}

export function softTruncate(s: string, limit: number): TruncateResult {
  return truncateWithMarker(s, limit, '...');
}

export function hardTruncate(s: string, limit: number): TruncateResult {
  return truncateWithMarker(s, limit, '');
}

export function truncateWithMarker(
  s: string,
  limit: number,
  marker = '...'
): TruncateResult {
  const total = countChars(s);
  if (total <= limit) {
    return { content: s, truncated: false, originalLength: total };
  }
  const graphemes = toGraphemes(s);
  // 给 marker 留位置（如果 limit 太短，至少保留 marker 本身）
  const markerLen = countChars(marker);
  const effectiveLimit = Math.max(0, limit - markerLen);
  const truncated = graphemes.slice(0, effectiveLimit).join('') + marker;
  return { content: truncated, truncated: true, originalLength: total };
}

export function isOverLimit(s: string, hardLimit: number): boolean {
  return countChars(s) > hardLimit;
}
