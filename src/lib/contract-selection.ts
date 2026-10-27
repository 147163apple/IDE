/**
 * 控制台合同默认选中：刷新后 selectedId 为空时，避免「合同审阅」空态误导。
 * 仅在「只有一份」或「已有明确交付/施工中」时自动选，不抢多份草稿的注意力。
 */
export type ContractSelectionInput = {
  contract_id: string;
  lifecycle_state: string;
  updated_at?: string | undefined;
  created_at?: string | undefined;
};

function rankLifecycle(state: string): number {
  if (state === "MERGED" || state === "AUDITED") return 0;
  if (state === "EXECUTING" || state === "VERIFYING" || state === "REPAIRING")
    return 1;
  if (state === "PENDING_APPROVAL") return 2;
  return 3;
}

function stamp(c: ContractSelectionInput): string {
  return c.updated_at ?? c.created_at ?? "";
}

export function pickDefaultContractId(
  contracts: readonly ContractSelectionInput[],
  currentId: string | null,
): string | null {
  if (currentId && contracts.some((c) => c.contract_id === currentId)) {
    return currentId;
  }
  if (contracts.length === 0) return null;
  if (contracts.length === 1) return contracts[0]!.contract_id;

  const sorted = [...contracts].sort((a, b) => {
    const rd =
      rankLifecycle(a.lifecycle_state) - rankLifecycle(b.lifecycle_state);
    if (rd !== 0) return rd;
    return stamp(b).localeCompare(stamp(a));
  });
  const top = sorted[0]!;
  // 多份合同时：只自动跳到已交付或施工中，避免误选草稿
  if (rankLifecycle(top.lifecycle_state) <= 1) return top.contract_id;
  return null;
}

/** 合入/已审计合同：真机试玩优先挂业务 Vite（常见本机端口），不要只起白话桩。 */
export const MERGED_PRODUCT_PREVIEW_URLS = [
  "http://127.0.0.1:5180/",
  "http://127.0.0.1:5173/",
] as const;

export function isDeliveredLifecycle(
  state: string | null | undefined,
): boolean {
  return state === "MERGED" || state === "AUDITED";
}
