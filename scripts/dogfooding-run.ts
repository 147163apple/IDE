/**
 * TASK-E.2 自举演练（Dogfooding）驱动器。
 *
 * 用 Stagent 自己的受控流水线，在**本仓库**上完成一次真实代码改进闭环：
 *
 *   合同落盘 → admit() 准入裁决（无交集自动放行）→ 真 Worktree
 *   → 受控写入（Scoped Gateway，范围/预算/测试完整性全在）→ execute() 真跑
 *   `npm run typecheck` + 定向单测 → Evidence（PASSED / can_merge）
 *   → squashMerge() Gate 0~4 + 4 字段 Trailer → 清理现场
 *
 * 与真实模型路径的唯一差异：`modelClient` 是确定性实现（无 `OPENAI_API_KEY`
 * 时无法调用真实模型），它产出的 changes 与模型走**同一个** `AiWorker` →
 * `ScopedWorktreeGateway` 通道，范围校验、预算、审计、测试完整性门禁一个不少。
 * 用量因此恒为 0（Evidence 里 `accounting_mode: UNAVAILABLE`），报告如实披露。
 *
 * 用法：
 *   npx tsx scripts/dogfooding-run.ts
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { ContractOrchestrator } from "../daemon/pipeline/orchestrator";
import { ContractStore } from "../daemon/pipeline/contract-store";
import { squashMerge } from "../daemon/pipeline/merger";
import { CostMonitor } from "../daemon/guard/cost-monitor";
import { ScopedWorktreeGateway } from "../daemon/mcp/gateway";
import {
  AiWorker,
  type WorkerChange,
  type WorkerGenerationInput,
  type WorkerGenerationResult,
  type WorkerModelClient,
} from "../daemon/worker/ai-worker";
import { getWorktreePath } from "../daemon/git/worktree-manager";
import {
  createContractDraft,
  softwareContractSchema,
} from "../src/lib/contract.schema";

const REPO_ROOT = process.cwd();

/** 自举改动的落点（合同 writable_paths 与 Worker 提案必须完全一致） */
const TARGET_EXISTING = "bin/stagent.ts";
const TARGET_NEW_FILES: Record<string, string> = {
  "bin/version.ts": `/**
 * CLI 版本展示（TASK-E.2 自举演练产物）。
 *
 * 版本号的唯一事实源是 package.json：把版本写死在代码里，发版时必然漂移。
 * 这里每次从磁盘读取，\`stagent version\` 与帮助抬头复用同一条路径。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** 缺省读取位置：相对本模块，兼容 tsx 直跑与编译后布局 */
export const PACKAGE_JSON_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "package.json",
);

/** 版本号形态：与 package.json 的 semver 约定一致，异常值不冒充版本 */
const SEMVER = /^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$/;

/** 读版本号；文件缺失 / 损坏 / 非法一律降级为 0.0.0，绝不打断 CLI */
export function readCliVersion(
  packageJsonPath: string = PACKAGE_JSON_PATH,
): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      version?: unknown;
    };
    const version = parsed.version;
    return typeof version === "string" && SEMVER.test(version)
      ? version
      : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** 统一展示格式：\`Stagent v0.1.0\` */
export function formatVersion(version: string): string {
  return \`Stagent v\${version}\`;
}
`,
  "tests/unit/cli-version.test.ts": `import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { formatVersion, readCliVersion } from "../../bin/version";
import { parseArgs } from "../../bin/stagent";

/**
 * CLI 版本展示（TASK-E.2 自举演练产物）。
 * 断言重点：版本号来自 package.json 而非硬编码；异常输入不得冒充版本。
 */
describe("stagent CLI 版本展示", () => {
  it("默认读取真实 package.json，且为合法 semver", () => {
    const version = readCliVersion();
    expect(version).toMatch(/^\\d+\\.\\d+\\.\\d+(?:[-+][0-9A-Za-z.-]+)?$/);
    const pkg = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { version?: string };
    expect(version).toBe(pkg.version);
  });

  it("version 子命令被 parseArgs 识别，不再回退 help", () => {
    expect(parseArgs(["version"]).command).toBe("version");
  });

  it("展示格式统一为 Stagent v<version>", () => {
    expect(formatVersion("0.1.0")).toBe("Stagent v0.1.0");
  });

  it("文件缺失 / 非法版本 / 损坏 JSON 时降级为 0.0.0 而不抛错", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-cli-version-"));
    try {
      expect(readCliVersion(path.join(dir, "missing.json"))).toBe("0.0.0");
      const bad = path.join(dir, "bad.json");
      fs.writeFileSync(bad, JSON.stringify({ version: "not-a-version" }));
      expect(readCliVersion(bad)).toBe("0.0.0");
      const broken = path.join(dir, "broken.json");
      fs.writeFileSync(broken, "{ not json");
      expect(readCliVersion(broken)).toBe("0.0.0");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
`,
};

/**
 * 既有文件的定点改造（每条锚点必须命中，否则直接失败——
 * 宁可演练中断，也不要「改了个寂寞还报 PASSED」）。
 */
