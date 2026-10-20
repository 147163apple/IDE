import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyNetworkPolicy,
  buildCommandEnvironment,
} from "../../daemon/worker/policy-guard";
import { runCommand } from "../../daemon/runner/command-runner";

/**
 * TASK-W.3：policy-guard 统一环境白名单 / env_file_grants / 网络策略。
 * DENY 的定位见 ADR-003：非对抗性离线约束，不是强制网络隔离。
 */

const permissions = (overrides: Record<string, unknown> = {}) => ({
  allowed_environment_variable_names: ["ALLOWED_FLAG"],
  env_file_grants: [],
  network_policy: "DENY" as const,
  ...overrides,
});

describe("W.3 policy-guard：环境与网络", () => {
  let worktree: string;

  beforeEach(() => {
    worktree = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-policy-"));
    fs.mkdirSync(path.join(worktree, "src"), { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch {
      // 清理尽力而为
    }
  });

  it("宿主非白名单变量被隔离，合同声明变量可透传", () => {
    const baseEnv: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin",
      HOME: "/home/user",
      HOST_SECRET_TOKEN: "host-secret-do-not-leak",
      ALLOWED_FLAG: "allowed-value",
    };
    const { env } = buildCommandEnvironment({
      permissions: permissions(),
      worktreeRoot: worktree,
      baseEnv,
    });
    expect(env["HOST_SECRET_TOKEN"]).toBeUndefined();
    expect(env["ALLOWED_FLAG"]).toBe("allowed-value");
    expect(env["PATH"]).toBe("/usr/bin:/bin");
  });

  it("env_file_grants 只对声明别名生效，并登记为秘密值", () => {
    fs.writeFileSync(
      path.join(worktree, ".env.grant"),
      "GRANTED_API_TOKEN=super-secret-value\n",
    );
    const perms = permissions({
      env_file_grants: [
        {
          file: ".env.grant",
          variable_names: ["GRANTED_API_TOKEN"],
          command_aliases: ["verify"],
        },
      ],
    });

    const granted = buildCommandEnvironment({
      permissions: perms,
      worktreeRoot: worktree,
      alias: "verify",
      baseEnv: {},
    });
    expect(granted.env["GRANTED_API_TOKEN"]).toBe("super-secret-value");
    expect(granted.secretValues).toContain("super-secret-value");

    const other = buildCommandEnvironment({
      permissions: perms,
      worktreeRoot: worktree,
      alias: "other",
      baseEnv: {},
    });
    expect(other.env["GRANTED_API_TOKEN"]).toBeUndefined();
  });

  it("DENY 注入离线约束（代理黑洞 + 包管理器 offline）", () => {
    const env = applyNetworkPolicy({ PATH: "/usr/bin" }, "DENY");
    expect(env["HTTP_PROXY"]).toBe("http://127.0.0.1:9");
    expect(env["HTTPS_PROXY"]).toBe("http://127.0.0.1:9");
    expect(env["npm_config_offline"]).toBe("true");
    expect(env["YARN_ENABLE_NETWORK"]).toBe("0");
    expect(env["PIP_NO_INDEX"]).toBe("1");

    const passive = applyNetworkPolicy({ PATH: "/usr/bin" }, "USER_APPROVED");
    expect(passive["HTTP_PROXY"]).toBeUndefined();
  });

  it("未传 resolvedEnv 的旧调用分支也走 policy-guard（隔离 + DENY 同时生效）", async () => {
    const previousToken = process.env["HOST_SECRET_TOKEN"];
    const previousFlag = process.env["ALLOWED_FLAG"];
    process.env["HOST_SECRET_TOKEN"] = "host-secret-do-not-leak";
    process.env["ALLOWED_FLAG"] = "allowed-value";
    try {
      const script =
        "console.log(JSON.stringify({" +
        "host:process.env.HOST_SECRET_TOKEN??null," +
        "allowed:process.env.ALLOWED_FLAG??null," +
        "offline:process.env.npm_config_offline??null}))";
      const result = await runCommand("node", {
        cwd: worktree,
        argv: { executable: "node", args: ["-e", script] },
        envOptions: { allowedKeyOverrides: ["ALLOWED_FLAG"] },
        networkPolicy: "DENY",
        timeoutMs: 30_000,
      });
      const parsed = JSON.parse(result.stdout.trim()) as Record<
        string,
        string | null
      >;
      expect(parsed["host"]).toBeNull();
      expect(parsed["allowed"]).toBe("allowed-value");
      expect(parsed["offline"]).toBe("true");
    } finally {
      if (previousToken === undefined) delete process.env["HOST_SECRET_TOKEN"];
      else process.env["HOST_SECRET_TOKEN"] = previousToken;
      if (previousFlag === undefined) delete process.env["ALLOWED_FLAG"];
      else process.env["ALLOWED_FLAG"] = previousFlag;
    }
  });

  it("秘密在截断前已遮蔽：超长输出里也看不到秘密值", async () => {
    const secret = "super-secret-value-123456";
    const script =
      `process.stdout.write(${JSON.stringify(secret)} + "\\n");` +
      `for (let i = 0; i < 400; i++) console.log("line-" + i + "-" + "x".repeat(40));`;
    const result = await runCommand("node", {
      cwd: worktree,
      argv: { executable: "node", args: ["-e", script] },
      resolvedEnv: { PATH: process.env["PATH"] ?? "" },
      secretValues: [secret],
      maxOutputChars: 600,
      timeoutMs: 30_000,
    });

    expect(result.truncated).toBe(true);
    expect(result.secretRedacted).toBe(true);
    expect(result.stdout).not.toContain(secret);
    expect(result.stdout).toContain("[REDACTED]");
  });
});
