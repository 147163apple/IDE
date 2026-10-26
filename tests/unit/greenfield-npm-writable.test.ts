import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_DRAFT_COMMANDS,
  alignWritableWithNpmVerification,
  buildL0Plan,
  commandsNeedNpmVerification,
  isGreenfieldRepo,
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
    fs.rmSync(dir, { recursive: true, force: true });
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
});
