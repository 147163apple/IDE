import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DRAFT_COMMANDS,
  alignWritableWithNpmVerification,
  buildL0Plan,
  commandsNeedNpmVerification,
  isGreenfieldRepo,
  detectProjectType,
} from "../../daemon/supervisor/rules-l0";
import type { SupervisorMessage } from "../../daemon/supervisor/types";

const tmpDirs: string[] = [];

function emptyRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-gf-"));
  tmpDirs.push(dir);
  return dir;
}

function msgs(...texts: string[]): SupervisorMessage[] {
  return texts.map((text, index) => ({
    message_id: `m-${index + 1}`,
    role: "user" as const,
    text,
    created_at: "2026-10-26T00:00:00.000Z",
    source: "ui" as const,
  }));
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    safeRmSync(dir);
  }
});

describe("greenfield npm writable alignment", () => {
  it("detects greenfield by missing package.json", () => {
    const root = emptyRepo();
    expect(isGreenfieldRepo(root)).toBe(true);
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    expect(isGreenfieldRepo(root)).toBe(false);
  });

  it("recognizes default npm typecheck/test commands", () => {
    expect(commandsNeedNpmVerification([...DEFAULT_DRAFT_COMMANDS])).toBe(true);
    expect(
      commandsNeedNpmVerification([
        {
          alias: "lint",
          executable: "npm",
          args: ["run", "lint"],
          expected_exit_code: 0,
          timeout_seconds: 60,
        },
      ]),
    ).toBe(false);
  });

  it("expands writable for greenfield + npm verification", () => {
    const root = emptyRepo();
    const aligned = alignWritableWithNpmVerification({
      repoRoot: root,
      writablePaths: ["src/**"],
      commands: [...DEFAULT_DRAFT_COMMANDS],
    });
    expect(aligned).toContain("src/**");
    expect(aligned).toContain("package.json");
    expect(aligned).toContain("tests/**");
    expect(aligned).toContain("**/*.test.ts");
  });

  it("does not expand when package.json already exists", () => {
    const root = emptyRepo();
    fs.writeFileSync(path.join(root, "package.json"), "{}");
    const aligned = alignWritableWithNpmVerification({
      repoRoot: root,
      writablePaths: ["src/**"],
      commands: [...DEFAULT_DRAFT_COMMANDS],
    });
    expect(aligned).toEqual(["src/**"]);
  });

  it("buildL0Plan includes scaffold paths on empty repo", () => {
    const root = emptyRepo();
    const plan = buildL0Plan({
      repoRoot: root,
      messages: msgs("开发一下小软件，工程进度与财务预警"),
    });
    expect(plan.writable_paths).toContain("package.json");
    expect(plan.writable_paths).toContain("tests/**");
    expect(plan.writable_paths).toContain("**/*.test.ts");
    expect(plan.budget.max_file_modifications).toBe(40);
  });

  it("非 npm 声明文件（如 pyproject.toml / Cargo.toml）存在时不再判为绿野", () => {
    const root = emptyRepo();
    expect(isGreenfieldRepo(root)).toBe(true);

    fs.writeFileSync(path.join(root, "pyproject.toml"), "");
    expect(isGreenfieldRepo(root)).toBe(false);
    expect(detectProjectType(root)?.id).toBe("python");

    const plan = buildL0Plan({
      repoRoot: root,
      messages: msgs("开发 python 模块"),
    });
    expect(plan.commands[0]?.executable).toBe("pytest");
  });

  it("Rust 声明文件 Cargo.toml 检测为 rust 类型并提供 cargo test 模板", () => {
    const root = emptyRepo();
    fs.writeFileSync(path.join(root, "Cargo.toml"), "");
    expect(isGreenfieldRepo(root)).toBe(false);
    expect(detectProjectType(root)?.id).toBe("rust");

    const plan = buildL0Plan({
      repoRoot: root,
      messages: msgs("开发 rust 模块"),
    });
    expect(plan.commands[0]?.executable).toBe("cargo");
    expect(plan.commands[0]?.args).toEqual(["test"]);
  });

  it("Go 声明文件 go.mod 检测为 go 类型并提供 go test 模板", () => {
    const root = emptyRepo();
    fs.writeFileSync(path.join(root, "go.mod"), "");
    expect(isGreenfieldRepo(root)).toBe(false);
    expect(detectProjectType(root)?.id).toBe("go");

    const plan = buildL0Plan({
      repoRoot: root,
      messages: msgs("开发 go 模块"),
    });
    expect(plan.commands[0]?.executable).toBe("go");
    expect(plan.commands[0]?.args).toEqual(["test", "./..."]);
  });
});
