# PLAN-BAIZE-MEMORY-CORE-UPGRADE — baize-memory-core 升级计划

> **作者**: BaiZe 架构 · **创建**: 2026-06-22 · **状态**: pending approval
> **父规范**: `plan/baize-chat/17-full-specification.md` §4.5b, §7.0

---

## 1. 目标

将 baize-memory-core 升级为标准 slot，吸收 fasttext-wasm，预置 sqlite-vec 向量检索接口。

## 2. Task 清单

### 2.1 BaizeSlot 接口 (P1)

- [ ] 实现 `load(ctx, manifest)` — 校验 manifest，注册 capabilities
- [ ] 实现 `init()` — 初始化 memory SDK，开 `memory-embedding.db`
- [ ] 实现 `handle(req)` — 转发 recall / commit / semantic search
- [ ] 实现 `unload()` — 关闭 db，取消事件订阅
- [ ] 实现 `health()` — 检查 SDK 状态 + db 连接

### 2.2 fasttext-wasm 内迁 (P1)

- [ ] 代码移入 `src/semantic/fasttext/`
- [ ] BM25 + fasttext 语义匹配集成
- [ ] 测试: 100 条记忆召回 top-K 准确率 ≥ 80%

### 2.3 sqlite-vec 预置 (P3 实施, 接口 P1 预留)

- [ ] 定义 `VectorDriver` 接口 (`insertEmbedding`, `searchSimilar`, `deleteEmbedding`)
- [ ] 初始实现为 `NoopVectorDriver`（空操作，不阻塞）
- [ ] `memory-embedding.db` VIRTUAL TABLE schema 已设计（17-full-spec §4.5b）
- [ ] embedding 请求经 baize-switch 路由

### 2.4 前后端测试

- [ ] 单测: 4 层记忆 CRUD (≥ 50 case)
- [ ] 前端: memory 管理页面正常
- [ ] Playwright: memory recall 集成 baize-chat prompt 验证
- [ ] 性能: recall 延迟 ≤ 200ms (P50), ≤ 500ms (P99)

## 3. 验收

- [ ] BaizeSlot 4 阶段生命周期全过
- [ ] embedding 请求走 baize-switch
- [ ] 前端功能无回归
