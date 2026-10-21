import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { recoverDaemonState } from "../../daemon/recovery/crash-recovery";
import { cleanupStaleGitLocks } from "../../daemon/recovery/git-lock";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import { ContractOrchestrator } from "../../daemon/pipeline/orchestrator";
import { listWorktrees } from "../../daemon/git/worktree-manager";
import {
  acquirePidLock,
  getPidLockPath,
  PidLockError,
  readPidLock,
} from "../../daemon/core/pid-lock";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import { git } from "../helpers/git";

/**
 * Chaos 场景 1：中途拔线党（Crash Recovery & Lock Cleanup）
 * 模拟 Daemon 在 EXECUTING/VERIFYING 期间被 SIGKILL / 掉电打断。
 */

function gitTry(cwd: string, args: string[]): { code: number; out: string } {
  try {
    return { code: 0, out: git(cwd, args) };
  } catch (err) {
    const e = err as { status?: number; stdout?: Buffer | string };
    return { code: e.status ?? 1, out: String(e.stdout ?? "") };
  }
}

function makeContract(title: string): SoftwareContract {
  const draft = createContractDraft({
    title,
    description: "chaos crash recovery",
    acceptanceCriteria: ["verify passes"],
    writablePaths: ["src/**"],
    commands: [
      {
        alias: "verify",
        executable: "node",
        args: ["-e", "process.exit(0)"],
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

/** 等子进程退出 */
function waitExit(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolve) => {
    child.on("close", (code) => resolve(code ?? 0));
  });
}

describe("Chaos 1 / 中途拔线党：崩溃恢复与锁清理", () => {
  let repo: string;
  let store: ContractStore;
  let orchestrator: ContractOrchestrator;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-chaos1-"));
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

  const worktreeFor = (contractId: string) =>
    path.join(repo, ".stagent", "worktrees", `task-${contractId}`);

  it("SIGKILL 打断 git 操作：index.lock 残留造成「幽灵占用」，恢复后锁被清除且仓库可写", async () => {
    const contract = makeContract("crash lock");
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    const worktree = worktreeFor(contract.contract_id);
    const worktreeGitDir = path.join(
      repo,
      ".git",
      "worktrees",
      `task-${contract.contract_id}`,
    );
    expect(fs.existsSync(worktreeGitDir)).toBe(true);

    // 模拟「正在执行 git 写操作」的进程被 SIGKILL：锁已创建、进程已死
    const locker = spawn(
      process.execPath,
      [
        "-e",
        `const fs=require('fs');
         fs.writeFileSync(${JSON.stringify(path.join(worktreeGitDir, "index.lock"))}, '');
         setInterval(()=>{}, 1000);`,
      ],
      { stdio: "ignore" },
    );
    await new Promise((r) => setTimeout(r, 700));
    locker.kill("SIGKILL");
    await waitExit(locker);

    expect(fs.existsSync(path.join(worktreeGitDir, "index.lock"))).toBe(true);

    // 崩溃实况：Worktree 里任何 git 写操作都被锁挡住
    const blocked = gitTry(worktree, ["add", "-A"]);
    expect(blocked.code).not.toBe(0);

    // 自愈
    const report = await recoverDaemonState({
      repoRoot: repo,
      gitLockMinAgeMs: 0,
    });
    expect(report.cleanedLocks.some((p) => p.endsWith("index.lock"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(worktreeGitDir, "index.lock"))).toBe(false);

    // 清理后仓库恢复正常
    expect(gitTry(worktree, ["add", "-A"]).code).toBe(0);
  });

  it("陈旧 PID 锁被回收，活进程持有的 PID 锁仍被拒绝（不制造幽灵占用）", async () => {
    // 1. 已死进程的 PID 锁 → 可回收
    const dead = spawn(process.execPath, ["-e", "process.exit(0)"], {
      stdio: "ignore",
    });
    await waitExit(dead);
    const deadPid = dead.pid ?? 0;
    fs.writeFileSync(
      getPidLockPath(repo),
      JSON.stringify({
        pid: deadPid,
        port: 3680,
        repoRoot: repo,
        startedAt: new Date().toISOString(),
        version: "0.1.0",
      }),
      "utf-8",
    );
    const reclaimed = await acquirePidLock(repo, 3681);
    expect(reclaimed.pid).toBe(process.pid);
    expect(readPidLock(repo)?.port).toBe(3681);

    // 2. 存活进程持有的 PID 锁 → 依然拒绝启动第二个 Daemon
    const alive = spawn(process.execPath, ["-e", "setInterval(()=>{}, 1000)"], {
      stdio: "ignore",
    });
    try {
      fs.writeFileSync(
        getPidLockPath(repo),
        JSON.stringify({
          pid: alive.pid ?? 0,
          port: 3682,
          repoRoot: repo,
          startedAt: new Date().toISOString(),
          version: "0.1.0",
        }),
        "utf-8",
      );
      await expect(acquirePidLock(repo, 3683)).rejects.toBeInstanceOf(
        PidLockError,
      );
    } finally {
      alive.kill("SIGKILL");
      await waitExit(alive);
    }
  });

  it("EXECUTING 中断：Worktree 与分支保留，合同转 PENDING_RESUME，且可 resume 后跑完闭环", async () => {
    const contract = makeContract("crash executing");
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    // 模拟崩溃前 Worker 已经写了代码（未提交）
    const worktree = worktreeFor(contract.contract_id);
    fs.writeFileSync(
      path.join(worktree, "src", "wip.ts"),
      "export const wip = 1;\n",
    );

    expect(store.get(contract.contract_id)?.lifecycle_state).toBe("EXECUTING");
    const headBefore = git(repo, ["rev-parse", "HEAD"]).trim();

    const report = await recoverDaemonState({ repoRoot: repo });
    const record = report.records.find(
      (r) => r.contractId === contract.contract_id,
    );
    expect(record?.from).toBe("EXECUTING");
    expect(record?.to).toBe("PENDING_RESUME");
    expect(record?.outcome).toBe("RESUMED");
    expect(record?.worktreeExisted).toBe(true);

    // 状态机没卡死：可续跑
    expect(store.get(contract.contract_id)?.lifecycle_state).toBe(
      "PENDING_RESUME",
    );

    // Worktree 与任务分支都在，patch 已被留存
    expect(fs.existsSync(worktree)).toBe(true);
    const listed = await listWorktrees(repo);
    // porcelain 输出的 branch 是完整 ref
    expect(
      listed.some(
        (w) => w.branch === `refs/heads/task/${contract.contract_id}`,
      ),
    ).toBe(true);
    expect(fs.existsSync(path.join(worktree, "src", "wip.ts"))).toBe(true);
    expect(record?.patchPath).toBeTruthy();
    expect(fs.existsSync(record?.patchPath ?? "")).toBe(true);

    // 断点续跑 → EXECUTING → 重新验证 → AUDITED
    const resumed = await orchestrator.resume(contract.contract_id);
    expect(resumed.lifecycle_state).toBe("EXECUTING");
    const outcome = await orchestrator.execute(contract.contract_id);
    expect(outcome.contract.lifecycle_state).toBe("AUDITED");
    expect(outcome.evidence.verdict.status).toBe("PASSED");
    // 崩溃前的改动没有丢
    expect(fs.existsSync(path.join(worktree, "src", "wip.ts"))).toBe(true);
    expect(git(repo, ["rev-parse", "HEAD"]).trim()).toBe(headBefore);
  });

  it("Worktree 元数据被毁：判定 WORKTREE_LOST 并转 ABORTED（不假装可续跑）", async () => {
    const contract = makeContract("crash lost");
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    // 物理目录还在，但 git 管理目录被破坏（等价于 Worktree 已不可用）
    fs.rmSync(
      path.join(repo, ".git", "worktrees", `task-${contract.contract_id}`),
      { recursive: true, force: true },
    );

    const report = await recoverDaemonState({ repoRoot: repo });
    const record = report.records.find(
      (r) => r.contractId === contract.contract_id,
    );
    expect(record?.outcome).toBe("ABORTED");
    expect(record?.reasonCode).toBe("WORKTREE_LOST");
    expect(store.get(contract.contract_id)?.lifecycle_state).toBe("ABORTED");
  });

  it("孤儿 Worktree 被清理，且恢复流程幂等（二次扫描不重复改写）", async () => {
    const contract = makeContract("crash orphan");
    store.save(contract);
    await orchestrator.approve(contract.contract_id, "tina");

    // 制造孤儿：删掉合同文件，只留下 Worktree
    fs.rmSync(store.filePath(contract.contract_id));

    const first = await recoverDaemonState({ repoRoot: repo });
    expect(
      first.orphanWorktrees.some((p) => p.includes(contract.contract_id)),
    ).toBe(true);
    expect(fs.existsSync(worktreeFor(contract.contract_id))).toBe(false);

    // 幂等：第二次扫描不再产生记录
    const second = await recoverDaemonState({ repoRoot: repo });
    expect(second.records).toHaveLength(0);
    expect(second.orphanWorktrees).toHaveLength(0);
    expect(second.errors).toHaveLength(0);
  });

  it("锁清理保守性：持有者存活的锁文件不会被误删，持有者死后才回收", async () => {
    const liveLock = path.join(repo, ".git", "index.lock");
    const holder = spawn(
      process.execPath,
      ["-e", "setInterval(()=>{}, 1000)"],
      { stdio: "ignore" },
    );
    try {
      // 锁文件内容记录了持有者 PID，且该进程存活 → 必须跳过
      fs.writeFileSync(liveLock, String(holder.pid ?? 0), "utf-8");
      const res = cleanupStaleGitLocks(repo, { minAgeMs: 0 });
      expect(res.removed).not.toContain(liveLock);
      expect(res.skipped).toContain(liveLock);
      expect(fs.existsSync(liveLock)).toBe(true);
    } finally {
      holder.kill("SIGKILL");
      await waitExit(holder);
    }

    // 持有者已死 → 判定为崩溃残留，回收
    const res2 = cleanupStaleGitLocks(repo, { minAgeMs: 0 });
    expect(res2.removed).toContain(liveLock);
    expect(fs.existsSync(liveLock)).toBe(false);
  });
});
