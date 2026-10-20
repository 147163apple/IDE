import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readDiffFiles } from "../../daemon/diff/diff-files";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/** TASK-C.5：双栏 Diff 的 before/after 必须来自真实 git，而不是前端拼的。 */
describe("TASK-C.5 文件级 Diff 数据（真实 git）", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-diff-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    fs.writeFileSync(
      path.join(repo, "src", "gone.ts"),
      "export const g = 0;\n",
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    git(repo, ["switch", "-q", "-c", "task/x"]);
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 2;\n");
    fs.writeFileSync(path.join(repo, "src", "b.ts"), "export const b = 3;\n");
    fs.rmSync(path.join(repo, "src", "gone.ts"));
    fs.writeFileSync(path.join(repo, "logo.bin"), Buffer.from([0, 1, 2, 3]));
    git(repo, ["add", "-A"]);
    git(repo, ["commit", "-q", "-m", "task changes"]);
  });

  afterEach(() => {
    try {
      fs.rmSync(repo, { recursive: true, force: true });
    } catch {
      // 清理尽力而为
    }
  });

  it("修改/新增/删除/二进制分别给出正确的 before/after", async () => {
    const { files } = await readDiffFiles(repo, "main");
    const byPath = new Map(files.map((f) => [f.path, f]));

    const modified = byPath.get("src/a.ts");
    expect(modified?.status).toBe("modified");
    expect(modified?.before).toBe("export const a = 1;\n");
    expect(modified?.after).toBe("export const a = 2;\n");

    const added = byPath.get("src/b.ts");
    expect(added?.status).toBe("added");
    expect(added?.before).toBe("");
    expect(added?.after).toBe("export const b = 3;\n");

    const deleted = byPath.get("src/gone.ts");
    expect(deleted?.status).toBe("deleted");
    expect(deleted?.before).toBe("export const g = 0;\n");
    expect(deleted?.after).toBe("");

    const binary = byPath.get("logo.bin");
    expect(binary?.binary).toBe(true);
    expect(binary?.before).toBe("");
    expect(binary?.after).toBe("");
  });
});
