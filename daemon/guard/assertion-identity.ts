/**
 * TASK-C.15b / EO-08：验收断言不可变身份 + Daemon 权威返工计数。
 * - assertion_id = UUIDv5(namespace, assertion_text)
 * - 返工计数只读对 LLM/Worker；超限 → ESCALATED_HUMAN
 * - REWORK_REQUIRED 期间禁止追加新断言
 */
import { createHash } from "node:crypto";

/** RFC 4122 DNS namespace UUID（固定；与合同无关的全局命名空间） */
export const ASSERTION_NAMESPACE_UUID =
  "6ba7b810-9dad-11d1-80b4-00c04fd430c8" as const;

export const MAX_REWORK_COUNT = 2 as const;

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, "");
  return Buffer.from(hex, "hex");
}

/**
 * 纯函数 UUIDv5（SHA-1）。确定性：同 namespace + 同文本 → 同 id。
 */
export function assertionIdFromText(
  assertionText: string,
  namespace: string = ASSERTION_NAMESPACE_UUID,
): string {
  const ns = uuidToBytes(namespace);
  const name = Buffer.from(assertionText.normalize("NFC"), "utf8");
  const hash = createHash("sha1").update(ns).update(name).digest();
  // RFC 4122 variant/version bits
  hash[6] = (hash[6]! & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8]! & 0x3f) | 0x80; // variant
  const h = hash.subarray(0, 16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export type ReworkPhase = "normal" | "rework" | "escalated";

export interface ReworkCounterSnapshot {
  contract_id: string;
  counts: Record<string, number>;
  phase: ReworkPhase;
  max_rework: typeof MAX_REWORK_COUNT;
}

/**
 * Daemon 权威返工计数器（内存；可序列化进 records）。
 * LLM/Worker 不得直接改写 counts。
 */
export class ReworkCounter {
  readonly contract_id: string;
  private counts = new Map<string, number>();
  private phase: ReworkPhase = "normal";
  private knownIds = new Set<string>();

  constructor(contract_id: string) {
    this.contract_id = contract_id;
  }

  /** 注册合同初始断言集合（签署时冻结） */
  registerAssertions(texts: readonly string[]): string[] {
    if (this.phase === "rework" || this.phase === "escalated") {
      const err = new Error(
        "REWORK/ESCALATED 期间禁止注册或追加新断言（EO-08）",
      ) as Error & { code: string };
      err.code = "E_ASSERTION_ADD_FORBIDDEN";
      throw err;
    }
    const ids: string[] = [];
    for (const text of texts) {
      const id = assertionIdFromText(text);
      this.knownIds.add(id);
      if (!this.counts.has(id)) this.counts.set(id, 0);
      ids.push(id);
    }
    return ids;
  }

  /** 尝试追加新断言文本——返工期必拒 */
  tryAddAssertion(text: string): string {
    if (this.phase === "rework" || this.phase === "escalated") {
      const err = new Error(
        "返工期严禁追加新验收断言；须合同修订或新微合同（EO-08）",
      ) as Error & { code: string };
      err.code = "E_ASSERTION_ADD_FORBIDDEN";
      throw err;
    }
    const id = assertionIdFromText(text);
    this.knownIds.add(id);
    if (!this.counts.has(id)) this.counts.set(id, 0);
    return id;
  }

  enterRework(): void {
    if (this.phase === "escalated") return;
    this.phase = "rework";
  }

  /**
   * 对既有 assertion_id 计 +1。未知 id（自编）拒绝。
   * 任一断言达到 MAX → escalated。
   */
  recordFailure(assertion_id: string): ReworkCounterSnapshot {
    if (!this.knownIds.has(assertion_id) && !this.counts.has(assertion_id)) {
      const err = new Error(
        `未知 assertion_id，禁止自编逃避计数（EO-08）: ${assertion_id}`,
      ) as Error & { code: string };
      err.code = "E_ASSERTION_ID_UNKNOWN";
      throw err;
    }
    const next = (this.counts.get(assertion_id) ?? 0) + 1;
    this.counts.set(assertion_id, next);
    this.phase = "rework";
    if (next > MAX_REWORK_COUNT) {
      this.phase = "escalated";
    }
    return this.snapshot();
  }

  get isEscalated(): boolean {
    return this.phase === "escalated";
  }

  get currentPhase(): ReworkPhase {
    return this.phase;
  }

  snapshot(): ReworkCounterSnapshot {
    const counts: Record<string, number> = {};
    for (const [k, v] of this.counts) counts[k] = v;
    return {
      contract_id: this.contract_id,
      counts,
      phase: this.phase,
      max_rework: MAX_REWORK_COUNT,
    };
  }

  static fromSnapshot(snap: ReworkCounterSnapshot): ReworkCounter {
    const c = new ReworkCounter(snap.contract_id);
    for (const [id, n] of Object.entries(snap.counts)) {
      c.counts.set(id, n);
      c.knownIds.add(id);
    }
    c.phase = snap.phase;
    return c;
  }
}
