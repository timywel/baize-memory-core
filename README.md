# @timywel/baize-memory-core

> 白泽 4 层认知记忆核心库：BM25 + frozen snapshot + heartbeat + dreaming
> (BaiZe 4-layer cognitive memory core: working / episodic / semantic / procedural layers, BM25 retrieval, frozen snapshot, heartbeat compaction, dreaming consolidation)

## 状态

**v0.3.0** — slot 形态完整, 可挂载到 baize-loop 主控 (见 `slot.json`)

- [x] 4 层 storage: `working` / `episodic` / `semantic` / `procedural`
- [x] BM25 检索 + rrfFuse / mmr 重排
- [x] frozen snapshot (按字符预算冻结)
- [x] heartbeat 压缩 + dreaming 整合
- [x] 共享层 (跨 profile)
- [x] BaizeSlot 适配 (4 capabilities)
- [x] 86 测试通过 (vitest)

## 暴露的 slot capabilities

| Route | 实现 |
|-------|------|
| `memory.episode.commit` | `addEpisodicMemory` |
| `memory.episode.recall` | `searchMemories` (episodic 层) |
| `memory.semantic.search` | `searchMemories` (semantic 层 + shared) |
| `memory.procedural.load` | `searchMemories` (procedural 层) |

## 安装

```bash
npm install @timywel/baize-memory-core
```

## 用法 (作为库)

```ts
import { createBaiZeMemoryCore } from '@timywel/baize-memory-core';

const core = createBaiZeMemoryCore({
  profileId: 'alice',
  basePath: '~/.baize/memory/alice',
});

await core.addEpisodicMemory('白泽会议讨论了 v0.3 升级');
const results = await core.searchMemories('白泽', { limit: 5 });
```

## 用法 (作为 slot)

```ts
import { createSlot } from '@timywel/baize-memory-core';
import manifest from './slot.json';

const slot = createSlot(manifest);
await slot.load(ctx, manifest);
await slot.init();
// 主控调用 slot.handle({ route, body, ... })
```

## 关联文档

- `baize-loop/plan/baize-chat/17-full-specification.md` §7.0 — 三 Slot 协作模型
- `baize-loop/plan/baize-chat/13-memory-core-upgrade-20260622-093256.md` — 升级计划

## License

MIT © Tim Ywel