const REPLACEMENTS: Record<string, Array<[string, string]>> = {
  [TARGET_EXISTING]: [
    [
      'import path from "node:path";',
      'import path from "node:path";\nimport { formatVersion, readCliVersion } from "./version";',
    ],
    [
      'command: "start" | "status" | "help";',
      'command: "start" | "status" | "help" | "version";',
    ],
    [
      'if (!["start", "status", "help"].includes(command)) {',
      'if (!["start", "status", "help", "version"].includes(command)) {',
    ],
    [
      "Stagent v0.1 — 本地任务副驾与验收控制台",
      "${formatVersion(readCliVersion())} — 本地任务副驾与验收控制台",
    ],
    [
      "  stagent help                     显示帮助",
      "  stagent version                  显示版本号\n  stagent help                     显示帮助",
    ],
    [
      '  if (options.command === "status") {',
      '  if (options.command === "version") {\n    console.log(formatVersion(readCliVersion()));\n    return;\n  }\n\n  if (options.command === "status") {',
    ],
  ],
};

function applyEdits(rel: string, content: string): string {
  const rules = REPLACEMENTS[rel];
  if (!rules) throw new Error(`没有为 ${rel} 登记改造规则`);
  let next = content;
  for (const [from, to] of rules) {
    if (!next.includes(from)) {
      throw new Error(
        `改造锚点未命中（${rel}）：${from.slice(0, 80).replace(/\n/g, "\\n")}`,
      );
    }
    next = next.replace(from, to);
  }
  return next;
}

/**
 * 确定性"代码写手"：与真实模型实现同一个 `WorkerModelClient` 接口，
 * 因此在 `AiWorker` 看来完全等价——它同样要过范围校验与网关写入。
 */
