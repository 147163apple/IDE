import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";

/** 清理兜底：沙箱拒绝删除临时目录时不影响断言 */
function safeRm(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore cleanup failures
  }
}
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { runCommand, truncateOutput } from "../../daemon/runner/command-runner";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";

/**
 * Chaos 场景 4：狂暴输出炸弹党（Stdout / Stderr Buffer Bomb）
 * 验证命令死循环输出几十兆日志：Daemon 不得 OOM、截断必须生效、Evidence 体积必须受限。
 */

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

/**
 * 生成「狂暴输出 + 末尾哨兵」的 node 脚本。
 * 必须用 fs.writeSync 同步写 fd：process.stdout.write 到管道是异步的，
 * 紧接着 process.exit() 会把未 flush 的数据丢掉，压测根本跑不出真实产量。
 */
function bombScript(
  totalBytes: number,
  sentinel: string,
  fd: 1 | 2 = 1,
): string {
  return [
    `const fs = require('fs');`,
    `const chunk = Buffer.alloc(65536, 0x61);`,
    `const total = ${totalBytes};`,
    `let written = 0;`,
    `while (written < total) {`,
    `  const len = Math.min(chunk.length, total - written);`,
    `  let off = 0;`,
    `  while (off < len) off += fs.writeSync(${fd}, chunk, off, len - off);`,
    `  written += len;`,
    `}`,
    `fs.writeSync(${fd}, Buffer.from(${JSON.stringify(`\n${sentinel}\n`)}));`,
  ].join("\n");
}

describe("Chaos 4 / 狂暴输出炸弹：内存有界与头尾截断", () => {
  let workdir: string;

  beforeEach(() => {
    workdir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-chaos4-"));
  });

  afterEach(() => {
    safeRm(workdir);
  });

  it("50MB 狂暴输出：进程存活、内存有界、真实尾部被保留", async () => {
    const sentinel = "TAIL-SENTINEL-9f3c";
    const script = bombScript(50 * 1024 * 1024, sentinel);
    const maxOutputChars = 10_000;

    const rssBefore = process.memoryUsage().rss;
    const result = await runCommand("node", {
      cwd: workdir,
      argv: { executable: "node", args: ["-e", script] },
      timeoutMs: 60_000,
      maxOutputChars,
    });
    const rssGrowth = process.memoryUsage().rss - rssBefore;

    // 1. 命令正常结束，没被 OOM / 超时干掉
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);

    // 2. 真实产量被如实记录（用于审计），且远超上限
    expect(result.stdoutBytes).toBeGreaterThan(45 * 1024 * 1024);
    expect(result.truncated).toBe(true);

    // 3. 输出长度有界（含截断标记）
    expect(result.stdout.length).toBeLessThan(maxOutputChars + 400);
    expect(result.stdout).toContain("TRUNCATED");

    // 4. 头尾双保留：头部与真实尾部都在（只留头部会丢掉最后的报错/哨兵）
    expect(result.stdout.startsWith("aaaa")).toBe(true);
    expect(result.stdout.trimEnd().endsWith(sentinel)).toBe(true);

    // 5. 内存没有随输出量线性膨胀（50MB 输入被限制在缓冲上限内）
    //    无界缓冲时 RSS 增量会达到 100MB+ 量级
    expect(rssGrowth).toBeLessThan(120 * 1024 * 1024);
  }, 90_000);

  it("stderr 同样受控：狂暴错误输出不会撑爆内存", async () => {
    const script =
      bombScript(13 * 1024 * 1024, "STDERR-END-MARK", 2) + `\nprocess.exit(1);`;

    const result = await runCommand("node", {
      cwd: workdir,
      argv: { executable: "node", args: ["-e", script] },
      timeoutMs: 60_000,
      maxOutputChars: 8_000,
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderrBytes).toBeGreaterThan(12 * 1024 * 1024);
    expect(result.stderr.length).toBeLessThan(8_000 + 400);
    expect(result.stderr).toContain("TRUNCATED");
    expect(result.stderr.trimEnd().endsWith("STDERR-END-MARK")).toBe(true);
  }, 60_000);

  it("truncateOutput 在超限时保留头尾并给出省略量", () => {
    const head = "H".repeat(1000);
    const middle = "M".repeat(9000);
    const tail = "T".repeat(1000);
    const text = head + middle + tail;

    const out = truncateOutput(text, 2_000, "stdout", 11_000);
    expect(out.startsWith("H".repeat(100))).toBe(true);
    expect(out.endsWith("T".repeat(100))).toBe(true);
    expect(out).toContain("stdout TRUNCATED");
    expect(out).toContain("11000 bytes");

    // 未超限时不改写
    expect(truncateOutput("short", 100, "stdout", 5)).toBe("short");
  });
});

