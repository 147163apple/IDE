#!/usr/bin/env node
/**
 * TASK-W.5a Claude Code PreToolUse hook（由 Claude Code 自己调用，不由 Stagent spawn）。
 * 只有 exit 2 或 JSON permissionDecision:"deny" 才会拦截；所以任何异常都按「拒绝」处理。
 * 规则（W.4 的 4 类绕过的 hook 层兜底）：
 *  1. 写类工具的目标路径必须在 STAGENT_HOOK_ROOT 内；
 *  2. Shell（Bash）默认拒绝，除非 STAGENT_HOOK_ALLOW_BASH=1；
 *  3. 不得触碰 .git / .stagent / .claude / .mcp.json，也不得经 ../ 访问主工作树；
 *  4. 不在白名单内的工具（含未知 MCP 工具）一律拒绝。
 */
import fs from "node:fs";
import path from "node:path";

const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "TodoWrite", "Task"]);
const PROTECTED_SEGMENTS = [".git", ".stagent", ".claude"];

function deny(reason) {
  const out = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
  process.stdout.write(JSON.stringify(out));
  process.stderr.write(`Stagent 拦截：${reason}\n`);
  log({ decision: "deny", reason });
  process.exit(2);
}

let input = {};
function log(entry) {
  const file = process.env.STAGENT_HOOK_LOG;
  if (!file) return;
  try {
    fs.appendFileSync(
      file,
      JSON.stringify({
        at: new Date().toISOString(),
        tool: input.tool_name,
        ...entry,
      }) + "\n",
    );
  } catch {
    // 日志失败不影响判定
  }
}

function inside(root, p) {
  const rel = path.relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

try {
  const raw = fs.readFileSync(0, "utf8");
  input = JSON.parse(raw || "{}");
  const root = process.env.STAGENT_HOOK_ROOT;
  if (!root) deny("未配置 STAGENT_HOOK_ROOT");
  const realRoot = fs.realpathSync(root);
  const tool = String(input.tool_name ?? "");
  const ti = input.tool_input ?? {};

  if (tool === "Bash") {
    if (process.env.STAGENT_HOOK_ALLOW_BASH !== "1")
      deny("未授权的 Shell 命令");
    log({ decision: "allow" });
    process.exit(0);
  }

  const target = ti.file_path ?? ti.notebook_path ?? ti.path;
  if (WRITE_TOOLS.has(tool) || (READ_TOOLS.has(tool) && target)) {
    if (WRITE_TOOLS.has(tool) && !target) deny("写入缺少目标路径");
    if (target) {
      const abs = path.resolve(realRoot, String(target));
      let real = abs;
      try {
        // 已存在的路径按真实路径判定（防 symlink 逃逸）；不存在则判其父目录
        real = fs.existsSync(abs)
          ? fs.realpathSync(abs)
          : path.join(fs.realpathSync(path.dirname(abs)), path.basename(abs));
      } catch {
        real = abs;
      }
      if (!inside(realRoot, real)) deny(`路径在工作目录之外：${target}`);
      const rel = path.relative(realRoot, real).split(path.sep);
      // 读写都不许碰 Claude Code 专用配置目录（会话记录）和 Daemon 会话令牌
      if (
        rel[0] === ".stagent" &&
        (rel[1] === "claude-config" || rel[1] === "session-token")
      ) {
        deny(`受保护路径：${target}`);
      }
      if (WRITE_TOOLS.has(tool)) {
        if (
          rel.some((seg) => PROTECTED_SEGMENTS.includes(seg)) ||
          rel.at(-1) === ".mcp.json"
        ) {
          deny(`受保护路径：${target}`);
        }
      }
    }
    log({ decision: "allow" });
    process.exit(0);
  }

  if (READ_TOOLS.has(tool)) {
    log({ decision: "allow" });
    process.exit(0);
  }
  deny(`未在白名单内的工具：${tool}`);
} catch (err) {
  deny(`hook 内部错误，按拒绝处理：${err && err.message}`);
}
