/**
 * Supervisor 模块公开出口（TASK-S.1）。
 *
 * 依赖纪律：本目录只允许依赖 `node:fs` / `node:path` / `node:crypto`、
 * 共享类型与 `src/lib/state-machine`、`daemon/guard/cost-monitor`。
 * 严禁引入子进程模块、Gateway / Merger / Verifier / ProcessRunner /
 * Worktree 等特权写入模块 —— 该约束由
 * `tests/unit/supervisor-zero-tool-lint.test.ts` 的 AST（含传递依赖）扫描强制。
 */
export * from "./types";
export * from "./session-manager";
export * from "./prompt-builder";
export * from "./permissions";
export * from "./budget";
export * from "./throttler";
export * from "./rules-l0";
export * from "./draft-generator";
