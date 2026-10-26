/**
 * TASK-H.5：旅程草案成功路径必须带回可解析非空 contract_id，并与落盘合同一致。
 * 失败 → 显式错误，禁止静默丢 id 后假装进入签署流。
 */
import type { ContractStore } from "../../pipeline/contract-store";
import type { ContractDraftGenerated } from "../draft-generator";
import type { SoftwareContract } from "../../../src/lib/contract.schema";

export const E_DRAFT_CONTRACT_ID_MISSING = "E_DRAFT_CONTRACT_ID_MISSING" as const;
export const E_DRAFT_CONTRACT_ID_MISMATCH = "E_DRAFT_CONTRACT_ID_MISMATCH" as const;

export class DraftContractIdError extends Error {
  readonly code: typeof E_DRAFT_CONTRACT_ID_MISSING | typeof E_DRAFT_CONTRACT_ID_MISMATCH;
  constructor(
    code: typeof E_DRAFT_CONTRACT_ID_MISSING | typeof E_DRAFT_CONTRACT_ID_MISMATCH,
    message: string,
  ) {
    super(message);
    this.name = "DraftContractIdError";
    this.code = code;
  }
}

/** 从草案取出非空 contract_id；否则显式失败 */
export function requireDraftContractId(
  draft: ContractDraftGenerated | null | undefined,
): string {
  const id =
    typeof draft?.contract?.contract_id === "string"
      ? draft.contract.contract_id.trim()
      : "";
  if (!id) {
    throw new DraftContractIdError(
      E_DRAFT_CONTRACT_ID_MISSING,
      "草案创建未带回合同编号（contract_id）。请重试出草案；当前不能进入签署。",
    );
  }
  return id;
}

/**
 * 落盘草案并回读校验 id 一致。
 * 返回 { contract_id, contract }。
 */
export function persistJourneyDraft(
  store: ContractStore,
  draft: ContractDraftGenerated,
): { contract_id: string; contract: SoftwareContract } {
  const contract_id = requireDraftContractId(draft);
  const saved = store.save(draft.contract);
  if (saved.contract_id !== contract_id) {
    throw new DraftContractIdError(
      E_DRAFT_CONTRACT_ID_MISMATCH,
      `落盘合同编号与草案不一致（草案 ${contract_id} / 落盘 ${saved.contract_id}）。请勿签署，请重新出草案。`,
    );
  }
  const loaded = store.get(contract_id);
  if (!loaded || loaded.contract_id !== contract_id) {
    throw new DraftContractIdError(
      E_DRAFT_CONTRACT_ID_MISSING,
      "草案已生成但未能读回合同编号。请重试；当前不能进入签署。",
    );
  }
  return { contract_id, contract: loaded };
}

/** 成功响应投影：顶层必有 contract_id */
export function journeyDraftSuccessFields(contract_id: string): {
  contract_id: string;
} {
  return { contract_id };
}
