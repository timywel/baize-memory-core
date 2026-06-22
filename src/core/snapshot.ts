// src/core/snapshot.ts
// 借鉴 hermes frozen snapshot：会话开始一次性注入 system prompt，会话内不更新（保护 prefix cache）

import { countChars, softTruncate, isOverLimit } from '../util/chars.js';

export interface SnapshotData {
  memoryMd: string;
  sharedMd: string;
  // v3.2 B-3: slots 字段已删除
}

export interface FrozenSnapshot extends SnapshotData {
  capturedAt: string;
  truncated: boolean;
  totalChars: number;
}

export interface SnapshotOptions {
  maxChars?: number;  // 默认 8000
}

export class SnapshotManager {
  private snapshot: FrozenSnapshot | null = null;
  private readonly maxChars: number;

  constructor(options: SnapshotOptions = {}) {
    this.maxChars = options.maxChars ?? 8000;
  }

  capture(data: SnapshotData): FrozenSnapshot {
    const totalChars = countChars(data.memoryMd) + countChars(data.sharedMd);
    let { memoryMd } = data;
    let truncated = false;

    if (isOverLimit(memoryMd, this.maxChars)) {
      const result = softTruncate(memoryMd, this.maxChars);
      memoryMd = result.content;
      truncated = true;
    }

    this.snapshot = {
      memoryMd,
      sharedMd: data.sharedMd,
      capturedAt: new Date().toISOString(),
      truncated,
      totalChars,
    };
    return this.snapshot;
  }

  getCurrent(): FrozenSnapshot | null {
    return this.snapshot;
  }

  injectIntoPrompt(): string {
    if (!this.snapshot) return '';
    const parts: string[] = [];
    if (this.snapshot.memoryMd) {
      parts.push(`## 持久记忆 (frozen snapshot)\n${this.snapshot.memoryMd}`);
    }
    if (this.snapshot.sharedMd) {
      parts.push(`## 跨 profile 共享\n${this.snapshot.sharedMd}`);
    }
    // v3.2 B-3: slots 渲染已删除
    return parts.join('\n\n');
  }

  /** 测试用：清空 snapshot */
  reset(): void {
    this.snapshot = null;
  }
}
