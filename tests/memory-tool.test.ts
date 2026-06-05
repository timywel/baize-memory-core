// tests/memory-tool.test.ts
// 关键测试：4 件套 API + substring 匹配

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { MemoryTool } from '../src/ingestion/memory-tool';

let testFile: string;

beforeEach(async () => {
  testFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'baize-memtool-')), 'memory.md');
});

afterEach(async () => {
  await fs.rm(path.dirname(testFile), { recursive: true, force: true });
});

describe('MemoryTool', () => {
  it('read returns empty string for nonexistent file', async () => {
    const tool = new MemoryTool(testFile);
    expect(await tool.read()).toBe('');
  });

  it('add appends entries with - prefix', async () => {
    const tool = new MemoryTool(testFile);
    await tool.add('fact 1');
    await tool.add('fact 2');
    const content = await tool.read();
    expect(content).toContain('- fact 1');
    expect(content).toContain('- fact 2');
  });

  it('replace uses substring match', async () => {
    const tool = new MemoryTool(testFile);
    await tool.add('user prefers TypeScript');
    const replaced = await tool.replace('TypeScript', 'JavaScript');
    expect(replaced).toBe(true);
    const content = await tool.read();
    expect(content).toContain('JavaScript');
    expect(content).not.toContain('TypeScript');
  });

  it('replace returns false when substring not found', async () => {
    const tool = new MemoryTool(testFile);
    await tool.add('foo');
    const replaced = await tool.replace('nonexistent', 'bar');
    expect(replaced).toBe(false);
  });

  it('remove uses substring match', async () => {
    const tool = new MemoryTool(testFile);
    await tool.add('old fact to remove');
    await tool.add('keep this');
    const removed = await tool.remove('old fact');
    expect(removed).toBe(true);
    const content = await tool.read();
    expect(content).not.toContain('old fact');
    expect(content).toContain('keep this');
  });

  it('handles 50 concurrent adds without corruption', async () => {
    const tool = new MemoryTool(testFile);
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => tool.add(`entry ${i}`))
    );
    const content = await tool.read();
    const lines = content.split('\n').filter(l => l.startsWith('- '));
    expect(lines.length).toBe(50);
  });
});
