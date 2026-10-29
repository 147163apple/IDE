import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { createDaemon, StagentDaemon } from "../../daemon/server";
import { safeRmSync } from "../helpers/tmp";
import type { SupervisorProposalV1 } from "../../src/lib/graph/task-graph";
import { TASK_GRAPH_RELATIVE_PATH } from "../../src/lib/graph/task-graph";
import {
  createContractDraft,
  softwareContractSchema,
} from "../../src/lib/contract.schema";
import { ContractStore } from "../../daemon/pipeline/contract-store";

const CONTRACT_ID_HOLDER = { value: "" };

function proposalFor(
  contractId: string,
  targetFile: string,
): SupervisorProposalV1 {
  return {
    schema_version: "1.0",
    contract_id: contractId,
    proposal_id: "prop-scope",
    functional_tree: [{ id: "main", title: "Main", parent_id: null }],
    nodes: [
      {
        node_id: "node-scope",
        title: "Scope Node",
        kind: "CODE_MODIFICATION",
        depends_on: [],
        functional_area: "main",
        target_files: [targetFile],
        verification_mode: "COMMAND",
        verification_commands: [],
      },
    ],
  };
}

describe("OP-25: POST /api/graph/proposal 装载期授权子集校验", () => {
  let tempDir: string;
  let daemon: StagentDaemon | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "stagent-op25-test-"));
    execFileSync("git", ["init", "-b", "main"], {
      cwd: tempDir,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.name", "Tester"], {
      cwd: tempDir,
      stdio: "ignore",
    });
    execFileSync("git", ["config", "user.email", "tester@example.com"], {
      cwd: tempDir,
      stdio: "ignore",
    });
    fs.writeFileSync(path.join(tempDir, "README.md"), "# Test\n");
    execFileSync("git", ["add", "README.md"], {
      cwd: tempDir,
      stdio: "ignore",
    });
    execFileSync("git", ["commit", "-m", "initial commit"], {
      cwd: tempDir,
      stdio: "ignore",
    });

    const draft = createContractDraft({
      title: "OP-25 Scope Contract",
      description: "授权子集装载期校验",
      acceptanceCriteria: ["scope enforced"],
      writablePaths: ["src/**"],
    });
    const parsed = softwareContractSchema.parse({
      ...draft,
      lifecycle_state: "EXECUTING",
      approval: {
        status: "APPROVED",
        approved_at: new Date().toISOString(),
        approved_by: "test-user",
      },
    });
    CONTRACT_ID_HOLDER.value = new ContractStore(tempDir).save(
      parsed,
    ).contract_id;
  });

  afterEach(async () => {
    if (daemon && daemon.isRunning) {
      await daemon.stop();
    }
    daemon = null;
    try {
      safeRmSync(tempDir);
    } catch {
      // ignore
    }
  });

  async function startDaemon() {
    daemon = createDaemon({
      repoRoot: tempDir,
      startPort: 3960,
      endPort: 3969,
    });
    const info = await daemon.start();
    const token = daemon.getSessionToken() ?? "";
    return {
      base: `http://127.0.0.1:${info.port}`,
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
    };
  }

  it("授权子集内的提案正常建图", async () => {
    const { base, headers } = await startDaemon();
    const res = await fetch(`${base}/api/graph/proposal`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        proposal: proposalFor(CONTRACT_ID_HOLDER.value, "src/index.ts"),
      }),
    });
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(tempDir, TASK_GRAPH_RELATIVE_PATH))).toBe(
      true,
    );
  });

  it("超出授权路径：400 + E_SCOPE_VIOLATION，且不落盘", async () => {
    const { base, headers } = await startDaemon();
    const res = await fetch(`${base}/api/graph/proposal`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        proposal: proposalFor(CONTRACT_ID_HOLDER.value, "secrets/key.ts"),
      }),
    });
    const body = (await res.json()) as { code?: string; error?: string };
    expect(res.status).toBe(400);
    expect(body.code).toBe("E_SCOPE_VIOLATION");
    expect(body.error).toContain("secrets/key.ts");
    expect(fs.existsSync(path.join(tempDir, TASK_GRAPH_RELATIVE_PATH))).toBe(
      false,
    );
  });

  it("父合同不存在：400 + E_SCOPE_VIOLATION，且不落盘", async () => {
    const { base, headers } = await startDaemon();
    const res = await fetch(`${base}/api/graph/proposal`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        proposal: proposalFor("contract_missing", "src/index.ts"),
      }),
    });
    const body = (await res.json()) as { code?: string };
    expect(res.status).toBe(400);
    expect(body.code).toBe("E_SCOPE_VIOLATION");
    expect(fs.existsSync(path.join(tempDir, TASK_GRAPH_RELATIVE_PATH))).toBe(
      false,
    );
  });
});
