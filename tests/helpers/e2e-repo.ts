import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { git } from "./git";

/**
 * TASK-E.1 共享 E2E 夹具：临时仓库 + 合同工厂。
 *
 * 隔离约束：仓库一律建在 `os.tmpdir()`（`daemon/git/test-isolation.ts` 守卫放行的
 * 隔离根），因此 `git init` / `git config` / `git worktree` 都不会触碰宿主仓库。
 *
 * 本文件位于 `tests/helpers/`，不在 vitest 的 include 通配内，不会被当成用例收集。
 */

/** 一条验证命令：`node -e <script>`，退出码即判定依据 */
export function cmd(alias: string, script: string) {
  return {
    alias,
    executable: "node",
    args: ["-e", script],
    expected_exit_code: 0,
    timeout_seconds: 30,
  };
}

/** 恒通过的验证命令 */
export const PASS = () => cmd("verify", "process.exit(0)");
/** 恒失败的验证命令（用于熔断 / 冒充通过分支） */
export const FAIL = () => cmd("verify", "process.exit(1)");

/**
 * 建一个最小但真实的 Git 仓库：
 * - `main` 上已提交 `src/a.ts` / `src/auth/login.ts` / 一份弱断言测试；
 * - 已配置本地 user.email / user.name（否则 Worktree 内提交会失败）。
 */
export function initRepo(prefix = "stagent-e1-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "e1@example.com"]);
  git(dir, ["config", "user.name", "E1 E2E"]);
  fs.mkdirSync(path.join(dir, "src", "auth"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
  fs.writeFileSync(
    path.join(dir, "src", "auth", "login.ts"),
    "export const login = () => true;\n",
  );
  fs.writeFileSync(path.join(dir, "tests", "a.test.ts"), WEAK_TEST);
  git(dir, ["add", "."]);
  git(dir, ["commit", "-q", "-m", "init"]);
  return dir;
}

/** 仓库里那份「改断言就能骗过验证」的测试文件内容 */
export const WEAK_TEST = [
  'import { expect, it } from "vitest";',
  'import { a } from "../src/a";',
  'it("a 等于 1", () => {',
  "  expect(a).toBe(1);",
  "});",
  "",
].join("\n");

/** 被「篡改」后的版本：断言恒真，验证命令形同虚设 */
export const TAMPERED_TEST = [
  'import { expect, it } from "vitest";',
  'it("a 等于 1", () => {',
  "  expect(true).toBe(true); // 断言被改成恒真",
  "});",
  "",
].join("\n");

/**
 * 造一张「等待准入」的合同。
 * DRAFT 无法直接进状态机（§9.1.1 双状态机联动），因此统一从
 * `PENDING_APPROVAL × PENDING_REVIEW` 起跑，交由 `orchestrator.admit()` 裁决。
 */
export function pendingContract(params: {
  title: string;
  writablePaths: string[];
  commands?: ReturnType<typeof cmd>[];
  maxVerificationRetries?: number;
  maxFileModifications?: number;
}): SoftwareContract {
  const draft = createContractDraft({
    title: params.title,
    description: `TASK-E.1 ${params.title}`,
    acceptanceCriteria: ["验证命令通过"],
    writablePaths: params.writablePaths,
    commands: params.commands ?? [PASS()],
    ...(params.maxVerificationRetries === undefined
      ? {}
      : { maxVerificationRetries: params.maxVerificationRetries }),
    ...(params.maxFileModifications === undefined
      ? {}
      : { maxFileModifications: params.maxFileModifications }),
  });
  return softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "PENDING_APPROVAL",
    approval: { status: "PENDING_REVIEW" },
  });
}
