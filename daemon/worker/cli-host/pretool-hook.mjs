#!/usr/bin/env node
/**
 * TASK-W.5a Claude Code PreToolUse hook（由 Claude Code 自己调用，不由 Stagent spawn）。
 * 只有 exit 2 或 JSON permissionDecision:"deny" 才会拦截；所以任何异常都按「拒绝」处理。
 * 规则（W.4 的 4 类绕过的 hook 层兜底）：
 *  1. 写类工具的目标路径必须在 STAGENT_HOOK_ROOT 内；
 *  2. Shell（Bash）默认拒绝，除非 STAGENT_HOOK_ALLOW_BASH=1；即便允许，
 *     也另有两道门禁：核心元数据路径（.stagent/.git/.claude/.cursor/.env）一律拒绝，
 *     命令中经 `..` 或绝对路径指向工作目录之外的重定向/写目标一律拒绝；
 *  3. 不得触碰 .git / .stagent / .claude / .mcp.json，也不得经 ../ 访问主工作树；
 *  4. 不在白名单内的工具（含未知 MCP 工具）一律拒绝。
 */
import fs from "node:fs";
import path from "node:path";

const WRITE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "TodoWrite", "Task"]);
const PROTECTED_SEGMENTS = [".git", ".stagent", ".claude"];

/**
 * Shell 通道的保留区（G-3 加固，2026-10-21）：
 * 允许 Bash 之后，`rm -rf .stagent` 这类命令绕过了 Write/Edit 的路径判定，
 * 因此对命令词元按「路径段」精确匹配，命中即拒绝。
 * 按段匹配（而不是子串）是为了不误伤 `.gitignore` / `.github` / `.envrc`。
 */
const RESERVED_SHELL_SEGMENTS = [".stagent", ".git", ".claude", ".cursor"];
/** `> /dev/null` 这类常规写法必须放行，否则大量正常命令被误伤 */
const SAFE_DEVICE_TARGETS = new Set([
  "/dev/null",
  "/dev/stdout",
  "/dev/stderr",
  "/dev/fd/1",
  "/dev/fd/2",
]);

