/**
 * TASK-C.15b / EO-08：ReworkCounter 落盘与编排辅助。
 * 路径：`.stagent/guard/<contractId>/rework-counter.json`
 * Worker/LLM 只读；写入仅 Daemon（本模块 + orchestrator）。
 */
import fs from "node:fs";
import path from "node:path";
import {
  ReworkCounter,
  assertionIdFromText,
  type ReworkCounterSnapshot,
} from "./assertion-identity";
import { assertSafeContractId } from "./gateway-violation-store";

export const REWORK_COUNTER_FILENAME = "rework-counter.json" as const;

function reworkDir(repoRoot: string, contractId: string): string {
  assertSafeContractId(contractId);
  const base = path.resolve(repoRoot, ".stagent", "guard");
  const dir = path.resolve(base, contractId);
  if (dir === base || !dir.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Rework path escapes guard root: ${contractId}`);
  }
  return dir;
}

export function reworkCounterPath(repoRoot: string, contractId: string): string {
  return path.join(reworkDir(repoRoot, contractId), REWORK_COUNTER_FILENAME);
}

export function loadReworkCounter(
  repoRoot: string,
  contractId: string,
): ReworkCounter | null {
  const target = reworkCounterPath(repoRoot, contractId);
  if (!fs.existsSync(target)) return null;
  try {
    const raw = JSON.parse(
      fs.readFileSync(target, "utf8"),
    ) as ReworkCounterSnapshot;
    if (raw.contract_id !== contractId) return null;
    return ReworkCounter.fromSnapshot(raw);
  } catch {
    return null;
  }
}

export function saveReworkCounter(
  repoRoot: string,
  counter: ReworkCounter,
): ReworkCounterSnapshot {
  const dir = reworkDir(repoRoot, counter.contract_id);
  fs.mkdirSync(dir, { recursive: true });
  const snap = counter.snapshot();
  const target = reworkCounterPath(repoRoot, counter.contract_id);
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(snap, null, 2), "utf8");
    fs.renameSync(tmp, target);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
  return snap;
}

/**
 * 签署时冻结验收断言集合。已有计数器则只补注册缺失文本（不清零）。
 */
export function seedReworkCounterFromAcceptance(
  repoRoot: string,
  contractId: string,
  acceptanceCriteria: readonly string[],
): ReworkCounterSnapshot {
  let counter = loadReworkCounter(repoRoot, contractId);
  if (!counter) {
    counter = new ReworkCounter(contractId);
  }
  // 返工期禁止 register——若已 rework/escalated，仅返回快照
  if (counter.currentPhase === "normal") {
    counter.registerAssertions(acceptanceCriteria);
  }
  return saveReworkCounter(repoRoot, counter);
}

export type SplitFlowResult =
  | {
      kind: "rework_existing";
      assertion_id: string;
      snapshot: ReworkCounterSnapshot;
    }
  | {
      kind: "out_of_scope";
      reason: string;
      code: "E_ASSERTION_OUT_OF_SCOPE";
    }
  | {
      kind: "registered_new";
      assertion_id: string;
      snapshot: ReworkCounterSnapshot;
    };

/**
 * EO-08 拆流钩子：同句「老 Bug + 新需求」时，
 * - 文本已注册 → 记一次失败（老断言 +1）
 * - 返工期新文本 → Out-of-Scope（须新微合同）
 * - normal 期新文本 → 注册（非返工追加）
 */
export function splitAssertionRequest(
  repoRoot: string,
  contractId: string,
  assertionText: string,
): SplitFlowResult {
  let counter = loadReworkCounter(repoRoot, contractId);
  if (!counter) {
    counter = new ReworkCounter(contractId);
  }
  const id = assertionIdFromText(assertionText);
  const known = Object.prototype.hasOwnProperty.call(
    counter.snapshot().counts,
    id,
  );
  if (known) {
    const snapshot = counter.recordFailure(id);
    saveReworkCounter(repoRoot, counter);
    return { kind: "rework_existing", assertion_id: id, snapshot };
  }
  if (
    counter.currentPhase === "rework" ||
    counter.currentPhase === "escalated"
  ) {
    return {
      kind: "out_of_scope",
      reason: "返工期新验收诉求须合同修订或新微合同（EO-08）",
      code: "E_ASSERTION_OUT_OF_SCOPE",
    };
  }
  const assertion_id = counter.tryAddAssertion(assertionText);
  const snapshot = saveReworkCounter(repoRoot, counter);
  return { kind: "registered_new", assertion_id, snapshot };
}

/**
 * 一轮验证 FAILED：对每个已注册断言 +1；任一超限 → escalated。
 * 返回更新后快照（调用方据 phase 决定 PENDING_RESUME / 吊销 token）。
 */
export function recordVerificationRoundFailure(
  repoRoot: string,
  contractId: string,
  acceptanceCriteria: readonly string[],
): ReworkCounterSnapshot {
  let counter = loadReworkCounter(repoRoot, contractId);
  if (!counter) {
    counter = new ReworkCounter(contractId);
  }
  // 必须先在 normal 期冻结断言，再进入 rework 计数
  if (counter.currentPhase === "normal") {
    counter.registerAssertions(acceptanceCriteria);
  }
  const ids = Object.keys(counter.snapshot().counts);
  counter.enterRework();
  let snap = counter.snapshot();
  for (const id of ids) {
    snap = counter.recordFailure(id);
  }
  return saveReworkCounter(repoRoot, counter);
}
