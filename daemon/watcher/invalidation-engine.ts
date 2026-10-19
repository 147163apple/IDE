import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { evidenceBundleSchema } from "../../src/lib/evidence.schema";
import { writeStateFile } from "../guard/state-store";
import { shouldIgnore } from "./fs-watcher";

/**
 * Evidence 失效引擎（规范 TASK-B.2 PASS-2/3）。
 * Evidence 生成时记录 Worktree 指纹；外部文件新增/修改/删除导致指纹不符时，
 * 立即把 verdict.status 置为 STALE、can_merge=false、reason_code=EVIDENCE_STALE。
 */
export interface RegisteredEvidence {
  contractId: string;
  evidencePath: string;
  fingerprint: string;
}

export interface InvalidationResult {
  contractId: string;
  evidencePath: string;
  stale: boolean;
}

export class EvidenceInvalidationEngine {
  private readonly worktreePath: string;
  private readonly records = new Map<string, RegisteredEvidence>();

  constructor(worktreePath: string) {
    this.worktreePath = path.resolve(worktreePath);
  }

  /** 生成当前 Worktree 指纹（排序后的 路径 + 内容哈希） */
  computeFingerprint(): string {
    const hash = createHash("sha256");
    for (const rel of this.listFiles()) {
      const abs = path.join(this.worktreePath, rel);
      let content: Buffer;
      try {
        content = fs.readFileSync(abs);
      } catch {
        continue;
      }
      hash.update(rel);
      hash.update(createHash("sha256").update(content).digest("hex"));
    }
    return hash.digest("hex");
  }

  register(contractId: string, evidencePath: string): RegisteredEvidence {
    const record: RegisteredEvidence = {
      contractId,
      evidencePath: path.resolve(evidencePath),
      fingerprint: this.computeFingerprint(),
    };
    this.records.set(contractId, record);
    return record;
  }

  /** 未注册时按需登记（便于从磁盘证据恢复） */
  ensureRegistered(
    contractId: string,
    evidencePath: string,
  ): RegisteredEvidence {
    return (
      this.records.get(contractId) ?? this.register(contractId, evidencePath)
    );
  }

  /**
   * 处理一批变更：任何已登记 Evidence 的指纹发生变化 → 标记 STALE。
   * 返回所有被检查的登记项（stale 表示本次是否失效）。
   */
  handleChanges(changedPaths: string[]): InvalidationResult[] {
    if (changedPaths.length === 0) return [];
    const results: InvalidationResult[] = [];
    const current = this.computeFingerprint();

    for (const record of this.records.values()) {
      const stale = current !== record.fingerprint;
      if (stale) {
        this.markStale(record);
        record.fingerprint = current;
      }
      results.push({
        contractId: record.contractId,
        evidencePath: record.evidencePath,
        stale,
      });
    }
    return results;
  }

  /** 将证据文件原子改写为 STALE（保持 §9.2 Schema 合法） */
  markStale(record: RegisteredEvidence): void {
    if (!fs.existsSync(record.evidencePath)) return;
    const raw = JSON.parse(
      fs.readFileSync(record.evidencePath, "utf-8"),
    ) as Record<string, unknown>;
    const verdict = (raw["verdict"] ?? {}) as Record<string, unknown>;

    const updated = evidenceBundleSchema.parse({
      ...raw,
      verdict: {
        ...verdict,
        status: "STALE",
        can_merge: false,
        reason_code: "EVIDENCE_STALE",
        summary: `Evidence invalidated: worktree changed after verification (${new Date().toISOString()})`,
      },
    });

    writeStateFile(record.evidencePath, updated);
  }

  private listFiles(): string[] {
    const files: string[] = [];
    const walk = (dir: string): void => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const abs = path.join(dir, entry.name);
        if (shouldIgnore(abs, this.worktreePath)) continue;
        if (entry.isDirectory()) walk(abs);
        else if (entry.isFile())
          files.push(path.relative(this.worktreePath, abs));
      }
    };
    walk(this.worktreePath);
    return files.sort();
  }
}
