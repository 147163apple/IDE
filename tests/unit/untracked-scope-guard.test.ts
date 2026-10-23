import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import {
  E_OUT_OF_SCOPE_UNTRACKED,
  UntrackedScopeViolationError,
  auditUntrackedScope,
  captureUntrackedPaths,
  describeUntrackedViolations,
  enforceUntrackedScope,
  parseUntrackedPaths,
  unquoteGitPath,
} from "../../daemon/pipeline/untracked-scope-guard";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  errorCodesForReasonCode,
  httpStatusForErrorCode,
  isKnownErrorCode,
  mapErrorToReasonCode,
  plainMessageForErrorCode,
  StagentRuntimeError,
} from "../../src/lib/error-codes";
import { git } from "../helpers/git";

/**
 * TASK-W.2b：未跟踪文件 Scope 门禁。
 *
 * 三层被测面：
 * 1. 解析层——`git status --porcelain -uall` 的路径还原（空格、引号、八进制）；
 * 2. 校验层——未跟踪路径 × 合同 writable_paths 的判定；
 * 3. 编排层——真实 Worktree 上「越界即阻断、白名单内放行」的端到端行为，
 *    含 BLOCKED 证据留痕与合同状态回退。
 */

const SCOPE = {
  writable_paths: ["src/**"],
  readonly_paths: [] as string[],
  strictly_forbidden_paths: [".env*", "package-lock.json"],
};

describe("未跟踪路径解析（porcelain v1）", () => {
  it("只取 ?? 行，忽略已跟踪的修改/暂存/删除", () => {
    const porcelain = [
      " M src/tracked.ts",
      "M  src/staged.ts",
      "A  src/added.ts",
      "D  src/deleted.ts",
      "?? src/new.ts",
    ].join("\n");
    expect(parseUntrackedPaths(porcelain)).toEqual(["src/new.ts"]);
  });

  it("路径含空格时整段保留，不按空白切分", () => {
    const porcelain = [
      "?? dir with space/file name.ts",
      "?? trailing.config.js",
    ].join("\n");
    expect(parseUntrackedPaths(porcelain)).toEqual([
      "dir with space/file name.ts",
      "trailing.config.js",
    ]);
  });

  it("-uall 语义：嵌套目录逐文件列出，不折叠成目录", () => {
    const porcelain = [
      "?? tests/deep/a.test.ts",
      "?? tests/deep/b.test.ts",
    ].join("\n");
    expect(parseUntrackedPaths(porcelain)).toEqual([
      "tests/deep/a.test.ts",
      "tests/deep/b.test.ts",
    ]);
  });

  it("去重、忽略空行与 CRLF", () => {
    const porcelain = "?? src/a.ts\r\n\r\n?? src/a.ts\n";
    expect(parseUntrackedPaths(porcelain)).toEqual(["src/a.ts"]);
  });

  it("还原 git 的引号与转义：八进制非 ASCII 与内嵌引号", () => {
    // git core.quotePath 默认开启，中文文件名按 UTF-8 字节八进制转义
    expect(unquoteGitPath('"\\346\\226\\207.txt"')).toBe("文.txt");
    expect(unquoteGitPath('"a\\"b.txt"')).toBe('a"b.txt');
    expect(unquoteGitPath('"tab\\there.txt"')).toBe("tab\there.txt");
    // 无引号的普通路径原样返回
    expect(unquoteGitPath("src/plain.ts")).toBe("src/plain.ts");
  });
});