/** 命令里是否出现保留区的路径段；返回命中的段名（null = 未命中） */
function reservedMetadataHit(command) {
  // 按 shell 的分隔符与 `=` 粗切（`--git-dir=.git` 也会被切成独立段）
  const tokens = String(command)
    .split(/[\s;|&()<>"'`=,]+/)
    .filter(Boolean);
  for (const token of tokens) {
    for (const seg of token.replace(/\\/g, "/").split("/")) {
      if (!seg) continue;
      if (RESERVED_SHELL_SEGMENTS.includes(seg)) return seg;
      // .env / .env.local / .env.production：密钥类文件一律不许经 Shell 读写
      if (seg === ".env" || seg.startsWith(".env.")) return seg;
    }
  }
  return null;
}

/** 取真实路径：已存在取自身，不存在取父目录，防 symlink 逃逸 */
function realish(p) {
  try {
    if (fs.existsSync(p)) return fs.realpathSync(p);
    return path.join(fs.realpathSync(path.dirname(p)), path.basename(p));
  } catch {
    return p;
  }
}

/** 单个词元是否指向工作目录之外；返回拒绝原因或 null */
function escapeReasonOf(root, raw) {
  let t = String(raw).trim();
  if (!t) return null;
  // 去掉 `--opt=value` / `--opt:value` 的选项前缀，只看取值部分
  const sep = t.search(/[=:]/);
  if (t.startsWith("-") && sep > 0) t = t.slice(sep + 1);
  if (!t || SAFE_DEVICE_TARGETS.has(t)) return null;
  const looksPath = t.includes("/") || t.startsWith(".") || t.startsWith("~");
  if (!looksPath) return null;
  // $VAR / ~ 展开后指向哪里无法静态判定 —— 保守拒绝（失败关闭）
  if (t.startsWith("$") || t.startsWith("~")) {
    return `Shell 命令路径越界（含不可静态判定的变量展开）：${raw}`;
  }
  // 通配符只校验字面前缀（`tests/**/*.test.ts` 这类正常用法必须放行）
  if (/[*?[]/.test(t)) {
    const prefix = t.split(/[*?[]/)[0].replace(/\/?[^/]*$/, "");
    return inside(root, realish(path.resolve(root, prefix || ".")))
      ? null
      : `Shell 命令路径越界（通配符前缀指向工作目录之外）：${raw}`;
  }
  const abs = t.startsWith("/") ? t : path.resolve(root, t);
  return inside(root, realish(abs))
    ? null
    : `Shell 命令路径越界（目录穿越或指向工作目录之外）：${raw}`;
}

/**
 * Shell 越界判定：重定向目标（`>` / `>>`）+ 全部词元。
 * 只做静态文本判定，宁可多拒也不放过（失败关闭）。
 */
function shellEscapeVerdict(root, command) {
  const text = String(command);
  const candidates = [];
  const redirectRe =
    /(?:^|[^>])>{1,2}\s*(?:"([^"]*)"|'([^']*)'|([^\s;|&<>]+))/g;
  let m;
  while ((m = redirectRe.exec(text)) !== null) {
    candidates.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  for (const token of text.split(/[\s;|&()"'`]+/)) {
    if (token) candidates.push(token);
  }
  for (const candidate of candidates) {
    const verdict = escapeReasonOf(root, candidate);
    if (verdict) return verdict;
  }
  return null;
}

/**
 * TASK-P.1 保护清单（.stagent/protection.json）由 daemon/API 维护，hook 只读。
 * - 命中且本轮已授权（protection-state.json 的 approvedFiles）→ 放行；
 * - 命中且未授权 → 投递拦截请求到 .stagent/protection-requests/ 并拒绝；
 * - 清单读不出来（损坏）→ 按拒绝处理（失败关闭）。
 * 这里只做与 daemon 同口径的最小 glob 匹配（精确 / dir/** 前缀 / *.后缀）。
 */
function mainRepoRootOf(root) {
  const marker = `${path.sep}.stagent${path.sep}worktrees${path.sep}`;
  const idx = root.indexOf(marker);
  return idx > 0 ? root.slice(0, idx) : root;
}

function normalizeRel(p) {
  return String(p)
    .replace(/\\/g, "/")
    .replace(/^(\.\/|\/)+/, "");
}

function matchPattern(rel, pattern) {
  const p = normalizeRel(pattern).replace(/\/+$/, "");
  if (!p) return false;
  if (rel === p) return true;
  if (p.endsWith("/**")) return rel.startsWith(p.slice(0, -2));
  if (p.startsWith("*.")) return rel.endsWith(p.slice(1));
  // 目录模式（无通配）按前缀处理，如 "src/auth"
  if (!p.includes("*")) return rel === p || rel.startsWith(`${p}/`);
  return false;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** 返回 {hit, name, selfLock}；任何读取异常都抛错，由调用方按拒绝处理 */
function matchProtection(mainRoot, rel) {
  if (rel === ".stagent/protection.json") {
    return { hit: true, name: "保护清单本身", selfLock: true };
  }
  const file = path.join(mainRoot, ".stagent", "protection.json");
  if (!fs.existsSync(file)) return { hit: false };
  const list = readJson(file);
  if (!list || list.version !== 1 || !Array.isArray(list.entries)) {
    throw new Error("保护清单结构不合法");
  }
  for (const entry of list.entries) {
    for (const pattern of entry.patterns ?? []) {
      if (matchPattern(rel, pattern)) {
        return { hit: true, name: entry.name, pattern };
      }
    }
  }
  return { hit: false };
}

function readApprovals(mainRoot, rel) {
  const file = path.join(mainRoot, ".stagent", "protection-state.json");
  try {
    if (!fs.existsSync(file)) return { approved: false, denied: false };
    const state = readJson(file);
    const approved = Array.isArray(state.approvedFiles)
      ? state.approvedFiles.includes(rel)
      : false;
    const denied = Array.isArray(state.deniedFiles)
      ? state.deniedFiles.includes(rel)
      : false;
    return { approved, denied };
  } catch {
    // 状态读不出来：没有授权记录 = 不放行（失败关闭）
    return { approved: false, denied: false };
  }
}

/** 投递拦截请求给 daemon（文件队列；失败不影响拒绝结论） */
function enqueueRequest(mainRoot, rel, name) {
  try {
    const dir = path.join(mainRoot, ".stagent", "protection-requests");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(
      dir,
      `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
    );
    fs.writeFileSync(
      file,
      JSON.stringify({
        at: new Date().toISOString(),
        files: [rel],
        entryNames: [name],
      }),
    );
  } catch {
    // 请求投递失败也要继续拒绝
  }
}

/** 保护清单命中判定：返回 null 表示放行，返回字符串表示拒绝原因 */
function protectionVerdict(mainRoot, rel) {
  let match;
  try {
    match = matchProtection(mainRoot, rel);
  } catch (err) {
    return `保护门卫不可用，按拒绝处理：${err && err.message}`;
  }
  if (!match.hit) return null;
  if (match.selfLock) return "保护清单本身被锁定，只能在 Stagent 界面里修改";
  const { approved, denied } = readApprovals(mainRoot, rel);
  if (approved) return null;
  if (denied) return `「${match.name}」本轮已被你拒绝，请换方案`;
  enqueueRequest(mainRoot, rel, match.name);
  return `AI 想修改被保护的「${match.name}」（${rel}），已在 Stagent 弹出确认卡`;
}

/** 允许 Bash 时：命令文本里出现受保护路径字面量就拒绝（保守兜底） */
function shellProtectionVerdict(mainRoot, command) {
  try {
    const file = path.join(mainRoot, ".stagent", "protection.json");
    if (!fs.existsSync(file)) return null;
    const list = readJson(file);
    for (const entry of list.entries ?? []) {
      for (const pattern of entry.patterns ?? []) {
        const base = normalizeRel(pattern).replace(/\/\*\*$/, "");
        if (base && command.includes(base)) {
          enqueueRequest(mainRoot, base, entry.name);
          return `命令触碰受保护路径「${entry.name}」（${base}），已在 Stagent 弹出确认卡`;
        }
      }
    }
    return null;
  } catch (err) {
    return `保护门卫不可用，按拒绝处理：${err && err.message}`;
  }
}

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
  const mainRoot = mainRepoRootOf(realRoot);
  const tool = String(input.tool_name ?? "");
  const ti = input.tool_input ?? {};

  if (tool === "Bash") {
    if (process.env.STAGENT_HOOK_ALLOW_BASH !== "1")
      deny("未授权的 Shell 命令");
    const command = String(ti.command ?? "");
    // 加固 1：核心元数据（.stagent/.git/.claude/.cursor/.env）一律不许经 Shell 触碰
    const reserved = reservedMetadataHit(command);
    if (reserved)
      deny(`禁止通过 Shell 访问或修改系统保护元数据（${reserved}）`);
    // 加固 2：目录穿越（../）与指向工作目录之外的绝对路径一律拒绝
    const escape = shellEscapeVerdict(realRoot, command);
    if (escape) deny(escape);
    // 既有：保护清单命中且未获本轮授权 → 投递确认卡并拒绝
    const bashVerdict = shellProtectionVerdict(mainRoot, command);
    if (bashVerdict) deny(bashVerdict);
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
        // P.1 保护清单：命中且未获本轮授权 → 投递卡片请求并拒绝（先拦后写）
        const verdict = protectionVerdict(mainRoot, rel.join("/"));
        if (verdict) deny(verdict);
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