const deterministicClient: WorkerModelClient = {
  async generateChanges(
    input: WorkerGenerationInput,
  ): Promise<WorkerGenerationResult> {
    const changes: WorkerChange[] = [];
    for (const rel of Object.keys(TARGET_NEW_FILES)) {
      const fresh = TARGET_NEW_FILES[rel];
      if (fresh === undefined) continue;
      changes.push({ path: rel, content: fresh });
    }
    const existing = input.files.find((f) => f.path === TARGET_EXISTING);
    if (!existing) {
      throw new Error(
        `上下文里没有 ${TARGET_EXISTING}（视图应包含可写范围内的现有文件）`,
      );
    }
    changes.push({
      path: TARGET_EXISTING,
      content: applyEdits(TARGET_EXISTING, existing.content),
    });
    return {
      changes,
      log: [
        "为 CLI 增加 version 子命令，并把帮助抬头改为读 package.json",
        "新增 bin/version.ts 与对应单测，版本号不再写死",
      ],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  },
};

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

function ms(startedAt: bigint): number {
  return Math.round(Number(process.hrtime.bigint() - startedAt) / 1_000_000);
}

function assertPreconditions(): void {
  const required = [
    "bin/stagent.ts",
    "daemon/pipeline/orchestrator.ts",
    "package.json",
  ];
  for (const rel of required) {
    if (!fs.existsSync(path.join(REPO_ROOT, rel))) {
      throw new Error(`不是 Stagent 仓库根？缺少 ${rel}`);
    }
  }
  if (git(["rev-parse", "--show-toplevel"]) !== fs.realpathSync(REPO_ROOT)) {
    throw new Error("当前目录不是 git 仓库根，拒绝演练");
  }
  const dirty = git(["status", "--porcelain", "-uall"]);
  if (dirty.length > 0) {
    throw new Error(
      `主工作区不干净，合并门禁会直接阻断（E_MAIN_TREE_DIRTY）。请先提交或 stash：\n${dirty}`,
    );
  }
}

async function main(): Promise<void> {
  assertPreconditions();
  const flowStart = process.hrtime.bigint();

  const draft = createContractDraft({
    title: "自举：CLI 版本命令与动态版本号",
    description:
      "为 stagent CLI 增加 version 子命令，并把帮助抬头与版本展示统一改为读 package.json，消除写死的 v0.1",
    acceptanceCriteria: [
      "npm run typecheck 通过",
      "tests/unit/cli-version.test.ts 全部通过",
      "bin/stagent.ts 不再出现写死的版本号",
    ],
    // Worktree 必须基于**当前分支**：否则验证跑的是 main 的旧树，
    // 证据里的 base_commit_sha 也会指向错误基线
    baseBranch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
    writablePaths: [
      TARGET_EXISTING,
      ...Object.keys(TARGET_NEW_FILES),
      // 目标：既有 CLI 入口 + 新增版本模块 + 新增定向单测（漏一个就会被范围门禁整批拒绝）
    ],
    commands: [
      {
        alias: "typecheck",
        executable: "npm",
        args: ["run", "typecheck"],
        expected_exit_code: 0,
        timeout_seconds: 240,
      },
      {
        alias: "unit",
        executable: "npx",
        args: ["vitest", "run", "tests/unit/cli-version.test.ts"],
        expected_exit_code: 0,
        timeout_seconds: 240,
      },
    ],
    maxFileModifications: 4,
    maxVerificationRetries: 2,
  });

  const contract = softwareContractSchema.parse({
    ...draft,
    lifecycle_state: "PENDING_APPROVAL",
    approval: { status: "PENDING_REVIEW" },
  });
  new ContractStore(REPO_ROOT).save(contract);

  const orchestrator = new ContractOrchestrator({ repoRoot: REPO_ROOT });

  // 1) 准入裁决（含真 Worktree 创建）
  const admitStart = process.hrtime.bigint();
  const admission = await orchestrator.admit(contract.contract_id);
  const admitMs = ms(admitStart);
  if (admission.decision !== "AUTO_APPROVED") {
    throw new Error(
      `准入未自动放行（${admission.decision}）：${admission.reason ?? ""} —— 请先在界面处理保护确认卡`,
    );
  }
  const worktree = getWorktreePath(REPO_ROOT, contract.contract_id);
  if (!fs.existsSync(worktree)) throw new Error("Worktree 未创建");

  // 2) 受控写入（真网关：范围 / 预算 / 测试完整性门禁）
  const workerStart = process.hrtime.bigint();
  const costMonitor = new CostMonitor();
  const gateway = new ScopedWorktreeGateway(worktree, admission.contract, {
    costMonitor,
  });
  const worker = new AiWorker({
    gateway,
    costMonitor,
    modelClient: deterministicClient,
    repoRoot: REPO_ROOT,
  });
  const run = await worker.run();
  const workerMs = ms(workerStart);
  if (!run.applied) throw new Error("受控写入未产生任何改动");

  // 3) 真实验证（typecheck + 定向单测，均在 Worktree 内执行）
  const executeStart = process.hrtime.bigint();
  const outcome = await orchestrator.execute(contract.contract_id);
  const executeMs = ms(executeStart);
  if (outcome.evidence.verdict.status !== "PASSED") {
    throw new Error(
      `验证未通过：${outcome.evidence.verdict.status} / ${outcome.evidence.verdict.summary}`,
    );
  }
  if (!outcome.evidence.verdict.can_merge) {
    throw new Error("Evidence 判定不可合并（can_merge=false）");
  }

  // 4) 合并门禁 Gate 0~4 + Trailer + 现场清理
  const mergeStart = process.hrtime.bigint();
  const merged = await squashMerge({
    repoRoot: REPO_ROOT,
    contractId: contract.contract_id,
    evidence: outcome.evidence,
    reviewer: "local-user",
  });
  const mergeMs = ms(mergeStart);
  const totalMs = ms(flowStart);

  const trailerLines = git(["log", "-1", "--format=%B"])
    .split("\n")
    .filter((line) => /^(Stagent-|Reviewed-By)/.test(line));

  const metrics = {
    contract_id: contract.contract_id,
    contract_file: path.join(
      ".stagent",
      "contracts",
      `${contract.contract_id}.json`,
    ),
    evidence_id: outcome.evidence.evidence_id,
    evidence_file: path.join(
      ".stagent",
      "evidence",
      `${contract.contract_id}-${outcome.evidence.evidence_id}.json`,
    ),
    evidence_status: outcome.evidence.verdict.status,
    can_merge: outcome.evidence.verdict.can_merge,
    tests_modified: outcome.evidence.tests_modified,
    usage: outcome.evidence.usage,
    timings_ms: {
      admit_and_worktree: admitMs,
      worker_write: workerMs,
      verification: executeMs,
      merge_and_cleanup: mergeMs,
      total: totalMs,
    },
    verification: outcome.evidence.verification_results.map((r) => ({
      alias: r.command_alias,
      exit_code: r.exit_code,
      duration_ms: r.duration_ms,
      passed: r.passed,
    })),
    merge_commit: merged.commitSha,
    worktree_removed: merged.worktreeRemoved,
    nothing_to_merge: merged.nothingToMerge,
    conflict_resolution: merged.conflictResolution,
    trailers: trailerLines,
    measured_at: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
  };

  const outDir = path.join(REPO_ROOT, ".stagent", "dogfooding");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `run-${Date.now()}.json`);
  fs.writeFileSync(outFile, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");

  console.log("=== Dogfooding 演练完成 ===");
  console.log(`合同      : ${metrics.contract_id}（${admission.decision}）`);
  console.log(
    `Evidence  : ${metrics.evidence_id} / ${metrics.evidence_status} / can_merge=${metrics.can_merge}`,
  );
  console.log(`合并提交  : ${metrics.merge_commit}`);
  console.log(
    `耗时(ms)  : 准入+Worktree=${admitMs} 写入=${workerMs} 验证=${executeMs} 合并+清理=${mergeMs} 合计=${totalMs}`,
  );
  console.log(`Trailer   :\n${trailerLines.map((l) => `  ${l}`).join("\n")}`);
  console.log(`指标落盘  : ${path.relative(REPO_ROOT, outFile)}`);
}

main().catch((err) => {
  console.error(`[dogfooding] 失败：${(err as Error).message}`);
  process.exit(1);
});