describe("未跟踪文件采集（真实 git）", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w2b-capture-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.writeFileSync(path.join(repo, "README.md"), "# base\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("嵌套目录内的每个未跟踪文件都被单独捕获", async () => {
    fs.mkdirSync(path.join(repo, "src", "deep"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, "src", "deep", "a.ts"),
      "export const a=1;\n",
    );
    fs.writeFileSync(
      path.join(repo, "src", "deep", "b.ts"),
      "export const b=1;\n",
    );

    const paths = await captureUntrackedPaths(repo);
    expect(paths.sort()).toEqual(["src/deep/a.ts", "src/deep/b.ts"]);
    // 关键：不能退化成折叠目录 "src/deep"
    expect(paths).not.toContain("src/deep");
  });

  it("已被 .gitignore 忽略的文件不出现在捕获结果中", async () => {
    fs.writeFileSync(path.join(repo, ".gitignore"), "dist/\n");
    git(repo, ["add", ".gitignore"]);
    git(repo, ["commit", "-q", "-m", "ignore"]);
    fs.mkdirSync(path.join(repo, "dist"), { recursive: true });
    fs.writeFileSync(path.join(repo, "dist", "bundle.js"), "// built\n");

    expect(await captureUntrackedPaths(repo)).toEqual([]);
  });

  it("Worktree 不可用时显式抛错，绝不静默返回空清单", async () => {
    // 采集失败必须 fail-closed：静默返回 [] 会让门禁形同虚设
    const missing = path.join(os.tmpdir(), "stagent-w2b-missing-worktree");
    await expect(captureUntrackedPaths(missing)).rejects.toThrow();
  });
});

describe("未跟踪路径 × 合同 Scope 判定", () => {
  it("writable_paths 内的新文件放行", () => {
    const report = auditUntrackedScope(
      ["src/feature/new.ts", "src/a.ts"],
      SCOPE,
      "PRE_EXECUTION",
    );
    expect(report.passed).toBe(true);
    expect(report.violations).toEqual([]);
    expect(report.inspected).toEqual(["src/a.ts", "src/feature/new.ts"]);
  });

  it("合同外的新文件判违规，原因为 NOT_WRITABLE", () => {
    const report = auditUntrackedScope(
      ["scripts/hijack.js"],
      SCOPE,
      "PRE_EXECUTION",
    );
    expect(report.passed).toBe(false);
    expect(report.violations).toHaveLength(1);
    expect(report.violations[0]?.path).toBe("scripts/hijack.js");
    expect(report.violations[0]?.reason).toBe("NOT_WRITABLE");
  });

  it("强禁区优先于可写范围，原因为 FORBIDDEN_PATH", () => {
    const report = auditUntrackedScope(
      [".env.local"],
      { ...SCOPE, writable_paths: ["**"] },
      "POST_VERIFICATION",
    );
    expect(report.passed).toBe(false);
    expect(report.violations[0]?.reason).toBe("FORBIDDEN_PATH");
  });

  it("Daemon 自建副产物（依赖挂载 / 控制面目录）计入 skipped 而非违规", () => {
    const report = auditUntrackedScope(
      ["node_modules/react/index.js", ".stagent/state.json", "src/ok.ts"],
      SCOPE,
      "PRE_EXECUTION",
    );
    expect(report.passed).toBe(true);
    expect(report.skipped).toEqual([
      ".stagent/state.json",
      "node_modules/react/index.js",
    ]);
    expect(report.inspected).toEqual(["src/ok.ts"]);
  });

  it("多处越界时清单稳定有序，白话摘要可读", () => {
    const report = auditUntrackedScope(
      ["zzz.txt", "aaa.txt", "src/ok.ts"],
      SCOPE,
      "POST_VERIFICATION",
    );
    expect(report.violations.map((v) => v.path)).toEqual([
      "aaa.txt",
      "zzz.txt",
    ]);
    const summary = describeUntrackedViolations(report);
    expect(summary).toContain("验收前检查");
    expect(summary).toContain("aaa.txt");
    expect(summary).toContain("不会合入你的项目");
  });
});

function pendingContract(options: {
  title: string;
  command: { executable: string; args: string[] };
  writablePaths?: string[];
}): SoftwareContract {
  const draft = createContractDraft({
    title: options.title,
    description: "TASK-W.2b untracked scope guard",
    acceptanceCriteria: ["command passes"],
    writablePaths: options.writablePaths ?? ["src/**"],
    commands: [
      {
        alias: "verify",
        executable: options.command.executable,
        args: options.command.args,
        expected_exit_code: 0,
        timeout_seconds: 30,
      },
    ],
  });
  return softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "PENDING_APPROVAL",
    approval: { status: "PENDING_REVIEW" },
  });
}

