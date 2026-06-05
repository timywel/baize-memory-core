// tests/layers.test.ts
// 关键测试：4 层写入/读取/删除 + 并发安全

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { LayerStorage } from '../src/core/layers';

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'baize-layers-'));
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

describe('LayerStorage', () => {
  it('write + readAll for working layer', async () => {
    const storage = new LayerStorage(testDir, 'working');
    const id = await storage.write('hello working');
    const entries = await storage.readAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(id);
    expect(entries[0].content).toBe('hello working');
    expect(entries[0].layer).toBe('working');
  });

  it('episodic layer goes to sessions/ subdirectory', async () => {
    const storage = new LayerStorage(testDir, 'episodic');
    await storage.write('session summary');
    const sessionsDir = path.join(testDir, 'episodic', 'sessions');
    const files = await fs.readdir(sessionsDir);
    expect(files).toHaveLength(1);
  });

  it('returns empty array for nonexistent directory', async () => {
    const storage = new LayerStorage(path.join(testDir, 'nonexistent'), 'semantic');
    expect(await storage.readAll()).toEqual([]);
  });

  it('handles 100 concurrent writes without data loss', async () => {
    const storage = new LayerStorage(testDir, 'semantic');
    const promises = Array.from({ length: 100 }, (_, i) =>
      storage.write(`fact ${i}`)
    );
    const ids = await Promise.all(promises);
    expect(new Set(ids).size).toBe(100); // all unique
    const entries = await storage.readAll();
    expect(entries).toHaveLength(100);
  });

  it('delete removes entry', async () => {
    const storage = new LayerStorage(testDir, 'procedural');
    const id = await storage.write('to delete');
    await storage.delete(id);
    expect(await storage.readAll()).toEqual([]);
  });

  it('deleteAll returns count', async () => {
    const storage = new LayerStorage(testDir, 'working');
    await storage.write('a');
    await storage.write('b');
    await storage.write('c');
    const count = await storage.deleteAll();
    expect(count).toBe(3);
    expect(await storage.readAll()).toEqual([]);
  });

  it('corrupted JSON files are skipped silently', async () => {
    const storage = new LayerStorage(testDir, 'semantic');
    await storage.write('good');
    // 手动写入损坏 JSON
    const dir = path.join(testDir, 'semantic');
    await fs.writeFile(path.join(dir, 'bad.json'), 'not json{{{');
    const entries = await storage.readAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].content).toBe('good');
  });
});
