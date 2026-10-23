import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContractDraft } from "../../src/lib/contract.schema";
import {
  E_SPEC_SNAPSHOT_CORRUPT,
  E_SPEC_SNAPSHOT_IMMUTABLE,
  REQUIREMENTS_FILE_REL,
  RequirementsStore,
  renderRequirementsMarkdown,
} from "../../daemon/supervisor/specs/requirements-store";

/**
 * TASK-S.5 第 0 步门禁：需求规范快照。
 *
 * 覆盖四条红线：
 * 1. 文件缺失时从合同意图初始化，内容是确定性的；
 * 2. 重复 ensure 幂等，不产生噪音版本；
 * 3. 执行期锁定后普通写入被拒绝；
 * 4. 旧快照永不覆写，篡改会被 SHA-256 抓住。
 */

let repoRoot: string;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-s5-spec-"));
});

afterEach(() => {
  try {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  } catch {
    // 宿主批量删除保护可能拦截；临时目录交给系统回收
  }
});

function makeContract(title = "订单满减") {
  return createContractDraft({
    title,
    description: "订单页支持满 100 减 20，优惠金额在结算前可见。",
    acceptanceCriteria: [
      "订单金额满 100 元时自动减 20 元",
      "优惠金额在订单页可见",
    ],
    writablePaths: ["src/**"],
    commands: [
      {
        alias: "test",
        executable: "npm",
        args: ["test"],
        expected_exit_code: 0,
        timeout_seconds: 60,
      },
    ],
  });
}

function fixedClock(iso = "2026-10-23T08:00:00.000Z") {
  return () => new Date(iso);
}

describe("初始化：从 contract.intent 生成权威快照", () => {
  it("文件不存在时落盘 requirements.md 并冻结 v1", () => {
    const contract = makeContract();
    const store = new RequirementsStore(repoRoot, { clock: fixedClock() });
    const baseline = store.ensureBaseline(contract);

    const file = path.join(repoRoot, REQUIREMENTS_FILE_REL);
    expect(fs.existsSync(file)).toBe(true);
    const content = fs.readFileSync(file, "utf-8");
    expect(content).toContain("# 订单满减");
    expect(content).toContain("- 订单金额满 100 元时自动减 20 元");
    expect(content).toContain("- 优惠金额在订单页可见");
    expect(content).toContain("## 验收标准");

    expect(baseline.snapshot.version).toBe(1);
    expect(baseline.snapshot.source).toBe("INITIALIZED_FROM_CONTRACT");
    expect(baseline.snapshot.immutable).toBe(true);
    expect(baseline.snapshot.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(baseline.content).toBe(content);
    expect(store.isLocked(contract.contract_id)).toBe(true);
  });

  it("渲染是确定性的：同一 intent 两次结果完全一致", () => {
    const contract = makeContract();
    expect(renderRequirementsMarkdown(contract)).toBe(
      renderRequirementsMarkdown(contract),
    );
  });

  it("已存在的用户规范被原样冻结，不被合同意图覆盖", () => {
    const contract = makeContract();
    const file = path.join(repoRoot, REQUIREMENTS_FILE_REL);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const manual = "# 手工规范\n\n## 验收标准\n- 用户自己写的条目\n";
    fs.writeFileSync(file, manual);

    const store = new RequirementsStore(repoRoot, { clock: fixedClock() });
    const baseline = store.ensureBaseline(contract);

    expect(baseline.content).toBe(manual);
    expect(baseline.snapshot.source).toBe("USER_EDIT");
    expect(fs.readFileSync(file, "utf-8")).toBe(manual);
  });

  it("重复 ensure 幂等：不产生多余版本", () => {
    const contract = makeContract();
    const store = new RequirementsStore(repoRoot, { clock: fixedClock() });
    const first = store.ensureBaseline(contract);
    const second = store.ensureBaseline(contract);

    expect(second.snapshot.snapshot_id).toBe(first.snapshot.snapshot_id);
    expect(store.listSnapshots(contract.contract_id)).toHaveLength(1);
  });
});

describe("执行期不可变性", () => {
  it("锁定后普通写入被拒绝，权威文件保持不变", () => {
    const contract = makeContract();
    const store = new RequirementsStore(repoRoot, { clock: fixedClock() });
    const baseline = store.ensureBaseline(contract);
    const before = fs.readFileSync(
      path.join(repoRoot, REQUIREMENTS_FILE_REL),
      "utf-8",
    );

    let caught: unknown;
    try {
      store.writeSnapshot({
        contract,
        content: "# 被偷偷改掉的规范\n",
        source: "USER_EDIT",
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toMatchObject({ code: E_SPEC_SNAPSHOT_IMMUTABLE });
    expect(
      fs.readFileSync(path.join(repoRoot, REQUIREMENTS_FILE_REL), "utf-8"),
    ).toBe(before);
    expect(store.listSnapshots(contract.contract_id)).toHaveLength(1);
    expect(store.getBaseline(contract.contract_id)?.snapshot.snapshot_id).toBe(
      baseline.snapshot.snapshot_id,
    );
  });

  it("携带 change_request_id 的正式变更生成 v2，新基准生效且 v1 原样保留", () => {
    const contract = makeContract();
    const store = new RequirementsStore(repoRoot, { clock: fixedClock() });
    const v1 = store.ensureBaseline(contract).snapshot;

    const nextContent = "# 订单满减（变更）\n\n## 验收标准\n- 满 200 减 50\n";
    const v2 = store.writeSnapshot({
      contract,
      content: nextContent,
      source: "CHANGE_REQUEST",
      changeRequestId: "cr_20261023_abcd1234",
    });

    expect(v2.version).toBe(2);
    expect(v2.change_request_id).toBe("cr_20261023_abcd1234");
    expect(store.getBaseline(contract.contract_id)?.snapshot.snapshot_id).toBe(
      v2.snapshot_id,
    );
    // 权威文件已更新，但 v1 快照文件仍是旧内容
    expect(
      fs.readFileSync(path.join(repoRoot, REQUIREMENTS_FILE_REL), "utf-8"),
    ).toBe(nextContent);
    expect(store.readSnapshotContent(v1)).toContain("满 100 元时自动减 20 元");
    expect(v1.sha256).not.toBe(v2.sha256);
  });

  it("篡改快照文件会被 SHA-256 完整性校验抓住", () => {
    const contract = makeContract();
    const store = new RequirementsStore(repoRoot, { clock: fixedClock() });
    const baseline = store.ensureBaseline(contract);

    const snapshotFile = path.join(repoRoot, baseline.snapshot.file);
    fs.appendFileSync(snapshotFile, "\n- 偷偷追加的条目\n");

    let caught: unknown;
    try {
      store.readSnapshotContent(baseline.snapshot);
    } catch (err) {
      caught = err;
    }
    expect(caught).toMatchObject({ code: E_SPEC_SNAPSHOT_CORRUPT });

    expect(() => store.getBaseline(contract.contract_id)).toThrowError(
      /SHA-256/,
    );
  });
});
