import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  E_UNSAFE_EXECUTION,
  ThreatGuardError,
  assessCommandThreat,
  assertCommandSafe,
  isRepoTrusted,
} from "../../daemon/worker/threat-guard";
import {
  RuntimeInterceptor,
  type AdapterSnapshot,
  type GatewayViolation,
} from "../../daemon/worker/runtime-interceptor";
import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";

/**
 * TASK-W.4 PASS 条件：
 * A. 威胁守卫在子进程创建前拒绝特权/主机路径/不可回收命令/未信任仓库；
 * B. 运行时复检在配置漂移、原生 FS/Shell、未知通道时立即降级并广播；
 * C. 4 类绕过负例 100% 阻断（Worktree 外写入、未授权 Shell、跨 Worktree、原生工具）。
 */

const snapshot = (
  overrides: Partial<AdapterSnapshot> = {},
): AdapterSnapshot => ({
  adapter_id: "stagent.builtin.ai-sdk",
  control_mode: "GATEWAY_ENFORCED",
  tool_interception_supported: true,
  filesystem_permissions: "GATEWAY_ONLY",
  command_permissions: "WHITELIST_ONLY",
  config_fingerprint: "v1:r1:builtin",
  ...overrides,
});

function makeInterceptor(
  worktree: string,
  overrides: Partial<AdapterSnapshot> = {},
) {
  const events: GatewayViolation[] = [];
  const interceptor = new RuntimeInterceptor({
    snapshot: snapshot(overrides),
    worktreeRoot: worktree,
    allowedAliases: ["verify"],
    broadcast: (v) => events.push(v),
  });
  return { interceptor, events };
}

function makeContract() {
  const draft = createContractDraft({
    title: "W.4 威胁守卫",
    description: "威胁守卫与运行时复检",
    acceptanceCriteria: ["越界执行被阻断"],
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
    lifecycle_state: "EXECUTING",
    approval: {
      status: "APPROVED",
      approved_by: "tina",
      approved_at: new Date().toISOString(),
    },
  });
}

