import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { runCommand } from "../../daemon/runner/command-runner";
import {
  isProcessTreeAlive,
  killProcessTree,
  waitForProcessTreeExit,
} from "../../daemon/runner/process-tree";

/**
 * 进程彻底回收（进程树 kill）验证。
 *
 * 场景构造：父进程 → fork 子进程 → fork 孙进程，三代全部忽略 SIGTERM
 * （模拟 dev server / watcher 这类"杀不死"的后代），并持续向心跳文件
 * 写入标记。超时或 abort 触发后：
 * 1. 心跳停止写入 → 证明没有任何一代存活；
 * 2. 进程组判定为已消失（isProcessTreeAlive === false）；
 * 3. 进程表中不存在携带唯一标记 token 的残留进程。
 */

const UNIQUE_TOKEN = "stagent-tree-kill-fixture";

/**
 * 生成三代进程夹具脚本：
 * node fixture.mjs parent → 派生 child → 派生 grandchild
 * 三代均 process.on("SIGTERM", () => {}) 忽略退出信号，并写入心跳文件。
 */
const FIXTURE_SOURCE = `
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { argv } = process;

const role = argv[2] || "parent";
const heartbeat = argv[3];
const token = argv[4] || "${UNIQUE_TOKEN}";

// 三代均忽略 SIGTERM：只有 SIGKILL（或 Windows /F）能终结
process.on("SIGTERM", () => {});
process.title = [token, role].join(":");

const beat = () => {
  try {
    fs.appendFileSync(heartbeat, role + " " + Date.now() + "\\n");
  } catch (e) {
    // 忽略写入竞争
  }
};
beat();
const beatTimer = setInterval(beat, 100);

function spawnNext(nextRole) {
  const child = spawn(process.execPath, [__filename, nextRole, heartbeat, token], {
    stdio: "ignore",
    detached: false,
  });
  child.unref();
  return child.pid;
}

if (role === "parent") {
  spawnNext("child");
} else if (role === "child") {
  spawnNext("grandchild");
}

// 永不自行退出
setInterval(() => {}, 1000);
`;

describe("进程树彻底回收（无孤儿泄漏）", () => {
  let tmp: string;
  let heartbeat: string;
  let fixturePath: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-tree-kill-"));
    heartbeat = path.join(tmp, "heartbeat.log");
    fixturePath = path.join(tmp, "fixture.cjs");
    fs.writeFileSync(fixturePath, FIXTURE_SOURCE, "utf-8");
    fs.writeFileSync(heartbeat, "", "utf-8");
  });

  afterEach(() => {
    safeRmSync(tmp);
  });

  /** 心跳停止写入 = 没有任何一代进程存活 */
  async function expectHeartbeatStopped(): Promise<void> {
    fs.writeFileSync(heartbeat, "", "utf-8");
    await new Promise((r) => setTimeout(r, 800));
    const after = fs.readFileSync(heartbeat, "utf-8");
    expect(after).toBe("");
  }

  /** 进程表中不应残留任何携带 fixture token 的进程（仅在 Unix 可用 pgrep 时校验） */
  function expectNoResidualProcesses(): void {
    if (process.platform === "win32") return;
    let listing = "";
    try {
      listing = execFileSync("ps", ["-ax", "-o", "pid=,command="], {
        encoding: "utf-8",
      });
    } catch {
      return;
    }
    const residual = listing
      .split("\n")
      .filter((line) => line.includes(UNIQUE_TOKEN));
    expect(residual).toEqual([]);
  }

  it("超时后祖父/父/子三代全部被清理，无后台孤儿存活", async () => {
    const result = await runCommand(
      `${process.execPath} ${fixturePath} parent ${heartbeat} ${UNIQUE_TOKEN}`,
      {
        cwd: tmp,
        timeoutMs: 800,
        argv: {
          executable: process.execPath,
          args: [fixturePath, "parent", heartbeat, UNIQUE_TOKEN],
        },
      },
    );

    // 1. 超时语义不变：exitCode 124 + timedOut
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBe(124);
    expect(result.aborted).toBe(false);

    // 2. 回收报告：忽略 SIGTERM 的进程必须升级到 SIGKILL 并确认退出
    expect(result.treeKill).toBeDefined();
    expect(result.treeKill?.signal).toBe("SIGKILL");
    expect(result.treeKill?.confirmed).toBe(true);

    // 3. 心跳停止：三代无一存活
    await expectHeartbeatStopped();
    // 4. 进程表无残留
    expectNoResidualProcesses();
  }, 30_000);

  it("用户 abort 时同样执行全树回收（无孤儿残留）", async () => {
    const controller = new AbortController();
    const started = runCommand(
      `${process.execPath} ${fixturePath} parent ${heartbeat} ${UNIQUE_TOKEN}`,
      {
        cwd: tmp,
        timeoutMs: 60_000,
        signal: controller.signal,
        argv: {
          executable: process.execPath,
          args: [fixturePath, "parent", heartbeat, UNIQUE_TOKEN],
        },
      },
    );

    // 等待三代进程真正起来（心跳出现 child / grandchild）
    const deadline = Date.now() + 5_000;
    for (;;) {
      const beat = fs.readFileSync(heartbeat, "utf-8");
      if (beat.includes("grandchild") || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(fs.readFileSync(heartbeat, "utf-8")).toContain("grandchild");

    controller.abort();
    const result = await started;

    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(130);
    expect(result.treeKill?.confirmed).toBe(true);

    await expectHeartbeatStopped();
    expectNoResidualProcesses();
  }, 30_000);

  it("killProcessTree / isProcessTreeAlive 直接可用（进程组判定与终结）", async () => {
    // 直接用 detached 派生一棵忽略 SIGTERM 的进程树
    const { spawn } = await import("node:child_process");
    const child = spawn(
      process.execPath,
      [fixturePath, "parent", heartbeat, UNIQUE_TOKEN],
      { cwd: tmp, stdio: "ignore", detached: true },
    );
    const pid = child.pid ?? 0;
    expect(pid).toBeGreaterThan(0);

    // 必须等到三代进程都已启动并注册 SIGTERM 处理器，
    // 否则可能在 JS 执行前被默认动作终止（测不到 SIGKILL 升级路径）
    const deadline = Date.now() + 5_000;
    for (;;) {
      const beat = fs.readFileSync(heartbeat, "utf-8");
      if (beat.includes("grandchild") || Date.now() > deadline) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(fs.readFileSync(heartbeat, "utf-8")).toContain("grandchild");
    expect(await isProcessTreeAlive(pid)).toBe(true);

    const report = await killProcessTree(pid, { graceMs: 500 });
    expect(report.signal).toBe("SIGKILL");
    expect(report.confirmed).toBe(true);
    expect(await isProcessTreeAlive(pid)).toBe(false);
    expect(await waitForProcessTreeExit(pid, 500)).toBe(true);

    await expectHeartbeatStopped();
    expectNoResidualProcesses();
  }, 30_000);
});
