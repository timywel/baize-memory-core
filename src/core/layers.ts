// src/core/layers.ts
// 4 层文件系统 storage：working / episodic / semantic / procedural
// 100% 兼容 baize-loop 现有路径：profiles/<id>/memory/.baize/{layer}/

import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { withMutex } from '../util/mutex.js';
import { logger } from '../util/logger.js';

const log = logger('layers');

export type Layer = 'working' | 'episodic' | 'semantic' | 'procedural';

export interface MemoryEntry {
  id: string;
  content: string;
  layer: Layer;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export class LayerStorage {
  constructor(
    private readonly basePath: string,
    private readonly layer: Layer
  ) {}

  private get dir(): string {
    // episodic 单独存到 sessions/ 子目录（兼容 baize 现有路径）
    const sub = this.layer === 'episodic' ? 'episodic/sessions' : this.layer;
    return `${this.basePath}/${sub}`;
  }

  async write(content: string, metadata?: Record<string, unknown>): Promise<string> {
    return withMutex(`${this.layer}-write`, async () => {
      await fs.mkdir(this.dir, { recursive: true });
      const entry: MemoryEntry = {
        id: randomUUID(),
        content,
        layer: this.layer,
        metadata,
        createdAt: new Date().toISOString(),
      };
      await fs.writeFile(
        `${this.dir}/${entry.id}.json`,
        JSON.stringify(entry, null, 2),
        'utf-8'
      );
      log.debug(`wrote ${this.layer}/${entry.id}`);
      return entry.id;
    });
  }

  async readAll(): Promise<MemoryEntry[]> {
    try {
      // 同时读 .json（新格式）和 .md（旧 dreaming-service 写入的格式）
      const files = (await fs.readdir(this.dir))
        .filter(f => f.endsWith('.json') || f.endsWith('.md'));
      const settled = await Promise.allSettled(
        files.map(f => fs.readFile(`${this.dir}/${f}`, 'utf-8'))
      );
      const entries: MemoryEntry[] = [];
      for (let i = 0; i < settled.length; i++) {
        const result = settled[i];
        if (result.status !== 'fulfilled') continue;
        const filename = files[i];
        if (filename.endsWith('.json')) {
          try {
            entries.push(JSON.parse(result.value) as MemoryEntry);
          } catch {
            // 忽略损坏 JSON
          }
        } else if (filename.endsWith('.md')) {
          // 旧格式：纯 Markdown 摘要（如 "session-2026-06-05-...md"）
          // 转换为 MemoryEntry 以兼容旧数据
          const id = filename.replace(/\.md$/, '');
          const content = result.value;
          // 提取标题后的正文（去掉 "# 会话摘要" 头）
          const bodyMatch = content.match(/(?:# .*?\n\n)([\s\S]*)/);
          const body = bodyMatch ? bodyMatch[1].trim() : content;
          entries.push({
            id,
            content: body,
            layer: this.layer,
            metadata: { _legacyMd: true },
            createdAt: this.extractDateFromFilename(filename) ?? new Date().toISOString(),
          });
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  /** 从 "session-2026-06-05T..." 提取 ISO 日期 */
  private extractDateFromFilename(filename: string): string | null {
    const m = filename.match(/(\d{4}-\d{2}-\d{2}T[\d-]+)/);
    return m ? m[1].replace(/-/g, (mm, offset, full) => (offset < 10 ? mm : ':')) + 'Z' : null;
  }

  async delete(id: string): Promise<void> {
    return withMutex(`${this.layer}-delete-${id}`, async () => {
      try {
        await fs.unlink(`${this.dir}/${id}.json`);
      } catch { /* 忽略 */ }
    });
  }

  async deleteAll(): Promise<number> {
    let count = 0;
    try {
      const files = (await fs.readdir(this.dir)).filter(f => f.endsWith('.json'));
      for (const f of files) {
        await fs.unlink(`${this.dir}/${f}`);
        count++;
      }
    } catch { /* 目录不存在 */ }
    return count;
  }
}
