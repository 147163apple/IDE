import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EMPTY_PRESENTATION_SNAPSHOT,
  forgetPersistedPresentation,
  getPersistedPresentation,
  loadPresentationSnapshot,
  persistPresentation,
  presentationStatePath,
  replacePresentationSnapshot,
  type PersistedPresentationRecord,
} from "../../daemon/state/presentation-store";
import {
  humanMessageFor,
  projectContract,
  readLatestEvidenceSignal,
  toStateChangedPayload,
} from "../../daemon/state/presentation-projector";
import {
  createContractDraft,
  softwareContractSchema,
  type SoftwareContract,
} from "../../src/lib/contract.schema";

/**
 * TASK-D.3（续）：展示态持久化与 Daemon 侧投影。
 *
 * 重点不是"能写能读"，而是三条容易退化的性质：
 * 1. 原子写：不留半截 JSON、不留临时文件；
 * 2. 容错：文件损坏时 Daemon 仍能启动（返回空快照而不是抛错）；
 * 3. 信息不足时不猜：AUDITED 缺证据信号时投影返回 null，调用方跳过广播。
 */

const tmpDirs: string[] = [];

function newRepo(): string {
  const base = path.join(process.cwd(), ".tmp", "unit-d3-state");
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, "case-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 受限环境可能拦截 unlink，不影响断言 */
    }
  }
});

function record(
  overrides: Partial<PersistedPresentationRecord> = {},
): PersistedPresentationRecord {
  return {
    contract_id: "contract_1",
    presentation_state: "EXECUTING",
    lifecycle_state: "EXECUTING",
    approval_status: "APPROVED",
    message: "记账本：正在按计划施工",
    updated_at: "2026-10-23T10:00:00.000Z",
    ...overrides,
  };
}

function contractAt(
  lifecycle: SoftwareContract["lifecycle_state"],
  approval: SoftwareContract["approval"],
): SoftwareContract {
  const draft = createContractDraft({
    title: "记账本",
    description: "D.3 持久化用例",
    acceptanceCriteria: ["可读取展示态"],
    writablePaths: ["src/lib/example.ts"],
  });
  return softwareContractSchema.parse({
    ...draft,
    lifecycle_state: lifecycle,
    approval,
  });
}

const APPROVED = {
  status: "APPROVED" as const,
  approved_by: "tina",
  approved_at: "2026-10-23T09:00:00.000Z",
  approved_revision: 1,
};

describe("持久化：写入 / 读回 / 原子性", () => {
  it("写入后可从 state.json 精确读回（模拟重启）", () => {
    const repo = newRepo();
    persistPresentation(repo, record());

    expect(fs.existsSync(presentationStatePath(repo))).toBe(true);

    const reloaded = getPersistedPresentation(repo, "contract_1");
    expect(reloaded).toEqual(record());
    expect(presentationStatePath(repo)).toBe(
      path.join(repo, ".stagent", "state.json"),
    );
  });

  it("多合同合并写入，互不覆盖", () => {
    const repo = newRepo();
    persistPresentation(repo, record());
    persistPresentation(
      repo,
      record({
        contract_id: "contract_2",
        presentation_state: "NEEDS_APPROVAL",
        lifecycle_state: "PENDING_APPROVAL",
        approval_status: "PENDING_REVIEW",
        message: "需要你确认授权",
      }),
    );

    const snapshot = loadPresentationSnapshot(repo);
    expect(Object.keys(snapshot.contracts).sort()).toEqual([
      "contract_1",
      "contract_2",
    ]);
    expect(snapshot.contracts["contract_2"]?.presentation_state).toBe(
      "NEEDS_APPROVAL",
    );
  });

  it("原子写：目录里不残留临时文件", () => {
    const repo = newRepo();
    persistPresentation(repo, record());

    const files = fs.readdirSync(path.join(repo, ".stagent"));
    expect(files).toEqual(["state.json"]);
  });

  it("文件缺失返回空快照而不是抛错", () => {
    const repo = newRepo();
    expect(loadPresentationSnapshot(repo)).toEqual(EMPTY_PRESENTATION_SNAPSHOT);
  });

  it("文件损坏返回空快照，且不删除损坏文件（便于排查）", () => {
    const repo = newRepo();
    const file = presentationStatePath(repo);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "{ 这不是合法 JSON", "utf8");

    expect(loadPresentationSnapshot(repo)).toEqual(EMPTY_PRESENTATION_SNAPSHOT);
    expect(fs.existsSync(file)).toBe(true);
  });

  it("结构不符的条目被丢弃，其余条目仍可用", () => {
    const repo = newRepo();
    const file = presentationStatePath(repo);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        updated_at: "2026-10-23T10:00:00.000Z",
        contracts: {
          good: record({ contract_id: "good" }),
          bad: { contract_id: "bad", presentation_state: 42 },
        },
      }),
      "utf8",
    );

    const snapshot = loadPresentationSnapshot(repo);
    expect(Object.keys(snapshot.contracts)).toEqual(["good"]);
  });

  it("forget 移除指定合同，其余保留", () => {
    const repo = newRepo();
    persistPresentation(repo, record());
    persistPresentation(repo, record({ contract_id: "contract_2" }));

    const next = forgetPersistedPresentation(repo, "contract_1");
    expect(Object.keys(next.contracts)).toEqual(["contract_2"]);
    expect(getPersistedPresentation(repo, "contract_1")).toBeNull();
  });

  it("replace 全量覆盖用于启动重建", () => {
    const repo = newRepo();
    persistPresentation(repo, record());
    const snapshot = replacePresentationSnapshot(repo, {
      only: record({ contract_id: "only" }),
    });
    expect(Object.keys(snapshot.contracts)).toEqual(["only"]);
    expect(
      loadPresentationSnapshot(repo).contracts["contract_1"],
    ).toBeUndefined();
  });
});

