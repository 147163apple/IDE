import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateContractDraft } from "../../daemon/supervisor/draft-generator";
import type { SupervisorMessage } from "../../daemon/supervisor/types";
import {
  seedDraftForm,
  toStudioDraft,
  toSupervisorContractView,
} from "../../src/components/supervisor-view-model";

/**
 * 前端「草案 → 视图」适配的单元口径。
 *
 * 关键点不是"能渲染"，而是**不许篡改后端事实**：
 * - 白话理由（rationale）必须原样透传，界面才有东西显示，不再落到「（无）」；
 * - 未决问题按序全量透传（G-11 零丢失），不去重、不截断；
 * - 可写范围必须与 L0 推导出的 `plan.writable_paths` 完全一致——
 *   否则"涉及范围"会变成一个和 Supervisor 实际建议无关的装饰。
 *
 * 这里刻意调用真实的 L0 生成器（纯规则、零模型调用）来造夹具，
 * 而不是手写一个理想化的假合同：只有真实草案才能反证适配器没有偷偷加工。
 */

const tmpDirs: string[] = [];

function newRepo(): string {
  const root = path.join(process.cwd(), ".tmp", "unit-draft-view-model");
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, "repo-"));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, ".stagent"), { recursive: true });
  return dir;
}

function msg(text: string): SupervisorMessage {
  return {
    message_id: "m-1",
    role: "user",
    text,
    created_at: "2026-10-21T00:00:00.000Z",
    source: "ui",
  };
}

async function realDraft(repoRoot: string, intent: string) {
  const outcome = await generateContractDraft({
    repoRoot,
    messages: [msg(intent)],
    trigger: "USER_REQUEST",
    now: () => new Date("2026-10-21T00:00:00.000Z"),
  });
  if (!outcome.generated) throw new Error("L0 应当总能生成草案");
  return outcome;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("草案 → Supervisor Tab 视图", () => {
  it("白话理由与未决问题来自 supervisor_metadata，原样透传不加工", async () => {
    const repo = newRepo();
    const draft = await realDraft(repo, "把界面的按钮换成圆角");
    const view = toSupervisorContractView(draft.contract, { isDraft: true });

    const assessment = draft.contract.supervisor_metadata?.maturity_assessment;
    expect(assessment).toBeDefined();
    // 真实 L0 一定给出规则理由（否则界面又退回「（无）」）
    expect(view.rationale.length).toBeGreaterThan(0);
    expect(view.rationale).toEqual(assessment?.rationale);
    // G-11：不截断、不去重，顺序与生成器一致
    expect(view.unresolved).toEqual(draft.unresolved_questions);
    expect(view.unresolved).toEqual(assessment?.unresolved_questions);
    // 草案标记只影响提示条，不改变生命周期事实
    expect(view.isDraft).toBe(true);
    expect(view.state).toBe("DRAFT");
    expect(view.approval).toBe("DRAFT");
  });

  it("涉及范围与 L0 推导的 plan.writable_paths 完全一致", async () => {
    const repo = newRepo();
    const draft = await realDraft(repo, "把界面的按钮换成圆角");
    const view = toSupervisorContractView(draft.contract, { isDraft: true });

    expect(view.writable).toEqual(draft.plan.writable_paths);
    expect(view.writable).toContain("src/components/**");
    // 禁区 = 默认保护清单（.env / .git / lock 文件），不是空数组摆设
    expect(view.forbidden).toEqual(draft.plan.strictly_forbidden_paths);
    // 验证命令可读化：executable + args 拼成一行给人看
    expect(view.commands.map((c) => c.argv)).toContain("npm run typecheck");
  });

  it("Studio 侧读同一份 supervisor_metadata，白话理由不再为空", async () => {
    const repo = newRepo();
    const draft = await realDraft(repo, "把界面的按钮换成圆角");
    const studio = toStudioDraft(draft.contract);

    expect(studio.rationale).toEqual(draft.rationale);
    expect(studio.rationale.length).toBeGreaterThan(0);
    expect(studio.unresolved_questions).toEqual(draft.unresolved_questions);
    expect(studio.writable_paths).toEqual(draft.plan.writable_paths);
  });

  it("命中保护清单时，未决问题里出现白话提示且草案仍可生成（不自己审批）", async () => {
    const repo = newRepo();
    fs.writeFileSync(
      path.join(repo, ".stagent", "protection.json"),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: "prot-1",
            name: "登录",
            patterns: ["src/components/**"],
            createdAt: "2026-10-21T00:00:00.000Z",
          },
        ],
      }),
    );
    const draft = await realDraft(repo, "把界面的按钮换成圆角");
    const view = toSupervisorContractView(draft.contract, { isDraft: true });

    expect(draft.plan.needs_protection_approval).toBe(true);
    expect(view.unresolved.join("\n")).toContain("登录");
    // 越权红线：草案永远停在 DRAFT，不会自己变成 PENDING_REVIEW/APPROVED
    expect(view.approval).toBe("DRAFT");
  });
});

describe("草案 → 新建需求表单预填", () => {
  it("标题/描述/可写范围/验证命令都取草案的真实推导结果", async () => {
    const repo = newRepo();
    const draft = await realDraft(repo, "把界面的按钮换成圆角");
    const seed = seedDraftForm(draft);

    expect(seed.title).toBe(draft.contract.intent.title);
    expect(seed.description).toBe(draft.contract.intent.description);
    expect(seed.paths).toBe(draft.plan.writable_paths.join(", "));
    expect(seed.command).toBe("npm run typecheck");
    expect(seed.acceptance).toEqual(draft.contract.intent.acceptance_criteria);
  });
});