describe("W.4 威胁守卫：命令启动前校验", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-threat-"));
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {
      // 清理尽力而为
    }
  });

  it("信任标记：trust.json 或 .git 存在才算已信任", () => {
    expect(isRepoTrusted(worktree)).toBe(false);
    fs.mkdirSync(path.join(worktree, ".stagent"), { recursive: true });
    fs.writeFileSync(
      path.join(worktree, ".stagent", "trust.json"),
      JSON.stringify({ trusted: true }),
    );
    expect(isRepoTrusted(worktree)).toBe(true);
  });

  it("未信任仓库直接拒绝", () => {
    const res = assessCommandThreat({
      executable: "node",
      args: ["-v"],
      worktreeRoot: worktree,
      repoTrusted: false,
    });
    expect(res.allowed).toBe(false);
    expect(res.category).toBe("UNTRUSTED_REPO");
  });

  it.each(["sudo", "chown", "insmod", "mount", "systemctl"])(
    "特权命令 %s 被拒绝",
    (cmd) => {
      const res = assessCommandThreat({
        executable: cmd,
        args: ["x"],
        worktreeRoot: worktree,
        repoTrusted: true,
      });
      expect(res.allowed).toBe(false);
      expect(res.category).toBe("PRIVILEGED_COMMAND");
    },
  );

  it("访问主机路径 / 通过 .. 逃逸均被拒绝", () => {
    for (const arg of ["/etc/passwd", "../main/src/a.ts"]) {
      const res = assessCommandThreat({
        executable: "cat",
        args: [arg],
        worktreeRoot: worktree,
        repoTrusted: true,
      });
      expect(res.allowed, arg).toBe(false);
      expect(res.category, arg).toBe("HOST_PATH_ACCESS");
    }
  });

  it.each([
    ["env sudo ls"],
    ["xargs sudo"],
    ["nice -n 5 sudo ls"],
    ["timeout 5 sudo ls"],
    ["caffeinate -d sudo ls"],
    ["command sudo ls"],
  ])("包装命令 %s 也会识别出特权命令", (line) => {
    const [executable, ...args] = line.split(" ");
    const res = assessCommandThreat({
      executable: executable as string,
      args,
      worktreeRoot: worktree,
      repoTrusted: true,
    });
    expect(res.allowed).toBe(false);
    expect(res.category).toBe("PRIVILEGED_COMMAND");
  });

  it("sh/bash/zsh -c 后的第一个词同样过特权检查", () => {
    for (const shell of ["sh", "bash", "zsh"]) {
      const res = assessCommandThreat({
        executable: shell,
        args: ["-c", "sudo ls /"],
        worktreeRoot: worktree,
        repoTrusted: true,
      });
      expect(res.allowed, shell).toBe(false);
      expect(res.category, shell).toBe("PRIVILEGED_COMMAND");
    }
  });

  it("chmod 仅在目标位于 Worktree 外时拒绝", () => {
    const inside = assessCommandThreat({
      executable: "chmod",
      args: ["755", "src/a.ts"],
      worktreeRoot: worktree,
      repoTrusted: true,
    });
    expect(inside.allowed).toBe(true);

    const outside = assessCommandThreat({
      executable: "chmod",
      args: ["755", "/etc/passwd"],
      worktreeRoot: worktree,
      repoTrusted: true,
    });
    expect(outside.allowed).toBe(false);
    expect(outside.category).toBe("HOST_PATH_ACCESS");
  });

  it("单段且不存在的 /xxx 不当作主机路径；明显的文件路径才拒绝", () => {
    const opaque = assessCommandThreat({
      executable: "echo",
      args: ["/celebrate"],
      worktreeRoot: worktree,
      repoTrusted: true,
    });
    expect(opaque.allowed).toBe(true);

    const fileLike = assessCommandThreat({
      executable: "cat",
      args: ["/tmp/missing-dir/secret.txt"],
      worktreeRoot: worktree,
      repoTrusted: true,
    });
    expect(fileLike.allowed).toBe(false);
    expect(fileLike.category).toBe("HOST_PATH_ACCESS");
  });

  it("Worker 的 command_alias 路径同样执行威胁检查", async () => {
    const draft = createContractDraft({
      title: "W.4 alias threat",
      description: "alias 走威胁守卫",
      acceptanceCriteria: ["拒绝 sudo"],
      writablePaths: ["src/**"],
      commands: [
        {
          alias: "priv",
          executable: "sudo",
          args: ["ls"],
          expected_exit_code: 0,
          timeout_seconds: 30,
        },
      ],
    });
    const contract = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "EXECUTING",
      approval: {
        status: "APPROVED",
        approved_by: "tina",
        approved_at: new Date().toISOString(),
      },
    });
    const gateway = new ScopedWorktreeGateway(worktree, contract, {});
    const res = await gateway.callTool("stagent_exec_command", {
      command_alias: "priv",
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe(E_UNSAFE_EXECUTION);
  });

  it("无法限制子进程的命令被拒绝，且拒绝路径不触碰 child_process", () => {
    for (const cmd of ["nohup", "setsid", "tmux", "systemd-run"]) {
      expect(() =>
        assertCommandSafe({
          executable: cmd,
          args: ["x"],
          worktreeRoot: worktree,
          repoTrusted: true,
        }),
      ).toThrow(ThreatGuardError);
    }
    // 纯函数评估：调用 assess 不会启动任何进程（模块本身不 import child_process）
    const spy = vi.spyOn(process, "kill");
    assessCommandThreat({
      executable: "sudo",
      args: [],
      worktreeRoot: worktree,
      repoTrusted: true,
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("W.4 运行时复检：能力漂移与未知通道", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-runtime-"));
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {
      // 清理尽力而为
    }
  });

  it("正常受控调用放行", () => {
    const { interceptor } = makeInterceptor(worktree);
    expect(
      interceptor.checkToolCall("stagent_write_file", {
        path: "src/a.ts",
        content: "x",
      }).allowed,
    ).toBe(true);
    expect(interceptor.canProduceEvidence()).toBe(true);
  });

  it("启动配置漂移 → 降级、停止、禁止证据并广播", () => {
    const { interceptor, events } = makeInterceptor(worktree);
    const result = interceptor.checkAdapter(
      snapshot({ config_fingerprint: "v2:r9:other" }),
    );
    expect(result.allowed).toBe(false);
    expect(result.violation?.code).toBe("CONFIG_CHANGED");
    expect(interceptor.getControlMode()).toBe("UNCONTROLLED_EXTERNAL");
    expect(interceptor.isStopped()).toBe(true);
    expect(interceptor.canProduceEvidence()).toBe(false);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("GATEWAY_VIOLATION");
  });

  it("原生 FS / 无限制 Shell 声明 → 拒绝受控执行", () => {
    const fsInterceptor = makeInterceptor(worktree).interceptor;
    expect(
      fsInterceptor.checkAdapter(
        snapshot({ filesystem_permissions: "DIRECT_UNCONTROLLED" }),
      ).violation?.code,
    ).toBe("NATIVE_FS_UNCONTROLLED");

    const shellInterceptor = makeInterceptor(worktree).interceptor;
    expect(
      shellInterceptor.checkAdapter(
        snapshot({ command_permissions: "UNRESTRICTED_SHELL" }),
      ).violation?.code,
    ).toBe("NATIVE_SHELL_UNCONTROLLED");
  });

  it("4 类绕过负例全部阻断", () => {
    const cases: Array<{
      name: string;
      tool: string;
      input: unknown;
      code: string;
    }> = [
      {
        name: "Worktree 外写入",
        tool: "stagent_write_file",
        input: { path: "../outside.txt", content: "x" },
        code: "HOST_PATH_ESCAPE",
      },
      {
        name: "未授权 Shell",
        tool: "stagent_exec_command",
        input: { command: "rm -rf /" },
        code: "UNAUTHORIZED_SHELL",
      },
      {
        name: "跨 Worktree 访问主树",
        tool: "stagent_read_file",
        input: { path: ".stagent/worktrees/task-other/src/a.ts" },
        code: "CROSS_WORKTREE_ACCESS",
      },
      {
        name: "跳过 Gateway 调原生工具",
        tool: "native_fs_write",
        input: { path: "src/a.ts", content: "x" },
        code: "UNKNOWN_CHANNEL",
      },
    ];

    for (const c of cases) {
      const { interceptor, events } = makeInterceptor(worktree);
      const res = interceptor.checkToolCall(c.tool, c.input);
      expect(res.allowed, c.name).toBe(false);
      expect(res.violation?.code, c.name).toBe(c.code);
      expect(interceptor.isStopped(), c.name).toBe(true);
      expect(interceptor.canProduceEvidence(), c.name).toBe(false);
      expect(events[0]?.type, c.name).toBe("GATEWAY_VIOLATION");

      // 降级后再调用任何工具都被拒
      expect(
        interceptor.checkToolCall("stagent_read_file", { path: "src/a.ts" })
          .violation?.code,
      ).toBe("EXECUTION_STOPPED");
    }
  });

  it("Gateway 接线：越界写入返回 E_UNSAFE_EXECUTION 且后续执行停止", async () => {
    const { interceptor } = makeInterceptor(worktree);
    const gateway = new ScopedWorktreeGateway(worktree, makeContract(), {
      runtimeInterceptor: interceptor,
    });
    const res = await gateway.callTool("stagent_write_file", {
      path: "../escape.txt",
      content: "x",
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe(E_UNSAFE_EXECUTION);
    expect(interceptor.canProduceEvidence()).toBe(false);
    expect(fs.existsSync(path.join(worktree, "..", "escape.txt"))).toBe(false);
  });
});
