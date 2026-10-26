/**
 * TASK-H.6：脏区 409 白话低恐慌排除建议；确认后脏路径进禁写/排除集合。
 */
import fs from "node:fs";
import path from "node:path";
import { normalizePath } from "../../src/lib/scope";

export const E_WORKTREE_DIRTY = "E_WORKTREE_DIRTY" as const;
export const DIRTY_ACK_EXCLUSIONS_REL = ".stagent/dirty-ack-exclusions.json" as const;

export interface DirtyExclusionSuggestion {
  path: string;
  /** 白话原因（低恐慌） */
  reason: string;
  /** 可执行动作提示 */
  action: string;
  kind: "secret" | "local" | "build" | "other";
}

export interface DirtyAckGuidance {
  plain_message: string;
  exclusion_suggestions: DirtyExclusionSuggestion[];
  dirty_exclusions: string[];
  dirty_count: number;
}

const SECRET_NAME =
  /(^|\/)(\.env(\..+)?|.*credentials?.*|.*secret.*|.*token.*|\.npmrc|\.netrc|.*\.pem|.*\.key|id_rsa|id_ed25519)(\/|$)/i;
const LOCAL_NAME =
  /(^|\/)(\.DS_Store|Thumbs\.db|.*\.local(\..*)?|.*\.tmp|.*\.swp|.*~$|\.idea\/|\.vscode\/settings\.json)(\/|$)/i;
const BUILD_NAME =
  /(^|\/)(node_modules\/|dist\/|build\/|\.next\/|\.output\/|coverage\/|\.cache\/)(\/|$)/i;

export function classifyDirtyPath(filePath: string): DirtyExclusionSuggestion {
  const p = normalizePath(filePath);
  if (SECRET_NAME.test(p)) {
    return {
      path: p,
      kind: "secret",
      reason: "看起来像密钥或登录凭证类文件",
      action: "确认开工后系统会把它列入「绝不触碰」；也可先移出项目目录再开工",
    };
  }
  if (LOCAL_NAME.test(p)) {
    return {
      path: p,
      kind: "local",
      reason: "看起来像本机临时/编辑器文件",
      action: "确认后会自动排除，施工不会改它",
    };
  }
  if (BUILD_NAME.test(p)) {
    return {
      path: p,
      kind: "build",
      reason: "看起来像构建产物或依赖目录",
      action: "确认后会排除；建议把这类路径写进 .gitignore",
    };
  }
  return {
    path: p,
    kind: "other",
    reason: "本地尚未提交的改动",
    action: "确认开工后会排除，不会带进施工树；也可以先自行提交或挪走",
  };
}

export function buildDirtyAckGuidance(
  dirtyFiles: readonly string[],
): DirtyAckGuidance {
  const dirty_exclusions = [
    ...new Set(dirtyFiles.map((f) => normalizePath(f)).filter(Boolean)),
  ].sort();
  const exclusion_suggestions = dirty_exclusions.map(classifyDirtyPath);
  const n = dirty_exclusions.length;
  const sample = exclusion_suggestions
    .slice(0, 3)
    .map((s) => `「${s.path}」`)
    .join("、");
  const more = n > 3 ? `等 ${n} 个` : "";
  const plain_message =
    n <= 0
      ? "工作区是干净的。"
      : [
          `发现本地有 ${n} 个未提交改动（例如 ${sample}${more}）。`,
          "请放心：它们不会进入施工树；点确认后会列入「绝不触碰」禁写名单。",
          exclusion_suggestions.some((s) => s.kind === "secret")
            ? "其中含疑似凭证文件——确认后同样不会被改写或上传。"
            : "这不是故障，只是提醒你本地还有草稿。",
        ].join("");
  return {
    plain_message,
    exclusion_suggestions,
    dirty_exclusions,
    dirty_count: n,
  };
}

export interface DirtyAckExclusionsFile {
  schema_version: "1.0.0";
  updated_at: string;
  dirty_exclusions: string[];
}

export function dirtyAckExclusionsPath(repoRoot: string): string {
  return path.join(path.resolve(repoRoot), DIRTY_ACK_EXCLUSIONS_REL);
}

/** 确认后写入排除清单（供 Gateway / 合同禁写合并） */
export function recordAcknowledgedDirtyExclusions(
  repoRoot: string,
  dirtyFiles: readonly string[],
): string[] {
  const next = [
    ...new Set(dirtyFiles.map((f) => normalizePath(f)).filter(Boolean)),
  ].sort();
  const file = dirtyAckExclusionsPath(repoRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let prev: string[] = [];
  if (fs.existsSync(file)) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as DirtyAckExclusionsFile;
      if (Array.isArray(raw.dirty_exclusions)) prev = raw.dirty_exclusions;
    } catch {
      prev = [];
    }
  }
  const merged = [...new Set([...prev, ...next].map(normalizePath))].sort();
  const payload: DirtyAckExclusionsFile = {
    schema_version: "1.0.0",
    updated_at: new Date().toISOString(),
    dirty_exclusions: merged,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return merged;
}

export function loadAcknowledgedDirtyExclusions(repoRoot: string): string[] {
  const file = dirtyAckExclusionsPath(repoRoot);
  if (!fs.existsSync(file)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8")) as DirtyAckExclusionsFile;
    if (!Array.isArray(raw.dirty_exclusions)) return [];
    return [...new Set(raw.dirty_exclusions.map(normalizePath).filter(Boolean))].sort();
  } catch {
    return [];
  }
}

export function mergeDirtyIntoForbidden(
  existingForbidden: readonly string[],
  dirtyFiles: readonly string[],
): string[] {
  return [
    ...new Set(
      [...existingForbidden, ...dirtyFiles].map((p) => normalizePath(p)).filter(Boolean),
    ),
  ].sort();
}
