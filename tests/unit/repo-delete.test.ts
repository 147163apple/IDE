import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { deleteRepoPath } from "../../daemon/editor/repo-delete";
import { deleteMenuLabel } from "../../src/lib/file-tree-delete";
import {
  addProtectionEntry,
  saveProtectionList,
} from "../../daemon/protection/protection-list";

describe("deleteRepoPath (TASK-C.10h)", () => {
  let root: string;
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function makeRepo(): string {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "stagent-repo-del-")),
    );
    fs.mkdirSync(path.join(root, ".git"));
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "a.ts"), "export {};\n");
    fs.writeFileSync(path.join(root, "keep.md"), "x\n");
    return root;
  }

  it("删普通文件成功（废纸篓或永久删除），并诚实返回 method", () => {
    const repo = makeRepo();
    const out = deleteRepoPath({
      protectionRoot: repo,
      fileRoot: repo,
      relPath: "src/a.ts",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(["trash", "unlink"]).toContain(out.method);
    expect(fs.existsSync(path.join(repo, "src", "a.ts"))).toBe(false);
    expect(out.message.length).toBeGreaterThan(0);
    if (out.method === "unlink") {
      expect(out.message).toMatch(/永久删除/);
    } else {
      expect(out.message).toMatch(/废纸篓/);
    }
  });

  it("保护清单命中 → 拒绝 + 白话，文件仍在", () => {
    const repo = makeRepo();
    saveProtectionList(repo, { version: 1, entries: [] });
    addProtectionEntry(repo, "登录", ["src/**"]);
    const out = deleteRepoPath({
      protectionRoot: repo,
      fileRoot: repo,
      relPath: "src/a.ts",
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("PROTECTED_PATH");
    expect(out.message).toMatch(/保护清单|登录/);
    expect(fs.existsSync(path.join(repo, "src", "a.ts"))).toBe(true);
  });

  it("系统目录拒绝", () => {
    const repo = makeRepo();
    fs.mkdirSync(path.join(repo, ".stagent"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".stagent", "x.json"), "{}\n");
    const out = deleteRepoPath({
      protectionRoot: repo,
      fileRoot: repo,
      relPath: ".stagent/x.json",
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("E_SYSTEM_PATH");
  });

  it("路径穿越拒绝", () => {
    const repo = makeRepo();
    const out = deleteRepoPath({
      protectionRoot: repo,
      fileRoot: repo,
      relPath: "../outside",
    });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.code).toBe("PATH_TRAVERSAL_DETECTED");
  });

  it("菜单文案：Mac 说废纸篓，其它说删除", () => {
    expect(deleteMenuLabel("MacIntel")).toMatch(/废纸篓/);
    expect(deleteMenuLabel("Linux x86_64")).toMatch(/删除/);
  });
});
