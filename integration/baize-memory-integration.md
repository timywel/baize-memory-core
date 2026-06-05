# baize-memory-core 集成实施计划

> **版本**：1.0.0 | **日期**：2026-06-05 | **状态**：P0 完成，待 P1 启动

## 一、架构设计

### 1.1 核心理念

- **规范库 + 消费方**：`@timywel/baize-memory-core` 在 `规范/memory/baize-memory-core/` 设计与迭代
- **全量替换**：旧 `memory-lib` (Python) + `agent-memory-client.ts` 全删
- **1 轨 session-start**：替代 3 轨并行
- **Heartbeat + Dreaming + Compaction 三者协同**

### 1.2 目录变化

#### 新增（source of truth）

```
/home/timywel/AI_Product/规范/memory/baize-memory-core/
├── package.json               @timywel/baize-memory-core v0.1.0
├── tsconfig.json              ES2022 + Bundler
├── LICENSE                    MIT
├── README.md                  库说明
├── .gitignore
├── docs/
│   └── SOURCES-LICENSE.md     借鉴来源验证清单
├── src/                       13 个核心模块
│   ├── core/
│   ├── retrieval/
│   ├── ingestion/
│   ├── compaction/
│   ├── heartbeat/
│   ├── dreaming/
│   ├── external/
│   ├── util/
│   └── index.ts
└── tests/                     TDD 单元 + 集成测试
```

#### 消费方（baize-loop）

```
/home/timywel/AI_Product/baize-loop/
├── packages/baize-memory-core/      ← sync 同步目录
├── meta/memory/agent-memory-client.ts  ← 改写为薄 wrapper
├── .claude/hooks/                    ← 12 → 9 钩子
├── docs/08-架构决策/ADR-002-baize-memory-v3.md
└── scripts/sync-from-规范.sh        ← 同步脚本
```

#### 删除（清理目标）

```
baize-loop/
├── memory-lib/                                ← 整个目录
├── packages/agent-memory/                     ← 整个目录 (58M)
├── meta/memory/INDEX.md, env-detector.ts      ← 旧客户端
├── .claude/hooks/auto-memory-session-start.ts ← 3 轨合 1
├── meta/hooks/auto-memory-session-start.ts    ← 同上
├── temp/artifacts/memory-service/             ← LanceDB 残留
├── meta/services/api/agent-memory.ts          ← 旧 HTTP 路由
├── meta/services/api-router.ts (改)           ← 删 agent-memory 路由
├── frontend/vite.config.js (改)               ← 删 memory-lib proxy
└── ... (共 70+ 个文件)
```

### 1.3 集成方式

| 组件 | 集成方式 | 调用方式 |
|---|---|---|
| baize-memory-core | npm workspace → packages/ | `import("@timywel/baize-memory-core")` |
| 同步脚本 | bash | `bash scripts/sync-from-规范.sh` |
| 协议 | MIT | npm publish 可发版 |

## 二、前置条件

### 2.1 环境

- Node.js >= 18 ✅
- TypeScript 5.6+ ✅
- vitest 2.1+ ✅
- Python 3.10+ (仅用于检查旧 memory-lib 残留)
- bash 5.x

### 2.2 数据规模基线（P0 已完成）

| 维度 | 数值 |
|---|---|
| users 总数 | 18 |
| 真实记忆条数 | ~11 条（84 条是测试数据）|
| shared 记忆 | 4 条 |
| .baize 总体积 | 6.7M |
| memory-lib 状态 | :20031 正在运行 |

### 2.3 备份

```
/home/timywel/backup/baize-pre-v3-20260605/
大小: 6.7M
权限: chmod 700
保留期: P6 发布后 30 天
```

## 三、实施步骤

### 步骤 1: P0 数据规模盘点 + 备份（已完成 2026-06-05）

- [x] 备份 `~/.baize/`
- [x] 6 项数据盘点
- [x] DECISIONS.md §3 记录
- [x] ADR-002 创建
- [x] sync-from-规范.sh 创建

