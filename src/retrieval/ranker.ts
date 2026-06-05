// src/retrieval/ranker.ts
// RRF (Reciprocal Rank Fusion) + MMR (Maximal Marginal Relevance)
// 标准实现：RRF k=60，MMR λ=0.7

export function rrfFuse(
  lists: Array<{ id: string; rank: number }[]>,
  k: number = 60
): Map<string, number> {
  const fused = new Map<string, number>();
  for (const list of lists) {
    list.forEach((item, rank) => {
      const prev = fused.get(item.id) ?? 0;
      fused.set(item.id, prev + 1 / (k + rank + 1));
    });
  }
  return fused;
}

export interface RankedItem {
  id: string;
  content: string;
  score: number;
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(a.toLowerCase().split(/\s+/));
  const setB = new Set(b.toLowerCase().split(/\s+/));
  if (setA.size === 0 && setB.size === 0) return 0;
  let intersect = 0;
  for (const x of setA) if (setB.has(x)) intersect++;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersect / union;
}

export function mmr<T extends RankedItem>(
  candidates: T[],
  lambda: number = 0.7,
  k: number
): T[] {
  if (candidates.length === 0 || k <= 0) return [];
  const selected: T[] = [];
  const remaining = [...candidates];

  while (selected.length < k && remaining.length > 0) {
    if (selected.length === 0) {
      selected.push(remaining.shift()!);
      continue;
    }
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const c = remaining[i];
      let maxSim = 0;
      for (const s of selected) {
        const sim = jaccardSimilarity(c.content, s.content);
        if (sim > maxSim) maxSim = sim;
      }
      const mmrScore = lambda * c.score - (1 - lambda) * maxSim;
      if (mmrScore > bestScore) {
        bestScore = mmrScore;
        bestIdx = i;
      }
    }
    selected.push(remaining[bestIdx]);
    remaining.splice(bestIdx, 1);
  }
  return selected;
}