describe("Chaos 4 / Evidence 体积硬上限", () => {
  let repo: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-chaos4-evi-"));
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
    safeRm(repo);
  });

  it("验证命令狂喷日志：Evidence JSON 仍处于安全上限内且只留尾巴", async () => {
    const script = bombScript(20 * 1024 * 1024, "EVI-TAIL");
    const draft = createContractDraft({
      title: "output bomb evidence",
      description: "chaos4",
      acceptanceCriteria: ["verify passes"],
      writablePaths: ["src/**"],
      maxDurationSeconds: 120,
      commands: [
        {
          alias: "verify",
          executable: "node",
          args: ["-e", script],
          expected_exit_code: 0,
          timeout_seconds: 120,
        },
      ],
    });
    const contract: SoftwareContract = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "PENDING_APPROVAL",
      approval: { status: "PENDING_REVIEW" },
    });
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");
    const outcome = await orchestrator.execute(contract.contract_id);

    expect(outcome.evidence.verdict.status).toBe("PASSED");

    // Evidence 内存对象
    expect(outcome.evidence.verification_results).toHaveLength(1);
    const stored = outcome.evidence.verification_results[0];
    expect(stored).toBeDefined();
    expect(stored!.stdout_tail.length).toBeLessThanOrEqual(2_000);
    expect(stored!.stdout_tail).toContain("EVI-TAIL");

    // 落盘快照体积严格受限（几十兆日志不得硬塞进存证）
    const evidencePath = path.join(
      repo,
      ".stagent",
      "evidence",
      `${contract.contract_id}-${outcome.evidence.evidence_id}.json`,
    );
    const size = fs.statSync(evidencePath).size;
    expect(size).toBeLessThan(512 * 1024);
  }, 120_000);

  it("网关返回的命令结果同样带字节统计，供 UI 提示「已截断」", async () => {
    const worktree = fs.mkdtempSync(
      path.join(os.tmpdir(), "stagent-chaos4-gw-"),
    );
    try {
      const contract = createContractDraft({
        title: "gateway bomb",
        description: "chaos4",
        acceptanceCriteria: ["ok"],
        writablePaths: ["src/**"],
        commands: [
          {
            alias: "verify",
            executable: "node",
            args: ["-e", bombScript(12 * 1024 * 1024, "GW-TAIL")],
            expected_exit_code: 0,
            timeout_seconds: 60,
          },
        ],
      });
      const gateway = new ScopedWorktreeGateway(worktree, contract);
      const res = await gateway.callTool(
        "stagent_exec_command",
        {
          executable: "node",
          args: ["-e", bombScript(12 * 1024 * 1024, "GW-TAIL")],
        },
        { internal: true },
      );
      const data = res.data as {
        truncated: boolean;
        stdoutBytes: number;
        stdout: string;
      };
      expect(res.isError).toBe(false);
      expect(data.truncated).toBe(true);
      expect(data.stdoutBytes).toBeGreaterThan(11 * 1024 * 1024);
      expect(data.stdout.length).toBeLessThan(100_000 + 400);
      expect(data.stdout.trimEnd().endsWith("GW-TAIL")).toBe(true);
    } finally {
      safeRm(worktree);
    }
  }, 90_000);
});
