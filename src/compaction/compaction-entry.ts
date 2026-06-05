// src/compaction/compaction-entry.ts
// 借鉴 pi CompactionEntry：context 满时把早期 turn 压缩为 LLM 摘要条目

import { hardTruncate, countChars } from '../util/chars.js';
import { LayerStorage } from '../core/layers.js';
import { randomUUID } from 'node:crypto';

export interface CompactionEntry {
  id: string;
  type: 'compaction';
  summary: string;
  sourceLength: number;
  sourcePreview: string;  // 保留前 200 字符作为引用
  createdAt: string;
}

export class CompactionService {
  /**
   * 压缩长内容为摘要条目
   * @param content 原始长内容
   * @param budgetChars 目标字符预算
   * @param workingStorage 可选：写入 working 层作为 CompactionEntry
   */
  async compact(
    content: string,
    budgetChars: number,
    workingStorage?: LayerStorage
  ): Promise<{
    compacted: string;
    compactionEntry: CompactionEntry;
  }> {
    const sourceLength = countChars(content);
    const truncated = hardTruncate(content, budgetChars);
    const entry: CompactionEntry = {
      id: randomUUID(),
      type: 'compaction',
      summary: `[压缩自 ${sourceLength} 字符] ${truncated.content.slice(0, 200)}...`,
      sourceLength,
      sourcePreview: truncated.content.slice(0, 200),
      createdAt: new Date().toISOString(),
    };
    if (workingStorage) {
      await workingStorage.write(JSON.stringify(entry));
    }
    return { compacted: truncated.content, compactionEntry: entry };
  }
}
