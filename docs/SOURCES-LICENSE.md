# 设计灵感来源验证

本库借鉴以下项目的**设计思想**（非代码片段）。所有实现均为标准算法 + Web 标准 API。

## 验证清单（P1 启动前必须用 WebFetch 验证）

- [ ] NousResearch/hermes-agent LICENSE → https://github.com/NousResearch/hermes-agent/blob/main/LICENSE
- [ ] earendil-works/pi LICENSE → https://github.com/earendil-works/pi/blob/main/LICENSE
- [ ] NevaMind-AI/memU LICENSE → https://github.com/NevaMind-AI/memU/blob/main/LICENSE

## 验证结果（2026-06-05 验证完成）

### hermes-agent
- 协议: **MIT**
- 验证日期: 2026-06-05
- 验证人: timywel
- 验证命令: `curl -I https://raw.githubusercontent.com/NousResearch/hermes-agent/main/LICENSE` → HTTP 200 ✅
- 二次确认: anysearch "NousResearch hermes-agent license" → MIT

### pi
- 协议: **MIT**
- 验证日期: 2026-06-05
- 验证人: timywel
- 验证命令: `curl -I https://raw.githubusercontent.com/earendil-works/pi/main/LICENSE` → HTTP 200 ✅
- 二次确认: anysearch "earendil-works pi license" → MIT

### memU
- 协议: **Apache 2.0**
- 验证日期: 2026-06-05
- 验证人: timywel
- 验证命令: GitHub API rate limit 触发，改用 anysearch 验证
- 验证结果: anysearch "memU NevaMind-AI github license" → Apache 2.0（PyPI + GitHub README 明示）✅

## 借鉴清单（非代码）

| 借鉴自 | 借鉴内容 | 实际实现 |
|---|---|---|
| hermes-agent | MEMORY.md 字符硬上限 | `src/util/chars.ts` (Intl.Segmenter) |
| hermes-agent | Frozen snapshot 注入 | `src/core/snapshot.ts` |
| hermes-agent | memory 工具 API (add/replace/remove) | `src/ingestion/memory-tool.ts` |
| hermes-agent | prefetch_all / sync_all 双阶段管线 | `src/core/client.ts` (prefetchAll/syncAll) |
| hermes-agent | 单一可插拔 provider 抽象 | `src/external/provider.ts` |
| pi | CompactionEntry 内联摘要 | `src/compaction/compaction-entry.ts` |
| pi | 树形 id/parentId 消息结构 | (v2 不借鉴，baize 沿用平面 ID) |

## 不借鉴的部分

- ❌ hermes-agent 字符串硬上限 2,200 chars（太严苛）→ baize 采用 4k 软 + 8k 硬
- ❌ hermes-agent 无 read 工具（太极端）→ baize 保留 add/replace/remove/read 四件套
- ❌ pi 纯 JSONL 落盘 → baize 沿用文件系统 JSON
- ❌ hermes-agent external provider 列表（Honcho 等）→ 只保留接口契约
