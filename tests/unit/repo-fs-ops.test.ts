import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createRepoPath,
  renameRepoPath,
  revealRepoPath,
} from "../../daemon/editor/repo-fs-ops";
import {
  addProtectionEntry,
  saveProtectionList,
} from "../../daemon/protection/protection-list";

describe("repo-fs-ops (TASK-C.10i)", () => {
  let root: string;
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeRepo(): string {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "stagent-repo-fs-")),
    );
    fs.mkdirSync(path.join(root, ".git"));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "a.ts"), "export {};\n");
    return root;
  }

  it("新建文件与文件夹", () => {
    const repo = makeRepo();
    const file = createRepoPath({
      protectionRoot: repo,
      fileRoot: repo,
      parentRel: "src",
      name: "b.ts",
      kind: "file",
    });
    expect(file.ok).toBe(true);
    if (!file.ok) return;
    expect(file.path).toBe("src/b.ts");
    expect(fs.readFileSync(path.join(repo, "src", "b.ts"), "utf8")).toBe("");

    const dir = createRepoPath({
      protectionRoot: repo,
      fileRoot: repo,
      parentRel: "",
      name: "docs",
      kind: "dir",
    });
    expect(dir.ok).toBe(true);
    if (!dir.ok) return;
    expect(fs.statSync(path.join(repo, "docs")).isDirectory()).toBe(true);
  });

  it("保护清单命中 → 新建拒绝", () => {
    const repo = makeRepo();
    saveProtectionList(repo, { version: 1, entries: [] });
    addProtectionEntry(repo, "登录", ["src/**"]);
    const out = createRepoPath({
      protectionRoot: repo,
      fileRoot: repo,
      parentRel: "src",
      name: "x.ts",
      kind: "file",
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("PROTECTED_PATH");
    expect(fs.existsSync(path.join(repo, "src", "x.ts"))).toBe(false);
  });

  it("重命名成功；保护命中拒绝", () => {
    const repo = makeRepo();
    const ok = renameRepoPath({
      protectionRoot: repo,
      fileRoot: repo,
      fromRel: "src/a.ts",
      toRel: "src/a2.ts",
    });
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(fs.existsSync(path.join(repo, "src", "a2.ts"))).toBe(true);
    expect(fs.existsSync(path.join(repo, "src", "a.ts"))).toBe(false);

    saveProtectionList(repo, { version: 1, entries: [] });
    addProtectionEntry(repo, "核心", ["src/**"]);
    const blocked = renameRepoPath({
      protectionRoot: repo,
      fileRoot: repo,
      fromRel: "src/a2.ts",
      toRel: "src/a3.ts",
    });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.code).toBe("PROTECTED_PATH");
  });

  it("系统路径拒绝新建", () => {
    const repo = makeRepo();
    const out = createRepoPath({
      protectionRoot: repo,
      fileRoot: repo,
      parentRel: ".stagent",
      name: "x.json",
      kind: "file",
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("E_SYSTEM_PATH");
  });

  it("reveal 对存在路径返回 ok（本机可能弹 Finder）", () => {
    const repo = makeRepo();
    const out = revealRepoPath({ fileRoot: repo, relPath: "src/a.ts" });
    // CI/无 GUI 环境可能失败；允许 E_REVEAL_FAILED，但不应路径错误
    if (!out.ok) {
      expect(out.code).toBe("E_REVEAL_FAILED");
    } else {
      expect(out.message.length).toBeGreaterThan(0);
    }
  });
});
