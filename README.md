# @timywel/baize-memory-core

> 白泽（baize）4 层认知记忆核心库

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node 18+](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

**核心特性**：
- ✅ 4 层认知记忆：working / episodic / semantic / procedural
- ✅ 真实 BM25 检索（k1=1.5, b=0.75, IDF + 长度归一）
- ✅ RRF + MMR 融合（多路召回 + 多样性重排）
- ✅ 字符硬上限（4k 软 / 8k 硬，借鉴 hermes）
- ✅ Frozen Snapshot（会话开始一次性注入，保护 prefix cache）
- ✅ Memory 工具 API（add/replace/remove/read，借鉴 hermes）
- ✅ CompactionEntry（context 满时内联摘要，借鉴 pi）
- ✅ HeartbeatService（高频被动体检 + 应急动作）
- ✅ DreamingAdapter（低频主动晋升，包装现有 DreamingService）
- ✅ ExternalProvider（借鉴 hermes 单一可插拔抽象）
- ✅ 零外部依赖（clean-room 重写）

## 快速开始

```bash
npm install
npm test
npm run build
```

```typescript
import {
  createBaiZeMemoryCore,
  BM25,
  rrfFuse,
  HeartbeatService,
  // ...21 symbols total
} from '@timywel/baize-memory-core';

const core = createBaiZeMemoryCore({
  profileId: 'developer',
  basePath: 'profiles/developer/memory/.baize',
});

await core.addSemanticMemory('用户偏好 TypeScript');
const results = await core.searchMemories('TypeScript');
```

## 架构

```
src/
├── core/            # BaiZeMemoryCore 主类 + 4 层接口 + frozen snapshot
├── retrieval/       # BM25 + RRF + MMR
├── ingestion/       # memory 工具 API
├── compaction/      # CompactionEntry
├── heartbeat/       # HeartbeatService
├── dreaming/        # DreamingAdapter
├── external/        # ExternalProvider 抽象
├── util/            # chars / mutex / logger
└── index.ts         # 21 公共符号 re-export
```

## 借鉴与归属声明

本库为 clean-room 实现，借鉴以下项目的**设计思想**（非代码片段）：

| 项目 | 协议 | 借鉴内容 | 实现文件 |
|---|---|---|---|
| [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | MIT | 字符硬上限 + frozen snapshot + memory 工具 | `util/chars.ts` `core/snapshot.ts` `ingestion/memory-tool.ts` |
| [earendil-works/pi](https://github.com/earendil-works/pi) | MIT | CompactionEntry 内联摘要 | `compaction/compaction-entry.ts` |
| [NevaMind-AI/memU](https://github.com/NevaMind-AI/memU) | Apache 2.0 | 仅作调研参考 | - |

**验证依据**：`docs/SOURCES-LICENSE.md`（已用 curl + anysearch 实际验证）

所有实现均为标准算法（BM25 Okapi / RRF / MMR / Intl.Segmenter 字符截断 / Promise-chain mutex）+ Web 标准 API，不含借鉴项目的独特代码片段、注释、变量命名、文档原文。

## 设计哲学

- **不集成**第三方记忆库（mem0/letta/engram 等）
- **不引入**向量数据库（lancedb/qdrant/pgvector）
- **不发布**到 npm（保留本地 monorepo 使用）
- **不依赖** baize-loop 任何代码（独立可运行）

## 测试

```bash
npm test           # 76 tests, 13 files
npm run lint       # tsc --noEmit (0 errors)
npm run build      # dist/ generated
```

## 集成到 baize-loop

详细文档：[`integration/baize-memory-integration.md`](integration/baize-memory-integration.md)

```bash
# 1. 同步到 baize-loop 子包
bash baize-loop/scripts/sync-from-规范.sh memory/baize-memory-core

# 2. baize-loop/package.json 加 workspace
"workspaces": ["packages/baize-memory-core", ...]

# 3. 改 16 个 import 路径 (createBaiZeMemoryClient → createBaiZeMemoryCore)
# 4. 删除旧 memory-lib (Python) + packages/agent-memory (rohitg00 fork)
```

## 版本历史

| 版本 | 日期 | 状态 |
|---|---|---|
| v0.1.0 | 2026-06-05 | ✅ 13 模块 + 76 测试 + 0 build 错误 + 包级 import 可用 |

## 许可证

MIT © 2026 timywel
