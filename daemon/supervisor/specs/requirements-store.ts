import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { writeJsonAtomic } from "../../../src/lib/state-machine";
import type { SoftwareContract } from "../../../src/lib/contract.schema";

/**
 * 需求规范快照存储（TASK-S.5 第 0 步）。
 *
 * 为什么需要它：质疑自查的三方事实里「Spec」必须是**真实物理文件**，
 * 不能是模型复述、也不能是前端内存里的字符串。本模块把
 * `.stagent/specs/requirements.md` 变成 Daemon 受控、可追溯、执行期不可变的
 * 权威基准：
 *
 * 1. **唯一权威文件**：`.stagent/specs/requirements.md`；
 * 2. **版本快照**：每次变更在 `requirements.snapshots/<contract>/vN-<sha8>.md`
 *    留一份冻结副本，旧版本**永不覆写**；
 * 3. **执行期锁定**：合同一旦锁定，普通写入抛 `E_SPEC_SNAPSHOT_IMMUTABLE`；
 *    只有携带 `change_request_id` 的正式需求变更才能产生新版本；
 * 4. **完整性校验**：读取基准时重算 SHA-256，被外部编辑器改过即抛
 *    `E_SPEC_SNAPSHOT_CORRUPT`，绝不拿被篡改的规范去做归因。
 *
 * 初始化策略：文件不存在时从 `contract.intent`（title / description /
 * acceptance_criteria）渲染一份确定性 Markdown，再冻结为 v1。
 */

export const REQUIREMENTS_FILE_REL = ".stagent/specs/requirements.md";
export const REQUIREMENTS_INDEX_REL =
  ".stagent/specs/requirements.snapshots.json";
export const REQUIREMENTS_SNAPSHOT_DIR_REL =
  ".stagent/specs/requirements.snapshots";

export const E_SPEC_SNAPSHOT_IMMUTABLE = "E_SPEC_SNAPSHOT_IMMUTABLE";
export const E_SPEC_SNAPSHOT_NOT_FOUND = "E_SPEC_SNAPSHOT_NOT_FOUND";
export const E_SPEC_SNAPSHOT_CORRUPT = "E_SPEC_SNAPSHOT_CORRUPT";
export const E_SPEC_SNAPSHOT_INVALID = "E_SPEC_SNAPSHOT_INVALID";

export type RequirementsSnapshotSource =
  "INITIALIZED_FROM_CONTRACT" | "USER_EDIT" | "CHANGE_REQUEST";

/** 冻结后的需求快照（元数据；正文在 file 指向的文件里） */
export interface RequirementsSnapshot {
  snapshot_id: string;
  contract_id: string;
  version: number;
  sha256: string;
  source: RequirementsSnapshotSource;
  created_at: string;
  /** 正式需求变更的关联键；普通初始化/编辑为空 */
  change_request_id?: string;
  /** 仓库相对路径 */
  file: string;
  immutable: true;
}

export interface RequirementsBaseline {
  snapshot: RequirementsSnapshot;
  content: string;
}

interface ContractRequirementsState {
  contract_id: string;
  /** 进入执行链后置 true：普通写入被拒绝 */
  locked: boolean;
  baseline_snapshot_id: string | null;
  snapshots: RequirementsSnapshot[];
}

interface RequirementsIndexFile {
  schema_version: "1.0";
  contracts: Record<string, ContractRequirementsState>;
}

export interface RequirementsStoreOptions {
  clock?: (() => Date) | undefined;
}

export class RequirementsStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "RequirementsStoreError";
    this.code = code;
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/** 文本原子写：临时文件 + fsync + rename，权限 0600 */
function writeTextAtomic(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`,
  );
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, content, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // 清理失败不掩盖原始错误
    }
    throw err;
  }
}

/** 合同 id 只允许安全字符，防止快照目录被 `../` 穿越 */
function safeContractSegment(contractId: string): string {
  const safe = contractId.replace(/[^A-Za-z0-9_-]/g, "_");
  if (safe.length === 0) {
    throw new RequirementsStoreError(
      E_SPEC_SNAPSHOT_INVALID,
      `合同 id 无法用于快照目录: ${JSON.stringify(contractId)}`,
    );
  }
  return safe;
}

/**
 * 从合同意图渲染确定性 Markdown。
 *
 * 刻意不写时间戳：同样的 intent 永远得到同样的正文，`ensureBaseline`
 * 才能用 SHA-256 判断"是否需要新版本"，避免每次启动都产生 v2/v3。
 */
export function renderRequirementsMarkdown(
  contract: Pick<
    SoftwareContract,
    "contract_id" | "contract_revision" | "intent"
  >,
): string {
  const { intent } = contract;
  const criteria = intent.acceptance_criteria
    .map((item) => `- ${item.trim()}`)
    .join("\n");
  return [
    `# ${intent.title}`,
    "",
    intent.description.trim() || "（合同未提供描述）",
    "",
    "## 验收标准",
    criteria,
    "",
    "## 风险级别",
    intent.risk_level,
    "",
    "## 溯源",
    `- 合同：${contract.contract_id}（rev ${contract.contract_revision}）`,
    "- 生成方式：contract.intent 初始化",
    "",
  ].join("\n");
}

