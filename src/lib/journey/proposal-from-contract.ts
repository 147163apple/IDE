/**
 * 从已落盘/内存中的合同拼一份「全灰」Supervisor 提案（TASK-S.6）。
 *
 * 用途：用户点【确认原型并实施真实工程】后，前端/Daemon 调
 * `POST /api/graph/proposal` 建图。节点一律不含运行态；Daemon
 * `createFromProposal` 会把它们初始化为 PENDING（全灰）。
 *
 * 拆解策略刻意保守、确定性：
 * - 一个根功能区 = 合同标题
 * - 每个可写路径（或验收标准）对应一个 CODE_MODIFICATION 节点
 * - 验证命令优先用合同里已声明的 alias；否则挂一条占位 `verify`
 *   （空验证集会被 illumination 挡住，不会假绿）
 */

import type { SoftwareContract } from "../contract.schema";
import type {
  SupervisorProposalNode,
  SupervisorProposalV1,
} from "../graph/task-graph";

export interface BuildProposalOptions {
  /** 注入时钟，便于测试 */
  now?: () => Date;
  /** 覆盖 proposal_id（默认带时间戳） */
  proposalId?: string;
}

function slugify(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * 把合同编成可提交给 Graph 引擎的提案。
 * 调用方负责再调 `createTaskGraph`；本函数不做 IO。
 */
export function buildProposalFromContract(
  contract: SoftwareContract,
  options: BuildProposalOptions = {},
): SupervisorProposalV1 {
  const now = options.now?.() ?? new Date();
  const areaId = `area-${slugify(contract.intent.title, "main")}`;
  const writable = contract.authorization.file_system_scope.writable_paths;
  const criteria = contract.intent.acceptance_criteria;
  const declaredCommands = contract.verification_spec?.commands ?? [];
  const commandAliases = declaredCommands
    .map((c) => c.alias)
    .filter((a): a is string => typeof a === "string" && a.length > 0);
  const isManualOnly = declaredCommands.length === 0;

  const targets: Array<{ title: string; files: string[] }> = [];
  if (writable.length > 0) {
    for (const file of writable.slice(0, 12)) {
      targets.push({
        title: `落实：${file}`,
        files: [file],
      });
    }
  } else if (criteria.length > 0) {
    for (const [index, item] of criteria.slice(0, 8).entries()) {
      targets.push({
        title: item.slice(0, 80),
        files: [`src/feature/step-${index + 1}.ts`],
      });
    }
  } else {
    targets.push({
      title: contract.intent.title || "实施本轮需求",
      files: ["src/app/main.ts"],
    });
  }

  const nodes: SupervisorProposalNode[] = targets.map((target, index) => {
    const prev = index === 0 ? [] : [`n${index}`];
    if (isManualOnly) {
      // G4 守卫条款（对齐架构 §6.4 D-5 与 N-⑦ 裁决）：
      // commands 为空时，生成 MANUAL_REVIEW 节点（verification_mode: "MANUAL"），
      // 不挂占位 verify 命令，由用户在 UI 上显式确认。
      return {
        node_id: `n${index + 1}`,
        title: target.title,
        kind: "MANUAL_REVIEW",
        depends_on: prev,
        functional_area: areaId,
        target_files: target.files,
        verification_mode: "MANUAL",
        verification_commands: [],
      };
    }

    return {
      node_id: `n${index + 1}`,
      title: target.title,
      kind: "CODE_MODIFICATION",
      depends_on: prev,
      functional_area: areaId,
      target_files: target.files,
      verification_mode: "COMMAND",
      verification_commands:
        commandAliases.length > 0 ? [...commandAliases] : ["verify"],
    };
  });

  return {
    schema_version: "1.0",
    proposal_id:
      options.proposalId ?? `proposal_${contract.contract_id}_${now.getTime()}`,
    contract_id: contract.contract_id,
    generated_at: now.toISOString(),
    functional_tree: [
      {
        id: areaId,
        title: contract.intent.title || "本轮功能",
        parent_id: null,
        description: contract.intent.description.slice(0, 240),
      },
    ],
    nodes,
  };
}
