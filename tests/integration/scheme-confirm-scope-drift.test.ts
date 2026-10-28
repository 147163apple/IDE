import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeRmSync } from "../helpers/tmp";
import { git } from "../helpers/git";
import { createDaemon, type StagentDaemon } from "../../daemon/server";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  EMPTY_DEMO_GATE,
  emptySchemeDraft,
  type SchemeDraft,
} from "../../src/lib/journey/scheme-draft";
import {
  scopePlanToContractScope,
  type ScopePlan,
} from "../../src/lib/journey/scope-plan";

/**
 * TASK-J.4 / SSOT §15.5 签署链对齐（S2-05 / S2-06 / S2-07）。
 *
 * 全部断言落在真 Daemon 落盘后的权威状态：
 * - 冻结前项目变化 → 409 `E_SCOPE_PLAN_DRIFT`，且**不写快照**；
 * - 带 confirmation_id 的合同范围与快照不一致 → 409 `E_SCHEME_SNAPSHOT_MISMATCH`，合同不落库；
 * - 合规链（老项目 / 绿野 / 非 npm）不出现 `E_WRITABLE_SCOPE_POLICY`；
 * - 1.0 旧快照 → 409 `E_SCHEME_SNAPSHOT_NOT_FOUND`。
 *
 * 端口段按卡片固定 3930–3939。
 */

interface ErrBody {
  error?: string;
  code?: string;
  message?: string;
  scope_plan?: ScopePlan;
}