export class RequirementsStore {
  private readonly repoRoot: string;
  private readonly clock: () => Date;
  readonly requirementsPath: string;
  readonly indexPath: string;
  readonly snapshotsRoot: string;

  constructor(repoRoot: string, options: RequirementsStoreOptions = {}) {
    this.repoRoot = path.resolve(repoRoot);
    this.clock = options.clock ?? (() => new Date());
    this.requirementsPath = path.join(this.repoRoot, REQUIREMENTS_FILE_REL);
    this.indexPath = path.join(this.repoRoot, REQUIREMENTS_INDEX_REL);
    this.snapshotsRoot = path.join(
      this.repoRoot,
      REQUIREMENTS_SNAPSHOT_DIR_REL,
    );
    fs.mkdirSync(path.dirname(this.requirementsPath), { recursive: true });
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  private emptyIndex(): RequirementsIndexFile {
    return { schema_version: "1.0", contracts: {} };
  }

  private loadIndex(): RequirementsIndexFile {
    if (!fs.existsSync(this.indexPath)) return this.emptyIndex();
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.indexPath, "utf-8"),
      ) as RequirementsIndexFile;
      if (
        parsed?.schema_version !== "1.0" ||
        typeof parsed.contracts !== "object" ||
        parsed.contracts === null
      ) {
        throw new Error("index shape invalid");
      }
      return parsed;
    } catch (err) {
      throw new RequirementsStoreError(
        E_SPEC_SNAPSHOT_CORRUPT,
        `快照索引损坏: ${(err as Error).message}`,
      );
    }
  }

  private saveIndex(index: RequirementsIndexFile): void {
    writeJsonAtomic(this.indexPath, index);
    try {
      fs.chmodSync(this.indexPath, 0o600);
    } catch {
      // 非 POSIX 平台忽略
    }
  }

  private stateOf(
    index: RequirementsIndexFile,
    contractId: string,
  ): ContractRequirementsState | undefined {
    return index.contracts[contractId];
  }

  /** 读取当前需求文件（不存在返回 null） */
  readCurrent(): { content: string; sha256: string } | null {
    if (!fs.existsSync(this.requirementsPath)) return null;
    const content = fs.readFileSync(this.requirementsPath, "utf-8");
    return { content, sha256: sha256(content) };
  }

  listSnapshots(contractId: string): RequirementsSnapshot[] {
    return [...(this.stateOf(this.loadIndex(), contractId)?.snapshots ?? [])];
  }

  isLocked(contractId: string): boolean {
    return this.stateOf(this.loadIndex(), contractId)?.locked === true;
  }

  /**
   * 冻结当前需求为执行基准：
   * - 已有基准 → 校验完整性后原样返回（幂等）；
   * - 文件已存在 → 以现有内容建 v1（视为用户预先写入的规范）；
   * - 文件不存在 → 从 `contract.intent` 渲染并落盘，再建 v1。
   */
  ensureBaseline(
    contract: Pick<
      SoftwareContract,
      "contract_id" | "contract_revision" | "intent"
    >,
  ): RequirementsBaseline {
    const index = this.loadIndex();
    const existing = this.stateOf(index, contract.contract_id);
    if (existing?.baseline_snapshot_id) {
      const snapshot = existing.snapshots.find(
        (item) => item.snapshot_id === existing.baseline_snapshot_id,
      );
      if (!snapshot) {
        throw new RequirementsStoreError(
          E_SPEC_SNAPSHOT_NOT_FOUND,
          `合同 ${contract.contract_id} 的基准快照索引缺失`,
        );
      }
      const content = this.readSnapshotContent(snapshot);
      if (!existing.locked) {
        existing.locked = true;
        this.saveIndex(index);
      }
      return { snapshot, content };
    }

    const current = this.readCurrent();
    const content = current?.content ?? renderRequirementsMarkdown(contract);
    const source: RequirementsSnapshotSource =
      current === null ? "INITIALIZED_FROM_CONTRACT" : "USER_EDIT";

    if (current === null) {
      writeTextAtomic(this.requirementsPath, content);
    }

    const snapshot = this.createSnapshotFile(contract.contract_id, {
      content,
      source,
      version: 1,
    });

    const state: ContractRequirementsState = existing ?? {
      contract_id: contract.contract_id,
      locked: false,
      baseline_snapshot_id: null,
      snapshots: [],
    };
    state.snapshots.push(snapshot);
    state.baseline_snapshot_id = snapshot.snapshot_id;
    // 建立基准即进入执行期：此后普通写入被拒绝
    state.locked = true;
    index.contracts[contract.contract_id] = state;
    this.saveIndex(index);
    return { snapshot, content };
  }

  /**
   * 写入新需求版本。
   *
   * - 锁定后无 `changeRequestId` → `E_SPEC_SNAPSHOT_IMMUTABLE`；
   * - 内容与当前一致 → 幂等返回最近快照，不产生噪音版本；
   * - 有 `changeRequestId` → 新版本成为新基准，旧快照文件保持冻结。
   */
  writeSnapshot(params: {
    contract: Pick<
      SoftwareContract,
      "contract_id" | "contract_revision" | "intent"
    >;
    content: string;
    source: RequirementsSnapshotSource;
    changeRequestId?: string | undefined;
  }): RequirementsSnapshot {
    const content = params.content.trimEnd() + "\n";
    if (content.trim().length === 0) {
      throw new RequirementsStoreError(
        E_SPEC_SNAPSHOT_INVALID,
        "需求正文不能为空",
      );
    }

    const index = this.loadIndex();
    const state = this.stateOf(index, params.contract.contract_id);
    if (state?.locked === true && params.changeRequestId === undefined) {
      throw new RequirementsStoreError(
        E_SPEC_SNAPSHOT_IMMUTABLE,
        `合同 ${params.contract.contract_id} 已进入执行期，需求基准不可改写；` +
          "正式变更必须携带 change_request_id",
      );
    }

    const current = this.readCurrent();
    if (current !== null && current.sha256 === sha256(content)) {
      const snapshots = state?.snapshots ?? [];
      const latest = snapshots.at(-1);
      if (latest) return latest;
    }

    const nextState: ContractRequirementsState = state ?? {
      contract_id: params.contract.contract_id,
      locked: false,
      baseline_snapshot_id: null,
      snapshots: [],
    };
    const version = nextState.snapshots.length + 1;
    const snapshot = this.createSnapshotFile(params.contract.contract_id, {
      content,
      source: params.source,
      version,
      ...(params.changeRequestId === undefined
        ? {}
        : { changeRequestId: params.changeRequestId }),
    });

    writeTextAtomic(this.requirementsPath, content);
    nextState.snapshots.push(snapshot);
    // 正式变更：新版本成为新基准；旧版本文件不被触碰
    nextState.baseline_snapshot_id = snapshot.snapshot_id;
    index.contracts[params.contract.contract_id] = nextState;
    this.saveIndex(index);
    return snapshot;
  }

  /** 读取合同当前基准；索引缺失返回 null，文件被篡改抛错 */
  getBaseline(contractId: string): RequirementsBaseline | null {
    const index = this.loadIndex();
    const state = this.stateOf(index, contractId);
    if (!state?.baseline_snapshot_id) return null;
    const snapshot = state.snapshots.find(
      (item) => item.snapshot_id === state.baseline_snapshot_id,
    );
    if (!snapshot) {
      throw new RequirementsStoreError(
        E_SPEC_SNAPSHOT_NOT_FOUND,
        `合同 ${contractId} 的基准快照不存在于索引中`,
      );
    }
    return { snapshot, content: this.readSnapshotContent(snapshot) };
  }

  /** 读取任意冻结快照正文，并校验 SHA-256 */
  readSnapshotContent(snapshot: RequirementsSnapshot): string {
    const file = path.join(this.repoRoot, snapshot.file);
    let content: string;
    try {
      content = fs.readFileSync(file, "utf-8");
    } catch {
      throw new RequirementsStoreError(
        E_SPEC_SNAPSHOT_NOT_FOUND,
        `快照文件不存在: ${snapshot.file}`,
      );
    }
    if (sha256(content) !== snapshot.sha256) {
      throw new RequirementsStoreError(
        E_SPEC_SNAPSHOT_CORRUPT,
        `快照 ${snapshot.snapshot_id} 的 SHA-256 与索引不一致，疑似被外部篡改`,
      );
    }
    return content;
  }

  private createSnapshotFile(
    contractId: string,
    params: {
      content: string;
      source: RequirementsSnapshotSource;
      version: number;
      changeRequestId?: string;
    },
  ): RequirementsSnapshot {
    const digest = sha256(params.content);
    const segment = safeContractSegment(contractId);
    const relative = path.posix.join(
      REQUIREMENTS_SNAPSHOT_DIR_REL,
      segment,
      `v${params.version}-${digest.slice(0, 8)}.md`,
    );
    const absolute = path.join(this.repoRoot, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });

    // wx：快照文件必须一次写成，绝不允许覆盖既有版本
    if (fs.existsSync(absolute)) {
      const existing = fs.readFileSync(absolute, "utf-8");
      if (sha256(existing) !== digest) {
        throw new RequirementsStoreError(
          E_SPEC_SNAPSHOT_IMMUTABLE,
          `快照文件已存在且内容不同，拒绝覆盖: ${relative}`,
        );
      }
    } else {
      const fd = fs.openSync(absolute, "wx", 0o600);
      try {
        fs.writeFileSync(fd, params.content, "utf8");
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
    }

    return {
      snapshot_id: `req_${segment}_v${params.version}_${digest.slice(0, 8)}`,
      contract_id: contractId,
      version: params.version,
      sha256: digest,
      source: params.source,
      created_at: this.nowIso(),
      ...(params.changeRequestId === undefined
        ? {}
        : { change_request_id: params.changeRequestId }),
      file: relative,
      immutable: true,
    };
  }
}
