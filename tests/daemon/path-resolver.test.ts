import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  resolveSafeWorktreePath,
  PathTraversalError,
  E_PATH_TRAVERSAL,
} from "../../daemon/mcp/path-resolver";

describe("Task 1.3: Safe Worktree Path Resolver", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-path-test-"));
    fs.mkdirSync(path.join(tempRoot, "src", "sub"), { recursive: true });
    fs.writeFileSync(
      path.join(tempRoot, "src", "sub", "file.ts"),
      "export const a = 1;",
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("should safely resolve normal relative paths inside worktree", () => {
    const res1 = resolveSafeWorktreePath(tempRoot, "src/sub/file.ts");
    expect(res1.relativePath).toBe("src/sub/file.ts");
    expect(res1.absolutePath).toBe(
      path.join(tempRoot, "src", "sub", "file.ts"),
    );

    const res2 = resolveSafeWorktreePath(tempRoot, "./src/sub/file.ts");
    expect(res2.relativePath).toBe("src/sub/file.ts");

    const resRoot = resolveSafeWorktreePath(tempRoot, ".");
    expect(resRoot.relativePath).toBe(".");
    expect(resRoot.absolutePath).toBe(path.resolve(tempRoot));
  });

  it("should reject absolute paths with PathTraversalError", () => {
    expect(() => resolveSafeWorktreePath(tempRoot, "/etc/passwd")).toThrowError(
      PathTraversalError,
    );
    expect(() =>
      resolveSafeWorktreePath(tempRoot, "/root/file.ts"),
    ).toThrowError(/Absolute paths are forbidden/);
  });

  it("should reject path traversal using '..' components", () => {
    expect(() =>
      resolveSafeWorktreePath(tempRoot, "../outside.txt"),
    ).toThrowError(PathTraversalError);
    expect(() =>
      resolveSafeWorktreePath(tempRoot, "src/../../outside.txt"),
    ).toThrowError(PathTraversalError);
    expect(() =>
      resolveSafeWorktreePath(tempRoot, "src/sub/../../../etc/shadow"),
    ).toThrowError(PathTraversalError);
  });

  it("should reject empty paths", () => {
    expect(() => resolveSafeWorktreePath(tempRoot, "")).toThrowError(
      PathTraversalError,
    );
  });

  it("should detect and reject symlink escaping worktree root", () => {
    const outsideDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "stagent-outside-"),
    );
    fs.writeFileSync(path.join(outsideDir, "secret.env"), "SECRET=true");

    // Create a symlink inside tempRoot pointing to outsideDir
    const symlinkPath = path.join(tempRoot, "src", "link-out");
    fs.symlinkSync(outsideDir, symlinkPath, "dir");

    expect(() => {
      resolveSafeWorktreePath(tempRoot, "src/link-out/secret.env");
    }).toThrowError(/Symlink resolution points outside worktree/);

    fs.rmSync(outsideDir, { recursive: true, force: true });
  });
});
