# ADR-0002: 单工作区互斥执行与包管理器缓存隔离

> **状态**: ACCEPTED
> **基线**: 架构规范 v1.6.1（commit `4280de6`，2026-10-24）
> **源自**: 《系统架构设计规范》§8 ADR-002
> **相关**: ADR-0003（Worktree 能力边界）、ADR-0009（串行拓扑）、`daemon` 工作区锁

## 背景

Host workspace 是宿主机上的真实项目目录。若允许两个进程（或两个 Stagent 实例）同时在同一工作区执行写操作，会出现三类不可恢复的损坏：

1. **.git 索引争用**：并发 `git add` / `worktree add` 会留下 half-written 的 `config.lock` / `index.lock`，使仓库直接不可提交；
2. **施工覆盖**：Worker A 与 Worker B 在同一份文件上互相覆盖，`node_patch_fingerprint` 失去意义；
3. **撤销语义崩塌**：「回到本轮开始前」无法定义——回到谁的开始前？

与此同时，完全禁止包管理器的共享缓存会让每个 Worktree 都重新安装依赖，`TASK-D.2b` 的「零拷贝挂载」目标不可能达成。

## 决策

**两条同时成立，互不替代：**

1. **v0.1 强制单工作区互斥执行**。第二个实例化请求一律以 `E_WORKSPACE_LOCKED`（HTTP 409）拒绝，并给出白话文案，**禁止静默抢占**。
2. **复用全局内容寻址包缓存，但禁止软链接写共享**。即：只读侧（安装结果）可共享、可借符号链接挂载；任何可能发生的**写**必须落在各自 Worktree 内。

## 后果

**正面**：彻底消灭并发写造成的Git 元数据损坏与施工覆盖；依赖安装耗时被压缩到 symlink 级别（见 `deps-reuse` 测试）。

**代价与约束**：
- 互斥由 PID 锁 + 活进程健康检查实现，`TASK-C.10h` 曾出现「旧版 Daemon 被健康检查误判为可复用、路由未挂载导致 404」的生产缺陷（见 [`../archive/core-asset-governance-and-change-triage.md`](../archive/core-asset-governance-and-change-triage.md) 同类问题；修复见 `TASK-C.10h` 热修）。**锁的成功 ≠ 代码版本一致**，后续引入 `isDaemonCodeStale` 正是为此。
- 多仓并行施工被推到 v0.2+（见 [`../rfc/v0.2-multi-agent-pipeline.md`](../rfc/v0.2-multi-agent-pipeline.md) §5）。