describe("投影：daemon 信号 → 展示态", () => {
  it("草案态按 Demo 是否运行分流", () => {
    const draft = contractAt("DRAFT", { status: "DRAFT" });
    expect(projectContract(draft)?.presentation_state).toBe("EXPLORING");
    expect(
      projectContract(draft, { demo_running: true })?.presentation_state,
    ).toBe("DEMO_PREVIEW");
  });

  it("待审 / 施工 / 停止 / 暂停各自映射正确", () => {
    expect(
      projectContract(
        contractAt("PENDING_APPROVAL", { status: "PENDING_REVIEW" }),
      )?.presentation_state,
    ).toBe("NEEDS_APPROVAL");
    expect(
      projectContract(contractAt("PREPARING", APPROVED))?.presentation_state,
    ).toBe("GRAPH_MAPPING");
    expect(
      projectContract(contractAt("EXECUTING", APPROVED))?.presentation_state,
    ).toBe("EXECUTING");
    expect(
      projectContract(contractAt("EXECUTING", APPROVED), {
        stopping_requested: true,
      })?.presentation_state,
    ).toBe("STOPPING");
    expect(
      projectContract(contractAt("PENDING_RESUME", APPROVED))
        ?.presentation_state,
    ).toBe("PAUSED");
  });

  it("验证失败且预算未耗尽 → FAILED；预算耗尽 → 保守显示 VERIFYING", () => {
    const verifying = contractAt("VERIFYING", APPROVED);
    expect(
      projectContract(verifying, {
        verification: { passed: false, retry_count: 1, max_retries: 3 },
      })?.presentation_state,
    ).toBe("FAILED");
    expect(
      projectContract(verifying, {
        verification: { passed: false, retry_count: 3, max_retries: 3 },
      })?.presentation_state,
    ).toBe("VERIFYING");
  });

  it("AUDITED 四分支：冲突优先于质疑，质疑优先于试玩", () => {
    const audited = contractAt("AUDITED", APPROVED);
    expect(
      projectContract(audited, {
        target_branch_ahead: true,
        dispute_open: true,
      })?.presentation_state,
    ).toBe("CONFLICT");
    expect(
      projectContract(audited, {
        dispute_open: true,
        real_preview_running: true,
      })?.presentation_state,
    ).toBe("DISPUTED_INSPECTING");
    expect(
      projectContract(audited, { real_preview_running: true })
        ?.presentation_state,
    ).toBe("REAL_PLAYTEST");
    expect(
      projectContract(audited, { evidence: { can_merge: true } })
        ?.presentation_state,
    ).toBe("READY_TO_MERGE");
  });

  it("信息不足时不猜状态：AUDITED 无任何判据 → null", () => {
    const audited = contractAt("AUDITED", APPROVED);
    expect(projectContract(audited)).toBeNull();
  });

  it("ABORTED 的两种审批事实都归一到 ABORTED", () => {
    for (const approval of [APPROVED, { status: "REJECTED" as const }]) {
      expect(
        projectContract(contractAt("ABORTED", approval))?.presentation_state,
      ).toBe("ABORTED");
    }
  });

  it("白话文案带合同标题，前端零映射", () => {
    const record0 = projectContract(contractAt("EXECUTING", APPROVED));
    expect(record0?.message).toBe("记账本：正在按计划施工");
    expect(humanMessageFor("MERGED")).toBe("已合入项目");
  });
});

describe("STATE_CHANGED 载荷与证据信号", () => {
  it("载荷字段与持久化记录一一对应", () => {
    const payload = toStateChangedPayload(record());
    expect(payload).toEqual({
      contract_id: "contract_1",
      presentation_state: "EXECUTING",
      message: "记账本：正在按计划施工",
      lifecycle_state: "EXECUTING",
      approval_status: "APPROVED",
      persisted_at: "2026-10-23T10:00:00.000Z",
    });
  });

  it("读取最新证据的 can_merge（文件名倒序取最新）", () => {
    const repo = newRepo();
    const dir = path.join(repo, ".stagent", "evidence");
    fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(
      path.join(dir, "contract_1-evi_100.json"),
      JSON.stringify({ verdict: { can_merge: false } }),
      "utf8",
    );
    fs.writeFileSync(
      path.join(dir, "contract_1-evi_200.json"),
      JSON.stringify({ verdict: { can_merge: true } }),
      "utf8",
    );
    // 别的合同的证据不得串用
    fs.writeFileSync(
      path.join(dir, "contract_2-evi_999.json"),
      JSON.stringify({ verdict: { can_merge: true } }),
      "utf8",
    );

    expect(readLatestEvidenceSignal(repo, "contract_1")).toEqual({
      can_merge: true,
    });
  });

  it("证据缺失或损坏时返回 undefined，由调用方跳过广播", () => {
    const repo = newRepo();
    expect(readLatestEvidenceSignal(repo, "contract_x")).toBeUndefined();

    const dir = path.join(repo, ".stagent", "evidence");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "contract_x-evi_1.json"),
      "not json",
      "utf8",
    );
    expect(readLatestEvidenceSignal(repo, "contract_x")).toBeUndefined();
  });
});
