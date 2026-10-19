import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildEditorCommand,
  launchEditor,
  resolveTaskWorktree,
  type SpawnFn,
} from "../../daemon/editor/launcher";

describe("M7 / TASK-C.3 外部编辑器安全调起", () => {
  let repo: string;
  let worktreePath: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-editor-"));
    worktreePath = path.join(repo, ".stagent", "worktrees", "task-c1");
    fs.mkdirSync(worktreePath, { recursive: true });
    fs.writeFileSync(path.join(worktreePath, "a.ts"), "export const a = 1;\n");
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  const fakeSpawn = (behaviour: "spawn" | "ENOENT"): SpawnFn => {
    return () => {
      const handlers: Record<string, (err?: Error) => void> = {};
      setImmediate(() => {
        if (behaviour === "spawn") handlers["spawn"]?.();
        else {
          const err = new Error("not found") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          handlers["error"]?.(err);
        }
      });
      return {
        once: (event, cb) => {
          handlers[event] = cb;
        },
        unref: () => {},
      };
    };
  };

  it("只接受 .stagent/worktrees 内的任务路径", () => {
    const ok = resolveTaskWorktree(repo, "c1");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.worktreePath).toBe(fs.realpathSync(worktreePath));

    const missing = resolveTaskWorktree(repo, "missing");
    expect(missing.ok).toBe(false);

    const traversal = resolveTaskWorktree(repo, "../../etc");
    expect(traversal.ok).toBe(false);
  });

  it("参数化模板替换 {path}，不拼接 shell", () => {
    const built = buildEditorCommand(
      "cursor --new-window {path}",
      worktreePath,
    );
    expect("command" in built && built.command).toBe("cursor");
    expect("args" in built && built.args).toEqual([
      "--new-window",
      worktreePath,
    ]);

    const invalid = buildEditorCommand("cursor", worktreePath);
    expect("error" in invalid).toBe(true);
  });

  it("调起成功返回 launched=true 与命令", async () => {
    const result = await launchEditor({
      repoRoot: repo,
      contractId: "c1",
      template: "code {path}",
      spawnFn: fakeSpawn("spawn"),
    });
    expect(result.launched).toBe(true);
    expect(result.command).toContain("code");
    expect(result.worktreePath).toBe(fs.realpathSync(worktreePath));
  });

  it("编辑器未安装时返回 editor_not_found 供前端降级", async () => {
    const result = await launchEditor({
      repoRoot: repo,
      contractId: "c1",
      template: "cursor {path}",
      spawnFn: fakeSpawn("ENOENT"),
    });
    expect(result.launched).toBe(false);
    expect(result.reason).toBe("editor_not_found");
    expect(result.worktreePath).toContain("task-c1");
  });

  it("Worktree 不存在时拒绝并返回 invalid_path", async () => {
    const result = await launchEditor({ repoRoot: repo, contractId: "nope" });
    expect(result.launched).toBe(false);
    expect(result.reason).toBe("invalid_path");
  });
});
