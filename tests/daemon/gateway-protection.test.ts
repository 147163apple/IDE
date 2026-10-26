import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";

import { ScopedWorktreeGateway } from "../../daemon/mcp/gateway";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import {
  decideApproval,
  loadRoundState,
} from "../../daemon/protection/protection-list";

/**
 * C.5 验收要求：P.1 保护门卫必须在所有写入/删除/改名之前执行。
 * 本用例专门锁住 W.2 新增的 delete_file：命中保护区时写入与删除都必须被拦，
 * 且文件内容/存在性不变；用户同意后才放行。
 *
 * 目录结构模拟真实部署：保护清单在主仓库，Agent 在 .stagent/worktrees/task-* 内执行。
 */

function makeContract() {
  const draft = createContractDraft({
    title: "P.1 门卫 × W.2 删除",
    description: "保护门卫必须先于写入/删除执行",
    acceptanceCriteria: ["保护区不可写不可删"],
    writablePaths: ["src/**"],
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

describe("P.1 门卫 × W.2 write/delete 顺序", () => {
  let repo: string;
  let worktree: string;
  let gateway: ScopedWorktreeGateway;
  let protectedFile: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-guard-w2-"));
    fs.mkdirSync(path.join(repo, ".stagent"), { recursive: true });
    fs.writeFileSync(
      path.join(repo, ".stagent", "protection.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "pe-auth",
            name: "登录",
            patterns: ["src/auth/**"],
            createdAt: new Date().toISOString(),
          },
        ],
      }),
    );
    worktree = path.join(repo, ".stagent", "worktrees", "task-t1");
    protectedFile = path.join(worktree, "src", "auth", "login.ts");
    fs.mkdirSync(path.dirname(protectedFile), { recursive: true });
    fs.writeFileSync(protectedFile, "// protected\n");
    gateway = new ScopedWorktreeGateway(worktree, makeContract());
  });

  afterEach(() => {
    try {
      safeRmSync(repo);
    } catch {
      // 清理尽力而为
    }
  });

  it("写入受保护文件被拦，文件内容不变", async () => {
    const res = await gateway.callTool("stagent_write_file", {
      path: "src/auth/login.ts",
      content: "// hacked\n",
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("PROTECTED_PATH");
    expect(fs.readFileSync(protectedFile, "utf8")).toBe("// protected\n");
  });

  it("delete_file 同样先过门卫：受保护文件删不掉", async () => {
    const res = await gateway.callTool("stagent_delete_file", {
      path: "src/auth/login.ts",
    });
    expect(res.isError).toBe(true);
    expect(res.error?.code).toBe("PROTECTED_PATH");
    expect(fs.existsSync(protectedFile)).toBe(true);
  });

  it("用户同意后本轮放行：写入成功，删除不再被保护门卫拒绝", async () => {
    // 先触发一张待审批卡（写入被拦时登记）
    await gateway.callTool("stagent_write_file", {
      path: "src/auth/login.ts",
      content: "// hacked\n",
    });
    const pending = loadRoundState(repo).pending[0];
    expect(pending?.files).toContain("src/auth/login.ts");
    decideApproval(repo, pending!.id, "approve");

    const write = await gateway.callTool("stagent_write_file", {
      path: "src/auth/login.ts",
      content: "// approved change\n",
    });
    expect(write.isError).toBe(false);
    expect(fs.readFileSync(protectedFile, "utf8")).toBe("// approved change\n");

    // 本机安全策略可能拒绝 .stagent 下的真实 unlink（返回非 PROTECTED_PATH 错误），
    // 因此这里只断言「保护门卫已放行」；真实删除成功路径由 W.2 的 delete_file 用例覆盖。
    const del = await gateway.callTool("stagent_delete_file", {
      path: "src/auth/login.ts",
    });
    expect(del.error?.code).not.toBe("PROTECTED_PATH");
    if (!del.isError) {
      expect(fs.existsSync(protectedFile)).toBe(false);
    }
  });
});
