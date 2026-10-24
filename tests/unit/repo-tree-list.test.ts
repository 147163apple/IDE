import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listRepoTreePaths } from "../../daemon/editor/worktree-files";

describe("listRepoTreePaths (C.10f explorer)", () => {
  let root: string;
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("lists nested files and skips ignored dirs", () => {
    root = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "stagent-tree-")),
    );
    fs.mkdirSync(path.join(root, "src", "ui"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules", "x"), { recursive: true });
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    fs.mkdirSync(path.join(root, "dist"), { recursive: true });
    fs.writeFileSync(path.join(root, "README.md"), "hi\n");
    fs.writeFileSync(path.join(root, "src", "a.ts"), "export {};\n");
    fs.writeFileSync(path.join(root, "src", "ui", "b.tsx"), "export {};\n");
    fs.writeFileSync(path.join(root, "node_modules", "x", "index.js"), "1\n");
    fs.writeFileSync(path.join(root, ".git", "config"), "x\n");
    fs.writeFileSync(path.join(root, "dist", "out.js"), "1\n");
    fs.mkdirSync(path.join(root, ".stagent", "demo"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".stagent", "demo", "index.html"),
      "<html/>\n",
    );

    const files = listRepoTreePaths(root);
    expect(files).toContain("README.md");
    expect(files).toContain("src/a.ts");
    expect(files).toContain("src/ui/b.tsx");
    expect(files).toContain(".stagent/demo/index.html");
    expect(files.some((f) => f.startsWith("node_modules/"))).toBe(false);
    expect(files.some((f) => f.startsWith(".git/"))).toBe(false);
    expect(files.some((f) => f.startsWith("dist/"))).toBe(false);
  });
});
