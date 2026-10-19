import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";

/**
 * 外部编辑器安全调起（规范 TASK-C.3 PASS-1/2/4）。
 * - 目标路径严格限定在 `.stagent/worktrees/task-{contract_id}` 的规范化绝对路径
 * - 命令使用参数化模板（默认 `cursor {path}`），`shell: false`，绝不拼接 shell 字符串
 * - 编辑器不存在时返回 `editor_not_found`，由前端降级为复制路径
 */
export type EditorLaunchReason =
  "editor_not_found" | "invalid_path" | "spawn_failed" | "invalid_template";

export interface EditorLaunchResult {
  launched: boolean;
  worktreePath: string;
  reason?: EditorLaunchReason;
  message?: string;
  command?: string;
}

export type SpawnFn = (
  command: string,
  args: string[],
  options: { shell: false; detached: true; stdio: "ignore" },
) => {
  once: (event: string, cb: (err?: Error) => void) => void;
  unref: () => void;
};

export function resolveTaskWorktree(
  repoRoot: string,
  contractId: string,
): { ok: true; worktreePath: string } | { ok: false; reason: string } {
  if (!/^[a-zA-Z0-9_-]+$/.test(contractId)) {
    return { ok: false, reason: "invalid contract id" };
  }
  const worktreesRoot = path.join(
    path.resolve(repoRoot),
    ".stagent",
    "worktrees",
  );
  const candidate = path.join(worktreesRoot, `task-${contractId}`);

  if (!fs.existsSync(candidate)) {
    return { ok: false, reason: `worktree not found: ${candidate}` };
  }

  const real = fs.realpathSync(candidate);
  const realRoot = fs.existsSync(worktreesRoot)
    ? fs.realpathSync(worktreesRoot)
    : worktreesRoot;

  // 规范 PASS-4：严禁指向主工作区
  if (!real.startsWith(realRoot + path.sep)) {
    return { ok: false, reason: "worktree escapes sandbox root" };
  }
  return { ok: true, worktreePath: real };
}

export function buildEditorCommand(
  template: string,
  worktreePath: string,
): { command: string; args: string[] } | { error: string } {
  const tokens = template.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  if (tokens.length === 0) return { error: "empty editor template" };
  if (!template.includes("{path}")) {
    return { error: "editor template must contain {path}" };
  }

  const cleaned = tokens.map((token) => token.replace(/^['"]|['"]$/g, ""));
  const command = cleaned[0] as string;
  const args = cleaned
    .slice(1)
    .map((token) => token.replace("{path}", worktreePath));
  return { command, args };
}

export async function launchEditor(options: {
  repoRoot: string;
  contractId: string;
  template?: string | undefined;
  spawnFn?: SpawnFn | undefined;
  timeoutMs?: number;
}): Promise<EditorLaunchResult> {
  const resolved = resolveTaskWorktree(options.repoRoot, options.contractId);
  if (!resolved.ok) {
    return {
      launched: false,
      worktreePath: "",
      reason: "invalid_path",
      message: resolved.reason,
    };
  }
  const worktreePath = resolved.worktreePath;

  const template =
    options.template ?? process.env["STAGENT_EDITOR"] ?? "cursor {path}";
  const built = buildEditorCommand(template, worktreePath);
  if ("error" in built) {
    return {
      launched: false,
      worktreePath,
      reason: "invalid_template",
      message: built.error,
    };
  }

  const spawnFn = (options.spawnFn ?? (spawn as unknown as SpawnFn)) as SpawnFn;
  const child = spawnFn(built.command, built.args, {
    shell: false,
    detached: true,
    stdio: "ignore",
  });

  return new Promise<EditorLaunchResult>((resolve) => {
    let settled = false;
    const finish = (result: EditorLaunchResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => {
      child.unref();
      finish({
        launched: true,
        worktreePath,
        command: `${built.command} ${built.args.join(" ")}`,
      });
    }, options.timeoutMs ?? 1_000);

    child.once("error", (err?: Error) => {
      clearTimeout(timer);
      const notFound =
        (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
      finish({
        launched: false,
        worktreePath,
        reason: notFound ? "editor_not_found" : "spawn_failed",
        message: err?.message ?? "spawn failed",
      });
    });

    child.once("spawn", () => {
      clearTimeout(timer);
      child.unref();
      finish({
        launched: true,
        worktreePath,
        command: `${built.command} ${built.args.join(" ")}`,
      });
    });
  });
}
