/**
 * TASK-J.2 / SSOT §15.3：范围预检 `ScopePlan` 的类型与纯函数（前后端共享，零 fs）。
 *
 * 这里只放**确定性、无副作用**的东西：
 * - 类型（与 SSOT §15.3 的 interface 一一对应）；
 * - `scopePlanDigest`：规范化摘要（键排序、无空白、不含 `plan_digest` 自身）；
 * - `applyScopeDecisions`：用户排除区域 / 敏感项表态 → 新 plan（重算 digest）；
 * - `scopePlanToContractScope`：plan → 合同的 writable / forbidden / verification / budget。
 *
 * 读仓库、读保护清单、读 package.json 的活都在
 * `daemon/supervisor/scope-plan-builder.ts`，不要放进本文件。
 */

import type { BudgetLimits, VerificationCommand } from "../contract.schema";
import { stableStringify } from "../stable-stringify";

export interface ScopeArea {
  id: string;
  /** 白话区域名，不含 glob / 技术单位 */
  label: string;
  /** 为什么改这里（来自哪个模块） */
  why: string;
  module_ids: string[];
  kind: "change_existing" | "create_new";
  /** 背后的真实路径 / 模块级通配，默认折叠展示 */
  paths: string[];
  /** 用户点过「不要改这里」 */
  excluded_by_user: boolean;
}

export interface ScopeNeverTouch {
  label: string;
  paths: string[];
}

export interface ScopeApprovalItem {
  id: string;
  label: string;
  why: string;
  paths: string[];
  /** null = 还没表态（未表态即不得签署） */
  approved: boolean | null;
}

export interface ScopeVerification {
  /** 真实命令（来自项目 scripts；没有则为空） */
  commands: VerificationCommand[];
  /** 白话说人话的验收项 */
  plain: string[];
  /** 项目没有任何自动检查 → 完成后靠用户试玩确认 */
  manual_only: boolean;
}

export interface ScopeBudget {
  limits: BudgetLimits;
  /** 「最多改约 10 个文件，预计 15～30 分钟」 */
  plain: string;
}

export interface ScopeGrade {
  ok: boolean;
  rejected: { path: string; kind: string }[];
}

export interface ScopePlan {
  /** 绑定的方案修订；方案一变即作废重算 */
  scheme_revision: number;
  /** 本对象的规范化摘要，写进冻结快照与合同 */
  plan_digest: string;
  areas: ScopeArea[];
  never_touch: ScopeNeverTouch[];
  needs_approval: ScopeApprovalItem[];
  verification: ScopeVerification;
  budget: ScopeBudget;
  grade: ScopeGrade;
}

export interface ScopeApprovalDecision {
  id: string;
  approved: boolean;
}

/** 用户在《改动范围与验收方式》里做的两类表态 */
export interface ScopePlanDecisions {
  excluded_area_ids?: readonly string[] | undefined;
  approvals?: readonly ScopeApprovalDecision[] | undefined;
}

/** `ScopePlan` → 合同范围四件套（J.4/J.5 共用同一出口） */
export interface ContractScopeFromPlan {
  writable_paths: string[];
  forbidden_paths: string[];
  verification_spec: { commands: VerificationCommand[] };
  budget: BudgetLimits;
  /** 没有自动检查 → 合同按人工验收（MANUAL_REVIEW）处理 */
  manual_only: boolean;
}

// --- 规范化摘要 -------------------------------------------------------------

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;

/**
 * 纯 TS 的 SHA-256（浏览器与 Node 同一实现，不引 `node:crypto`）。
 * 只用于摘要字符串，不承载任何密码学用途。
 */
function sha256Hex(input: string): string {
  const message = new TextEncoder().encode(input);
  const blocks = (((message.length + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(blocks);
  padded.set(message);
  padded[message.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLen = message.length * 8;
  view.setUint32(padded.length - 8, Math.floor(bitLen / 0x1_0000_0000), false);
  view.setUint32(padded.length - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15]!;
      const y = w[i - 2]!;
      const s0 = (rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3)) >>> 0;
      const s1 = (rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10)) >>> 0;
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + SHA256_K[i]! + w[i]!) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => x.toString(16).padStart(8, "0"))
    .join("");
}

/**
 * `ScopePlan` 的规范化摘要。
 *
 * - 键排序（`stableStringify`）→ 同内容必得同 digest（SSOT S2-04）；
 * - 摘要**不含 `plan_digest` 自身**，避免自引用；
 * - plan 内没有时间戳字段，无需剔除。
 */
export function scopePlanDigest(plan: ScopePlan): string {
  const { plan_digest: _ignored, ...payload } = plan;
  return sha256Hex(stableStringify(payload));
}

// --- 用户表态 ---------------------------------------------------------------

/**
 * 用户对范围内区域 / 敏感项的表态 → 新 plan（重算 digest）。
 *
 * 语义刻意做成「只改被点名的项」：
 * - `excluded_area_ids` 里的区域置 `excluded_by_user = true`；
 * - `approvals` 里的敏感项写入 approved（true/false），未点名的保持 null；
 * - 两次相同输入必得同一 digest（幂等）。
 */
export function applyScopeDecisions(
  plan: ScopePlan,
  decisions: ScopePlanDecisions = {},
): ScopePlan {
  const excluded = new Set(decisions.excluded_area_ids ?? []);
  const approvals = new Map(
    (decisions.approvals ?? []).map((entry) => [entry.id, entry.approved]),
  );
  const next: ScopePlan = {
    ...plan,
    areas: plan.areas.map((area) =>
      excluded.has(area.id) ? { ...area, excluded_by_user: true } : area,
    ),
    needs_approval: plan.needs_approval.map((item) =>
      approvals.has(item.id)
        ? { ...item, approved: approvals.get(item.id) === true }
        : item,
    ),
    plan_digest: "",
  };
  return { ...next, plan_digest: scopePlanDigest(next) };
}

// --- 合同范围 ---------------------------------------------------------------

function dedupe(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

/**
 * plan → 合同范围。
 *
 * 判定顺序（失败关闭）：
 * 1. 用户排除的区域不写入 writable；
 * 2. 未获批（null）或明确拒绝（false）的敏感路径进 forbidden，不进 writable；
 * 3. `never_touch` 一律进 forbidden，且 forbidden 优先于 writable（同一路径两处出现时以禁写为准）。
 */
export function scopePlanToContractScope(
  plan: ScopePlan,
): ContractScopeFromPlan {
  const approvedPaths = new Set<string>();
  const blockedPaths = new Set<string>();
  for (const item of plan.needs_approval) {
    for (const p of item.paths) {
      if (item.approved === true) approvedPaths.add(p);
      else blockedPaths.add(p);
    }
  }

  const writable: string[] = [];
  for (const area of plan.areas) {
    if (area.excluded_by_user) continue;
    for (const p of area.paths) {
      if (blockedPaths.has(p) && !approvedPaths.has(p)) continue;
      writable.push(p);
    }
  }
  for (const p of approvedPaths) writable.push(p);

  const forbidden = dedupe([
    ...plan.never_touch.flatMap((group) => group.paths),
    ...[...blockedPaths].filter((p) => !approvedPaths.has(p)),
  ]);
  const forbiddenSet = new Set(forbidden);

  return {
    writable_paths: dedupe(writable).filter((p) => !forbiddenSet.has(p)),
    forbidden_paths: forbidden,
    verification_spec: {
      commands: plan.verification.commands.map((cmd) => ({
        ...cmd,
        args: [...cmd.args],
      })),
    },
    budget: { ...plan.budget.limits },
    manual_only: plan.verification.manual_only,
  };
}