describe("编排器：未跟踪文件越界阻断", () => {
  let repo: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-w2b-int-"));
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "a.ts"), "export const a = 1;\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    store = new ContractStore(repo);
    orchestrator = new ContractOrchestrator({ repoRoot: repo });
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  function worktreeOf(contractId: string): string {
    return path.join(repo, ".stagent", "worktrees", `task-${contractId}`);
  }

  function readOnlyEvidence(): Record<string, unknown> {
    const dir = path.join(repo, ".stagent", "evidence");
    const files = fs.readdirSync(dir);
    expect(files).toHaveLength(1);
    return JSON.parse(
      fs.readFileSync(path.join(dir, files[0] as string), "utf8"),
    ) as Record<string, unknown>;
  }

  it("执行前发现合同外新文件：抛 E_OUT_OF_SCOPE_UNTRACKED，证据 BLOCKED 且未进入提交", async () => {
    const contract = pendingContract({
      title: "untracked escape",
      command: { executable: "node", args: ["-e", "process.exit(0)"] },
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    // 模拟绕过网关的落盘：直接写 Worktree（CLI Agent / 外部编辑器的典型通道）
    const worktree = worktreeOf(contract.contract_id);
    fs.mkdirSync(path.join(worktree, "scripts"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, "scripts", "hijack.js"),
      "// bypassed gateway\n",
    );

    const error = await orchestrator.execute(contract.contract_id).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(UntrackedScopeViolationError);
    const violations = (error as UntrackedScopeViolationError).violations;
    expect((error as UntrackedScopeViolationError).code).toBe(
      E_OUT_OF_SCOPE_UNTRACKED,
    );
    expect(violations.map((v) => v.path)).toEqual(["scripts/hijack.js"]);

    // 合同回退 EXECUTING（保留现场），绝不进入 AUDITED
    expect(store.get(contract.contract_id)?.lifecycle_state).toBe("EXECUTING");

    const evidence = readOnlyEvidence() as {
      verdict: {
        status: string;
        can_merge: boolean;
        reason_code?: string;
        summary: string;
      };
      scope_audit: { passed: boolean; forbidden_violations: string[] };
    };
    expect(evidence.verdict.status).toBe("BLOCKED");
    expect(evidence.verdict.can_merge).toBe(false);
    expect(evidence.verdict.reason_code).toBe("SCOPE_VIOLATION");
    expect(evidence.verdict.summary).toContain("E_OUT_OF_SCOPE_UNTRACKED");
    expect(evidence.scope_audit.passed).toBe(false);
    expect(evidence.scope_audit.forbidden_violations).toContain(
      "untracked:scripts/hijack.js",
    );

    // 越界文件仍是未跟踪状态：证明它从未被 `git add -A` 做进任务提交。
    // 这里必须带 -uall：不带时 git 会把目录折叠成 `?? scripts/`，
    // 恰好就是本卡要消灭的那类盲区。
    expect(git(worktree, ["status", "--porcelain", "-uall"])).toContain(
      "?? scripts/hijack.js",
    );
    expect(git(worktree, ["ls-files"])).not.toContain("scripts/hijack.js");
  });

  it("验证命令在验收阶段写越界文件：同样阻断并留痕", async () => {
    const contract = pendingContract({
      title: "verification leak",
      command: {
        executable: "node",
        args: [
          "-e",
          "require('fs').writeFileSync('leak.txt','x');process.exit(0)",
        ],
      },
      writablePaths: ["src/**"],
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    await expect(orchestrator.execute(contract.contract_id)).rejects.toThrow(
      /E_OUT_OF_SCOPE_UNTRACKED/,
    );

    const evidence = readOnlyEvidence() as {
      verdict: { status: string; reason_code?: string };
      scope_audit: { passed: boolean; forbidden_violations: string[] };
    };
    expect(evidence.verdict.status).toBe("BLOCKED");
    expect(evidence.verdict.reason_code).toBe("SCOPE_VIOLATION");
    expect(evidence.scope_audit.passed).toBe(false);
    expect(evidence.scope_audit.forbidden_violations).toEqual([
      "untracked:leak.txt",
    ]);
  });

  it("验证命令在 writable_paths 内生成文件：正常 PASSED，不误伤", async () => {
    const contract = pendingContract({
      title: "in scope generated",
      command: {
        executable: "node",
        args: [
          "-e",
          "require('fs').mkdirSync('src/gen',{recursive:true});require('fs').writeFileSync('src/gen/out.ts','// ok');process.exit(0)",
        ],
      },
      writablePaths: ["src/**"],
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");
    expect(outcome.evidence.verdict.status).toBe("PASSED");
    expect(outcome.evidence.verdict.can_merge).toBe(true);
    expect(outcome.evidence.scope_audit.passed).toBe(true);
    expect(outcome.evidence.scope_audit.forbidden_violations).toEqual([]);
  });

  it("enforceUntrackedScope 在真实 Worktree 上返回可追溯报告", async () => {
    const contract = pendingContract({
      title: "enforce helper",
      command: { executable: "node", args: ["-e", "process.exit(0)"] },
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const worktree = worktreeOf(contract.contract_id);
    fs.writeFileSync(path.join(worktree, "note.md"), "# note\n");

    const report = await enforceUntrackedScope({
      worktreePath: worktree,
      scope: contract.authorization.file_system_scope,
      phase: "PRE_EXECUTION",
    });
    expect(report.passed).toBe(false);
    expect(report.phase).toBe("PRE_EXECUTION");
    expect(report.violations[0]?.path).toBe("note.md");
  });
});

describe("错误码契约：E_OUT_OF_SCOPE_UNTRACKED", () => {
  it("已登记进目录并归因 SCOPE_VIOLATION", () => {
    expect(isKnownErrorCode(E_OUT_OF_SCOPE_UNTRACKED)).toBe(true);
    expect(mapErrorToReasonCode(E_OUT_OF_SCOPE_UNTRACKED)).toBe(
      "SCOPE_VIOLATION",
    );
    expect(errorCodesForReasonCode("SCOPE_VIOLATION")).toContain(
      E_OUT_OF_SCOPE_UNTRACKED,
    );
  });

  it("HTTP 映射：越权类 403，路径畸形类 400", () => {
    expect(httpStatusForErrorCode(E_OUT_OF_SCOPE_UNTRACKED)).toBe(403);
    expect(httpStatusForErrorCode("E_OUT_OF_SCOPE")).toBe(403);
    expect(httpStatusForErrorCode("E_FORBIDDEN_PATH")).toBe(403);
    expect(httpStatusForErrorCode("PATH_TRAVERSAL_DETECTED")).toBe(400);
    // 内部证据归因码不臆造 HTTP 语义
    expect(httpStatusForErrorCode("E_BUDGET_EXCEEDED")).toBeUndefined();
  });

  it("白话解释面向非技术用户，不泄露内部字段名", () => {
    const plain = plainMessageForErrorCode(E_OUT_OF_SCOPE_UNTRACKED);
    expect(plain.length).toBeGreaterThan(20);
    expect(plain).toContain("授权范围");
    expect(plain).not.toContain("writable_paths");
    expect(plain).not.toContain("porcelain");
  });

  it("StagentRuntimeError 携带两级码", () => {
    const err = new StagentRuntimeError(
      E_OUT_OF_SCOPE_UNTRACKED,
      "untracked file outside scope",
    );
    expect(err.code).toBe(E_OUT_OF_SCOPE_UNTRACKED);
    expect(err.reasonCode).toBe("SCOPE_VIOLATION");
  });
});
