# PLAN-BAIZE-MEMORY-CORE-MIGRATION — baize-memory-core 迁移 plan

> **父规范**: `baize-loop/plan/baize-chat/17-full-specification.md` §11  
> **作者**: BaiZe 架构  
> **创建时间**: 2026-06-22  
> **状态**: pending approval

---

## ASSUMPTIONS

- A1: baize-memory-core 已是事实 slot 形态, 补 slot.json 即可挂载
- A2: fasttext-wasm 迁入作为内部依赖, 不独立暴露
- A3: agent-memory (旧) 已被完全替代, 可安全删除

---

## 1. Objective

将 baize-memory-core 从 `baize-loop/packages/` 移入 `baize-slot/baize-memory-core/`,
补全 slot.json, 吸收 fasttext-wasm 作为内部语义匹配引擎。

---

## 2. 迁移清单

| 来源 | 目标 | 改造量 |
|------|------|--------|
| `baize-loop/packages/baize-memory-core/` | `baize-slot/baize-memory-core/` | 移仓 |
| `baize-loop/packages/fasttext-wasm/` | `baize-memory-core/src/semantic/fasttext/` | 迁入内部 |
| `baize-loop/packages/agent-memory/` | 删除 | 已废弃 |

---

## 3. Task 清单

### Task 1: 移仓 + 补 slot.json
- [x] T1.1 `slot.json` 已创建 (type: process)
- [ ] T1.2 将 baize-memory-core 源码移入 `baize-slot/baize-memory-core/`
- [ ] T1.3 实现 BaizeSlot 接口 (load/init/handle/unload/health)
- [ ] T1.4 确认 memory.episode.commit / memory.episode.recall 能力可用

### Task 2: 吸收 fasttext-wasm
- [ ] T2.1 将 fasttext-wasm 源码移入 `baize-memory-core/src/semantic/fasttext/`
- [ ] T2.2 更新 import 路径
- [ ] T2.3 跑语义匹配测试确认功能正常

### Task 3: 清理
- [ ] T3.1 删除 `baize-loop/packages/agent-memory/`
- [ ] T3.2 删除 `baize-loop/packages/fasttext-wasm/` (已迁入)
- [ ] T3.3 更新 `pnpm-workspace.yaml`

---

## 4. 验证标准

- [ ] 4 层记忆 (working/episodic/semantic/procedural) CRUD 通过
- [ ] embedding 请求经 baize-switch 网关
- [ ] 语义匹配 BM25 + fasttext 结果正常
- [ ] agent-memory 删除后系统无报错

---

## 5. 排期

**Phase 1 (Iteration 0)** — fasttext-wasm 迁入 + agent-memory 删除
**Phase 2** — 移仓 + BaizeSlot 接口实现
