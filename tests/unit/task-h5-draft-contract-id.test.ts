/**
 * TASK-H.5：最小成功草案 → 非空 contract_id 可回读；打断创建 → 不可签署成功态。
 */
import fs from "node:fs";
import { safeRmSync } from "../helpers/tmp";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContractStore } from "../../daemon/pipeline/contract-store";
import {
  E_DRAFT_CONTRACT_ID_MISSING,
  DraftContractIdError,
  persistJourneyDraft,
  requireDraftContractId,
  journeyDraftSuccessFields,
} from "../../daemon/supervisor/journey/draft-contract-id";
import { orchestrateJourney } from "../../daemon/supervisor/journey/orchestrate";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import type { ContractDraftGenerated } from "../../daemon/supervisor/draft-generator";

const tmpDirs: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-h5-"));
  tmpDirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    try {
      safeRmSync(d);
    } catch {
      /* ignore */
    }
  }
});

function makeDraft(overrides?: { wipeId?: boolean }): ContractDraftGenerated {
  const draft = createContractDraft({
    title: "H5 草案",
    description: "contract_id 不丢",
    acceptanceCriteria: ["ok"],
    writablePaths: ["docs/**"],
    commands: [
      {
        alias: "verify",
        executable: "node",
        args: ["-e", "process.exit(0)"],
        expected_exit_code: 0,
        timeout_seconds: 10,
      },
    ],
  });
  let contract = softwareContractSchema.parse(draft);
  if (overrides?.wipeId) {
    contract = { ...contract, contract_id: "" as unknown as string };
  }
  return {
    generated: true,
    contract,
    plan: {
      title: contract.intent.title,
      description: contract.intent.description,
      acceptance_criteria: [...contract.intent.acceptance_criteria],
      writable_paths: ["docs/**"],
      readonly_paths: [],
      strictly_forbidden_paths: [],
      dirty_exclusions: [],
      commands: [],
      budget: {},
      protected_files: [],
      protected_entry_names: [],
      needs_protection_approval: false,
      unresolved_questions: [],
    },
    rationale: ["test"],
    unresolved_questions: [],
    model_calls: 0,
  };
}

describe("TASK-H.5 draft contract_id", () => {
  it("最小成功草案 → 响应含非空 contract_id 且可读回同 id 合同", async () => {
    const root = tmp();
    const store = new ContractStore(root);
    const draft = makeDraft();
    const persisted = persistJourneyDraft(store, draft);
    expect(persisted.contract_id.length).toBeGreaterThan(0);
    expect(store.get(persisted.contract_id)?.contract_id).toBe(
      persisted.contract_id,
    );

    const result = await orchestrateJourney({
      message: "帮我做一个登录页",
      repoRoot: root,
      contractStore: store,
      runDraft: async () => makeDraft(),
    });
    expect(result.contract_id).toBeTruthy();
    expect(result.code).toBeUndefined();
    expect(journeyDraftSuccessFields(result.contract_id!).contract_id).toBe(
      result.contract_id,
    );
    expect(store.get(result.contract_id!)?.contract_id).toBe(result.contract_id);
  });

  it("故意打断创建（空 id）→ 不得出现无 id 却可签署的成功态", async () => {
    expect(() => requireDraftContractId(makeDraft({ wipeId: true }))).toThrow(
      DraftContractIdError,
    );
    try {
      requireDraftContractId(makeDraft({ wipeId: true }));
    } catch (err) {
      expect(err).toMatchObject({ code: E_DRAFT_CONTRACT_ID_MISSING });
    }

    const root = tmp();
    const store = new ContractStore(root);
    const result = await orchestrateJourney({
      message: "帮我做一个登录页",
      repoRoot: root,
      contractStore: store,
      runDraft: async () => makeDraft({ wipeId: true }),
    });
    expect(result.contract_id).toBeUndefined();
    expect(result.code).toBe(E_DRAFT_CONTRACT_ID_MISSING);
    expect(result.draft).toBeUndefined();
    expect(store.list()).toHaveLength(0);
  });
});
