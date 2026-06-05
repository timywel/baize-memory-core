// src/ingestion/memory-tool.ts
// 借鉴 hermes `memory` 工具：add/replace/remove/read，substring 匹配防 LLM 偷懒读全文

import * as fs from 'node:fs/promises';
import { withMutex } from '../util/mutex.js';
import { logger } from '../util/logger.js';

const log = logger('memory-tool');

export class MemoryTool {
  private cache: string | null = null;
  private cacheLoaded = false;

  constructor(private readonly filePath: string) {}

  async read(): Promise<string> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      this.cache = content;
      this.cacheLoaded = true;
      return content;
    } catch {
      this.cache = '';
      this.cacheLoaded = true;
      return '';
    }
  }

  /** 同步读取缓存（用于心跳等高频调用） */
  readCached(): string {
    return this.cache ?? '';
  }

  /** 主动失效缓存（外部修改文件后调用） */
  invalidateCache(): void {
    this.cache = null;
    this.cacheLoaded = false;
  }

  async add(entry: string): Promise<void> {
    return withMutex(`memtool-add-${this.filePath}`, async () => {
      const current = await this.read();
      const updated = current ? `${current}\n- ${entry}` : `- ${entry}`;
      // 自动创建父目录
      const dir = this.filePath.split('/').slice(0, -1).join('/');
      if (dir) {
        await fs.mkdir(dir, { recursive: true });
      }
      await fs.writeFile(this.filePath, updated, 'utf-8');
      log.debug(`Added entry to ${this.filePath}`);
    });
  }

  async replace(oldSubstring: string, newEntry: string): Promise<boolean> {
    return withMutex(`memtool-replace-${this.filePath}`, async () => {
      const current = await this.read();
      if (!current.includes(oldSubstring)) {
        log.warn(`Substring not found: ${oldSubstring}`);
        return false;
      }
      // 替换包含子串的行
      const lines = current.split('\n');
      const newLines = lines.map(line =>
        line.includes(oldSubstring) ? `- ${newEntry}` : line
      );
      await fs.writeFile(this.filePath, newLines.join('\n'), 'utf-8');
      return true;
    });
  }

  async remove(substring: string): Promise<boolean> {
    return withMutex(`memtool-remove-${this.filePath}`, async () => {
      const current = await this.read();
      if (!current.includes(substring)) return false;
      const lines = current.split('\n').filter(line => !line.includes(substring));
      await fs.writeFile(this.filePath, lines.join('\n'), 'utf-8');
      return true;
    });
  }
}
