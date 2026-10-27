# ADR-0013: Claude Code 隔离弃用 `--bare`，改用 `--setting-sources ""` + 工具白名单

> **状态**: ACCEPTED
> **决策日期**: 2026-10-20（Asia/Hong_Kong，Tina 批准）；2026-10-27 文档治理重组时抽为独立 ADR
> **实测基线**: `verified_on = "Claude Code 2.1.296 (DeepSeek API 兼容模式) · 2026-10-21"`
> **SUPERSEDES**: W.5a 早期方案「用 `--bare` 启动 Claude Code 以获得最小模式」
> **强依赖代码**: `daemon/worker/cli-host/claude-code-adapter.ts`（该文件的隔离注释直接指向本 ADR）
> **实测档案**: 原 `../archive/claude-code-isolation-design.md`（该归档文件已于 2026-10-27 移除，原文见 Git 历史）

## 背景

Stagent 通过子进程拉起 Claude Code CLI 作为受控 Worker。最初方案采用官方推荐的 `--bare`（minimal mode），期望它「不加载任何用户/项目配置，最安全」。

2026-10-20 的复现实验（A/B/C 三组对照）证伪了这个假设：

| 实验 | CLI 报告的工具 | 结果 | Stagent hook 日志 |
| :--- | :--- | :--- | :--- |
| **A** `--bare` | `['Bash','Edit','Read']`（传入的 Write/Glob/Grep 全部丢失） | 读取**成功** | **不存在 —— hook 一次都没跑** |
| **B** 不带 `--bare` + `--setting-sources ""` | 20 个默认工具 | 被 PreToolUse hook 拦下 | `fired` |
| **C** 不带 `--bare` + `--tools` 白名单 | `['Edit','Glob','Grep','Read','Write']` | 写入被 hook 拦下，文件未创建 | `fired` |

**关键发现**：CLI 帮助写明 `--bare` 会 `skip hooks (those defined in settings and by installed plugins)`。实测确认 2.1.296 的 bare 模式把**用户可配置的 hooks 整体关掉**，包括我们经 `--settings` 传入的那一套。

**后果的严重性**：越界写（写到项目外）这一类**只有 hook 能拦**的攻击面，在 bare 模式下完全没有防护。之所以当时没出事，仅仅是因为 bare 模式恰好也没给 Write 工具——**这是运气，不是设计**。

## 决策

**弃用 `--bare`；改为 `--setting-sources ""` + 显式工具白名单 + 严格 MCP + 环境白名单的组合。** 适配器最终 argv：

```
claude
  --setting-sources ""                      # 不加载 user / project / local 三层设置
  --tools Read,Glob,Grep,LS,Edit,Write,MultiEdit,TodoWrite
  -p <用户消息>
  --output-format stream-json --verbose --include-partial-messages
  --settings <tmp>/stagent-claude-XXXX/settings.json
  --mcp-config <tmp>/stagent-claude-XXXX/mcp.json
  --strict-mcp-config                       # MCP 只认我们给的列表
  --permission-mode acceptEdits             # 永不 bypassPermissions
  --allowedTools <同名单>
  --disallowedTools WebFetch,WebSearch,NotebookEdit,Task,Bash
  [--resume <session_id>]                   # 续接时追加；永不使用 --continue
```

配套三条硬性要求：

1. **专用配置目录**：子进程固定使用 `<repo>/.stagent/claude-config`（0700），**不是**临时目录，以保证 `--resume` 跨 Daemon 重启可用；同时避免污染用户真实 `~/.claude`。
2. **环境变量白名单**：只透传 `PATH, HOME, LANG, STAGENT_HOOK_*, ANTHROPIC_*`（含兼容接口所需的 `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL` 等 8 个），**其它环境变量一律不传**。
3. **四类绕过必须失败关闭**：内置工具越界、Shell（Bash 根本调不到）、改名/删除、symlink 逃逸（hook 按真实路径判定）。实测在 DeepSeek 兼容模式下 4/4 全绿。

## 后果

**正面**：越界防护从「依赖 bare 模式恰好不给 Write」变成「hook + permissions.deny + 工具白名单 + 无 Shell」四层；项目与用户目录里埋的恶意配置（`.claude/settings.json`、`.mcp.json`、`CLAUDE.md`）实测均未被加载。

**代价与约束（必须持续追踪）**：
- `verified_on` 只覆盖 **DeepSeek 兼容模式 + CLI 2.1.296**。**用官方 Anthropic 原装模型 + 官方 CLI 重跑这组负例是未完成的回归项**（不阻塞 v0.1）。
- `--setting-sources ""`（空字符串）是否属官方支持写法，文档只写了「逗号分隔的 user,project,local」，**未明确允许空值**。这是依赖实测行为，**每次升级 Claude Code CLI 都必须重跑 `STAGENT_REAL_CLAUDE=1` 的真实测试**。
- **备选方案已实测但未采用**：`--restricted` 不会跳过我们的 hook，但自身不收窄工具（WebSearch/Task 仍在），仍需配 `--tools`。记录在该实测档案 §3.5（归档文件已移除，原文见 Git 历史），供 CLI 升级后 `--setting-sources ""` 行为改变时切换。
- 已知残余风险：模型仍可用 Read 工具主动读取 `CLAUDE.md` / `.mcp.json`（这是普通文件内容，等同提示词注入），缓解手段是把该类文件当不可信内容交由 Supervisor 规则层处理。