describe("TASK-J.4 范围预检与快照绑定（真 Daemon）", () => {
  let repo: string;
  let daemon: StagentDaemon | null = null;
  let base: string;
  let token: string;

  beforeEach(async () => {
    repo = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "stagent-scope-http-")),
    );
    git(repo, ["init", "-q", "-b", "main"]);
    git(repo, ["config", "user.email", "t@example.com"]);
    git(repo, ["config", "user.name", "T"]);
    fs.writeFileSync(path.join(repo, "README.md"), "# fixture\n");
    // Daemon 会写 .stagent；别让它污染 git 工作区（审批要求基线干净）
    fs.writeFileSync(path.join(repo, ".gitignore"), ".stagent/\n.tmp/\n");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", "init"]);

    daemon = createDaemon({
      repoRoot: repo,
      startPort: 3930,
      endPort: 3939,
      enableCrashRecovery: false,
    });
    const info = await daemon.start();
    base = `http://127.0.0.1:${info.port}`;
    token = daemon.getSessionToken() ?? "";
  });

  afterEach(async () => {
    try {
      if (daemon?.isRunning) await daemon.stop();
    } catch {
      // 停服失败不该掩盖断言
    }
    daemon = null;
    safeRmSync(repo);
  });

  const auth = () => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    connection: "close",
  });

  async function call<T = ErrBody>(
    method: string,
    pathname: string,
    body?: unknown,
  ): Promise<{ status: number; body: T }> {
    const res = await fetch(`${base}${pathname}`, {
      method,
      headers: auth(),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return {
      status: res.status,
      body: (text.length > 0 ? JSON.parse(text) : {}) as T,
    };
  }

  const commitAll = (message: string) => {
    git(repo, ["add", "."]);
    git(repo, ["commit", "-q", "-m", message]);
  };

  const write = (rel: string, content = "") => {
    const file = path.join(repo, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };

  function makeScheme(partial: Partial<SchemeDraft> = {}): SchemeDraft {
    return emptySchemeDraft({
      title: "工程项目进度管控台",
      summary: "按项目维度汇总进度与预算，并对超期节点发出预警。",
      modules: ["工程进度管控", "pages"],
      mermaidFlow: "flowchart LR\n  A[录入进度] --> B[汇总]",
      business_input_rounds: 1,
      scheme_revision: 2,
      ...partial,
    });
  }

  const freezeBody = (confirmationId: string, scheme: SchemeDraft) => ({
    confirmation_id: confirmationId,
    scheme,
    demo: EMPTY_DEMO_GATE,
    decision: {
      code: "OK",
      message: "未生成 Demo，按静态方案签署",
      demo_mode: "none",
    },
  });

  async function preflight(scheme: SchemeDraft): Promise<ScopePlan> {
    const res = await call<{ scope_plan: ScopePlan }>(
      "POST",
      "/api/supervisor/scope/preflight",
      { scheme },
    );
    expect(res.status).toBe(200);
    return res.body.scope_plan;
  }

  /**
   * Daemon 启动后基线脏区快照可能晚于首个请求落盘，导致「预检」与「冻结重跑」
   * 之间的 plan 抖动（测试环境专有）。连续两次得到同一 digest 才作为提交值。
   */
  async function stablePreflight(
    scheme: SchemeDraft,
    decisions?: { approvals: Array<{ id: string; approved: boolean }> },
  ): Promise<ScopePlan> {
    const ask = async () => {
      const res = await call<{ scope_plan: ScopePlan }>(
        "POST",
        "/api/supervisor/scope/preflight",
        decisions === undefined ? { scheme } : { scheme, decisions },
      );
      expect(res.status).toBe(200);
      return res.body.scope_plan;
    };
    let previous = await ask();
    for (let i = 0; i < 6; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      const next = await ask();
      if (next.plan_digest === previous.plan_digest) return next;
      previous = next;
    }
    return previous;
  }

  function contractFromPlan(
    plan: ScopePlan,
    lifecycle: "DRAFT" | "PENDING_APPROVAL",
  ): SoftwareContract {
    const scope = scopePlanToContractScope(plan);
    const draft = createContractDraft({
      title: "按快照签署",
      description: "TASK-J.4 签署链",
      acceptanceCriteria: ["verify passes"],
      writablePaths: scope.writable_paths,
      strictlyForbiddenPaths: scope.forbidden_paths,
      commands: scope.verification_spec.commands,
      maxFileModifications: scope.budget.max_file_modifications,
      maxDurationSeconds: scope.budget.max_duration_seconds,
      maxVerificationRetries: scope.budget.max_verification_retries,
    });
    return softwareContractSchema.parse({
      ...draft,
      lifecycle_state: lifecycle,
      authorization: {
        ...draft.authorization,
        file_system_scope: {
          ...draft.authorization.file_system_scope,
          writable_paths: scope.writable_paths,
          strictly_forbidden_paths: scope.forbidden_paths,
        },
        budget_limits: scope.budget,
      },
      verification_spec: scope.verification_spec,
      ...(lifecycle === "PENDING_APPROVAL"
        ? { approval: { status: "PENDING_REVIEW" } }
        : {}),
    });
  }

  const snapshotPath = (id: string) =>
    path.join(repo, ".stagent", "drafts", "schemes", `${id}.json`);

  // --- S205 ---------------------------------------------------------------

  it("T-HTTP-S205 冻结前项目从绿野变成老项目 → 409 E_SCOPE_PLAN_DRIFT，且不写快照", async () => {
    const scheme = makeScheme({ title: "新建一个小工具", summary: "做个工具" });
    const plan = await preflight(scheme);
    expect(plan.grade.ok).toBe(true);
    expect(scopePlanToContractScope(plan).writable_paths).toContain("src/**");

    // 项目在别处变了：绿野判定翻转
    write("package.json", JSON.stringify({ name: "now-npm", scripts: {} }));
    write("src/pages/home.tsx", "export const home = 1;\n");
    commitAll("become npm project");

    const confirmationId = "scheme-scope-drift-0001";
    const frozen = await call<ErrBody>(
      "POST",
      "/api/supervisor/scheme/freeze",
      {
        ...freezeBody(confirmationId, scheme),
        scope_plan: plan,
      },
    );

    expect(frozen.status).toBe(409);
    expect(frozen.body.code).toBe("E_SCOPE_PLAN_DRIFT");
    expect(frozen.body.scope_plan).toBeDefined();
    expect(frozen.body.scope_plan!.plan_digest).not.toBe(plan.plan_digest);
    expect(fs.existsSync(snapshotPath(confirmationId))).toBe(false);
  });

  // --- S206 ---------------------------------------------------------------

  it("T-HTTP-S206 合同 writable 比快照多一条 → 409 E_SCHEME_SNAPSHOT_MISMATCH，合同不落库", async () => {
    write(
      "package.json",
      JSON.stringify({ name: "npm", scripts: { test: "vitest run" } }),
    );
    write("src/pages/home.tsx", "export const home = 1;\n");
    commitAll("npm fixture");
    const scheme = makeScheme();
    const plan = await stablePreflight(scheme);
    expect(plan.grade.ok).toBe(true);

    const confirmationId = "scheme-scope-mismatch-0001";
    const frozen = await call("POST", "/api/supervisor/scheme/freeze", {
      ...freezeBody(confirmationId, scheme),
      scope_plan: plan,
    });
    expect(frozen.status, JSON.stringify(frozen.body)).toBe(201);

    const contract = contractFromPlan(plan, "DRAFT");
    contract.authorization.file_system_scope.writable_paths.push("src/evil.ts");
    const created = await call("POST", "/api/contracts", {
      contract,
      confirmation_id: confirmationId,
    });
    expect(created.status).toBe(409);
    expect(created.body.code).toBe("E_SCHEME_SNAPSHOT_MISMATCH");

    const list = await call<{ contracts: unknown[] }>("GET", "/api/contracts");
    expect(list.body.contracts).toHaveLength(0);
  });

  // --- S207a：老项目（npm 脚本齐全）完整链 --------------------------------

  it("T-HTTP-S207a 老项目：preflight → freeze → create → approve 全程不出现 E_WRITABLE_SCOPE_POLICY", async () => {
    write(
      "package.json",
      JSON.stringify({
        name: "npm",
        scripts: { typecheck: "tsc --noEmit", test: "vitest run" },
      }),
    );
    write("src/pages/home.tsx", "export const home = 1;\n");
    // 保护清单命中可写范围：准入停在 PENDING_APPROVAL，让 approve 这一步真的被走到
    write(
      ".stagent/protection.json",
      JSON.stringify(
        {
          version: 1,
          entries: [
            {
              id: "pe-scope-a",
              name: "页面",
              patterns: ["src/pages/**"],
              createdAt: "2026-01-01T00:00:00.000Z",
            },
          ],
        },
        null,
        2,
      ),
    );
    commitAll("npm fixture");

    const scheme = makeScheme();
    // 先拿到敏感项 id，再以「已同意」重算：既保留人工审批，又不让范围被排除
    const pendingPlan = await stablePreflight(scheme);
    const sensitive = pendingPlan.needs_approval.find((item) =>
      item.paths.some((p) => p.includes("src/pages")),
    );
    expect(sensitive).toBeDefined();
    const plan = await stablePreflight(scheme, {
      approvals: [{ id: sensitive!.id, approved: true }],
    });
    expect(plan.grade.ok).toBe(true);
    expect(plan.needs_approval.every((item) => item.approved === true)).toBe(
      true,
    );

    const confirmationId = "scheme-scope-a-0001";
    const frozen = await call("POST", "/api/supervisor/scheme/freeze", {
      ...freezeBody(confirmationId, scheme),
      scope_plan: plan,
    });
    expect(frozen.status, JSON.stringify(frozen.body)).toBe(201);

    const contract = contractFromPlan(plan, "PENDING_APPROVAL");
    const created = await call<{
      contract: SoftwareContract;
      admission?: { decision: string };
    }>("POST", "/api/contracts", {
      contract,
      confirmation_id: confirmationId,
    });
    expect(created.status).toBe(201);
    expect(created.body.admission?.decision).toBe("NEEDS_APPROVAL");
    expect(created.body.contract.lifecycle_state).toBe("PENDING_APPROVAL");

    const approved = await call<{ contract: SoftwareContract }>(
      "POST",
      `/api/contracts/${contract.contract_id}/approve`,
      { reviewer: "scope-tester", confirmation_id: confirmationId },
    );
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(approved.body.contract.lifecycle_state).toBe("EXECUTING");
    expect(JSON.stringify(approved.body)).not.toContain(
      "E_WRITABLE_SCOPE_POLICY",
    );
  });

  // --- S207b / S207c：被挂账项 1（manual_only → commands=[] vs schema min 1）阻塞 ---

  it.fails(
    "T-HTTP-S207b 绿野完整链（被挂账项 1 阻塞：commands=[] 过不了合同 schema）",
    async () => {
      fs.rmSync(path.join(repo, "README.md"));
      commitAll("greenfield");
      const scheme = makeScheme({ title: "新建工具", summary: "做个工具" });
      const plan = await preflight(scheme);
      expect(plan.verification.manual_only).toBe(true);

      const confirmationId = "scheme-scope-b-0001";
      const frozen = await call("POST", "/api/supervisor/scheme/freeze", {
        ...freezeBody(confirmationId, scheme),
        scope_plan: plan,
      });
      expect(frozen.status, JSON.stringify(frozen.body)).toBe(201);

      const contract = contractFromPlan(plan, "DRAFT");
      const created = await call<{ contract: SoftwareContract }>(
        "POST",
        "/api/contracts",
        { contract, confirmation_id: confirmationId },
      );
      expect(created.status).toBe(201);
      const approved = await call<{ contract: SoftwareContract }>(
        "POST",
        `/api/contracts/${contract.contract_id}/approve`,
        { reviewer: "scope-tester", confirmation_id: confirmationId },
      );
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    },
  );

  it.fails(
    "T-HTTP-S207c 非 npm 完整链（同一挂账项阻塞：没有 npm 脚本 → commands=[]）",
    async () => {
      write("pyproject.toml", "[project]\nname = 'fixture'\n");
      write("app/main.py", "print('hi')\n");
      commitAll("python fixture");
      const scheme = makeScheme({
        title: "改一下入口",
        summary: "修改 app/main.py 的入口逻辑",
        modules: [],
      });
      const plan = await preflight(scheme);
      expect(plan.grade.ok).toBe(true);
      expect(plan.verification.manual_only).toBe(true);

      const confirmationId = "scheme-scope-c-0001";
      const frozen = await call("POST", "/api/supervisor/scheme/freeze", {
        ...freezeBody(confirmationId, scheme),
        scope_plan: plan,
      });
      expect(frozen.status, JSON.stringify(frozen.body)).toBe(201);

      const contract = contractFromPlan(plan, "DRAFT");
      const created = await call<{ contract: SoftwareContract }>(
        "POST",
        "/api/contracts",
        { contract, confirmation_id: confirmationId },
      );
      expect(created.status).toBe(201);
    },
  );

  // --- S207d：1.0 旧快照 ----------------------------------------------------

  it("T-HTTP-S207d 1.0 旧快照 + confirmation_id → 409 E_SCHEME_SNAPSHOT_NOT_FOUND（版本过旧）", async () => {
    const confirmationId = "scheme-scope-legacy-0001";
    const scheme = makeScheme();
    fs.mkdirSync(path.join(path.dirname(snapshotPath(confirmationId))), {
      recursive: true,
    });
    fs.writeFileSync(
      snapshotPath(confirmationId),
      JSON.stringify({
        schema_version: "1.0",
        snapshot_id: confirmationId,
        confirmation_id: confirmationId,
        status: "FROZEN",
        created_at: "2026-01-01T00:00:00.000Z",
        scheme_revision: scheme.scheme_revision,
        scheme,
        demo: EMPTY_DEMO_GATE,
        decision: { code: "OK", message: "ok", demo_mode: "none" },
        digest: "legacy-digest",
      }),
    );
    const contract = createContractDraft({
      title: "旧快照",
      description: "1.0 快照没有范围",
      acceptanceCriteria: ["ok"],
      writablePaths: ["src/pages/**"],
    });
    const created = await call("POST", "/api/contracts", {
      contract,
      confirmation_id: confirmationId,
    });
    expect(created.status).toBe(409);
    expect(created.body.code).toBe("E_SCHEME_SNAPSHOT_NOT_FOUND");
    expect(created.body.message).toContain("快照版本过旧");
  });
});