### 步骤 2: P1 规范库骨架（待启动）

```bash
cd /home/timywel/AI_Product/规范/memory/baize-memory-core
npm install
npm test   # 0 test
npm run build
```

git tag: `v3-p1-scaffold`

### 步骤 3: P2 13 个核心文件 TDD 实施（4 天）

按文档 2 §2 实施顺序：

```
Day 1: util/chars + util/mutex + util/logger
Day 2: retrieval/bm25 + retrieval/ranker
Day 3: core/layers + core/snapshot + ingestion/memory-tool
       + heartbeat + dreaming + compaction + external
Day 4: core/client (依赖 Day 3 所有模块)
```

每个模块 TDD 红绿重构 + git tag。

### 步骤 4: P3 同步到 baize

```bash
cd /home/timywel/AI_Product/baize-loop

# 1. 同步
bash scripts/sync-from-规范.sh memory/baize-memory-core

# 2. 修改 package.json workspaces
# 加入 "packages/baize-memory-core"

# 3. 安装
npm install
npm ls @timywel/baize-memory-core
```

### 步骤 5: P4 旧 memory 清理（关键：先停服 + 迁数据）

```bash
# 1. 停 memory-lib
curl -s http://127.0.0.1:20031/health
# 找到 PID, kill

# 2. 迁移 95 条记忆（如果需要）
# 数据在 ~/.baize/data/users/<uid>/memory/memories/*.md
# 由 memory-lib 写入, 删除前评估是否要保留

# 3. 删除旧组件
rm -rf memory-lib/ packages/agent-memory/
rm meta/memory/INDEX.md meta/memory/env-detector.ts
# ... 70+ 文件
```

### 步骤 6: P5 钩子改造

按文档 2 §5 改造 5 个钩子，删除 2 个。

### 步骤 7: P6 测试 + 文档

- L1-L6 测试
- 决策记录最终版
- 人类版（HTML/PDF/PPTX）
- baize-loop/docs/DECISIONS/002-baize-memory-v3.md
- git tag `v3-p6-released`

## 四、关键设计决策

### 4.1 Storage 路径 100% 兼容

新方案的 4 层 storage 路径与旧 `agent-memory-client.ts` 完全一致：
- `working/`
- `episodic/sessions/`
- `semantic/`
- `procedural/`

**无数据迁移负担**（profiles 目录实际为空，仅 memory-lib 数据需评估）。

### 4.2 Slots 系统保留

7 个 slot 配置文件（persona / user_preferences / tool_guidelines / project_context / pending_items / session_patterns / self_notes）**继续存在**，由新方案 `getSlot/setSlot` 读写。

### 4.3 DreamingService 包装

现有 `BaiZeDreamingService`（6 维评分）**完全保留**，新方案 `DreamingAdapter` 仅作为外层包装。

## 五、风险与缓解

详见 `plan/进行中/baize-memory-v3/00-overview.md` §7。

**最关键风险**：
- **R7（数据丢失，高）**：P0 已完成备份 ✅
- **R8（frontend 引用，中）**：审计后已修正清单
- **R12（旧数据无法读，高）**：P0 确认 profiles 空，兼容压力小
- **R14（字符截断误触发，中）**：P0 确认数据小（4 条 shared 平均 230 bytes），不会触发

## 六、Rollback 策略

每个 P 阶段后打 tag，rewind 命令：

```bash
git stash push -u -m "pre-rewind-$(date +%s)"
git reset --hard v3-p<n-1>-tag
# 验证
git stash show --stat
# 决定 pop 或 drop
```

## 七、参考

- v2 调研报告: `plan/待完成/memory-system-research-v2.md`
- 5 个实施文档: `plan/进行中/baize-memory-v3/`
- 6 维度审计: 31 个🔴严重问题全部自我修复
- DECISIONS: `plan/进行中/baize-memory-v3/DECISIONS.md`
- baize-loop ADR-002: `docs/08-架构决策/ADR-002-baize-memory-v3.md`
