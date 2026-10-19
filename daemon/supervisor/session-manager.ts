import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { writeJsonAtomic } from "../../src/lib/state-machine";
import {
  SUPERVISOR_SESSION_SCHEMA_VERSION,
  type SupervisorMessage,
  type SupervisorMessageRole,
  type SupervisorMessageSource,
  type SupervisorObservationState,
  type SupervisorQuarantineRecord,
  type SupervisorRecoveryReport,
  type SupervisorSession,
  type SupervisorSessionSummary,
  type SupervisorUsageSnapshot,
} from "./types";

/**
 * Supervisor 会话管理器（TASK-S.1，Local-First）。
 *
 * 关键约定：
 * - 唯一落盘位置 `<repo>/.stagent/sessions/{session_id}.json`，目录 0700、文件 0600；
 * - 写入复用 `src/lib/state-machine.ts` 的 `writeJsonAtomic`
 *   （临时文件 + fsync + rename），掉电或进程中断只会留下旧版本或孤儿临时文件，
 *   绝不会出现「半个 JSON」被当成权威副本；
 * - `recover()` 负责崩溃后的原子恢复：校验全部会话文件，损坏文件隔离为
 *   `*.corrupt-{ts}`（不删除，保留排障证据），并清理孤儿临时文件；
 * - session_id 严格白名单（`[A-Za-z0-9][A-Za-z0-9_-]{7,127}`），
 *   从根上阻断 `../` 路径穿越（禁用 `E_FORBIDDEN_PATH`）。
 *
 * 本模块不做任何模型调用、不执行命令、不触碰业务文件 —— 只读写会话目录。
 */

/** session_id 白名单：拒绝路径分隔符、点号开头、超长输入 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/;

const SESSION_FILE_EXT = ".json";
/** 孤儿临时文件形如 `.ses_xxx.json.tmp-123-1700000000000` */
const TEMP_FILE_PATTERN = /^\..*\.tmp-\d+-\d+$/;

export const E_FORBIDDEN_PATH = "E_FORBIDDEN_PATH";
export const E_SUPERVISOR_SESSION_INVALID = "E_SUPERVISOR_SESSION_INVALID";

export class SupervisorSessionIdError extends Error {
  readonly code = E_FORBIDDEN_PATH;
  constructor(sessionId: string) {
    super(
      `[${E_FORBIDDEN_PATH}] Illegal supervisor session id: ${JSON.stringify(sessionId)}`,
    );
    this.name = "SupervisorSessionIdError";
  }
}

export class SupervisorSessionValidationError extends Error {
  readonly code = E_SUPERVISOR_SESSION_INVALID;
  readonly reason: string;
  constructor(reason: string) {
    super(`[${E_SUPERVISOR_SESSION_INVALID}] ${reason}`);
    this.name = "SupervisorSessionValidationError";
    this.reason = reason;
  }
}

export interface SupervisorSessionManagerOptions {
  /** 注入时钟（测试用）；默认 `new Date()` */
  clock?: (() => Date) | undefined;
  /** 注入 id 生成器（测试用）；默认 `ses_<uuid>` */
  idFactory?: (() => string) | undefined;
}

type ValidationResult =
  { ok: true; session: SupervisorSession } | { ok: false; reason: string };

const MESSAGE_ROLES: readonly SupervisorMessageRole[] = [
  "user",
  "supervisor",
  "system",
];

const MESSAGE_SOURCES: readonly SupervisorMessageSource[] = [
  "ui",
  "daemon_event",
  "model",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validateMessage(value: unknown, index: number): string | null {
  if (!isPlainObject(value)) return `messages[${index}] must be an object`;
  const { message_id, role, text, created_at, source, refs } = value;
  if (typeof message_id !== "string" || message_id.length === 0) {
    return `messages[${index}].message_id must be a non-empty string`;
  }
  if (!MESSAGE_ROLES.includes(role as SupervisorMessageRole)) {
    return `messages[${index}].role is invalid: ${String(role)}`;
  }
  if (typeof text !== "string") {
    return `messages[${index}].text must be a string`;
  }
  if (!isIsoTimestamp(created_at)) {
    return `messages[${index}].created_at must be an ISO timestamp`;
  }
  if (!MESSAGE_SOURCES.includes(source as SupervisorMessageSource)) {
    return `messages[${index}].source is invalid: ${String(source)}`;
  }
  if (refs !== undefined) {
    if (!Array.isArray(refs) || refs.some((ref) => typeof ref !== "string")) {
      return `messages[${index}].refs must be an array of strings`;
    }
  }
  return null;
}

/**
 * 会话结构校验（运行时唯一事实源）。
 * 未知字段容忍（向前兼容），但已知字段必须严格合法；
 * `schema_version` 不匹配直接拒绝，避免旧结构被当成新结构静默使用。
 */
export function validateSupervisorSession(value: unknown): ValidationResult {
  if (!isPlainObject(value))
    return { ok: false, reason: "session must be an object" };

  const {
    schema_version,
    session_id,
    contract_id,
    created_at,
    updated_at,
    messages,
    observation,
    usage,
  } = value;

  if (schema_version !== SUPERVISOR_SESSION_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `unsupported schema_version: ${String(schema_version)}`,
    };
  }
  if (typeof session_id !== "string" || !SESSION_ID_PATTERN.test(session_id)) {
    return { ok: false, reason: `illegal session_id: ${String(session_id)}` };
  }
  if (contract_id !== undefined) {
    if (typeof contract_id !== "string" || contract_id.length === 0) {
      return { ok: false, reason: "contract_id must be a non-empty string" };
    }
  }
  if (!isIsoTimestamp(created_at)) {
    return { ok: false, reason: "created_at must be an ISO timestamp" };
  }
  if (!isIsoTimestamp(updated_at)) {
    return { ok: false, reason: "updated_at must be an ISO timestamp" };
  }
  if (!Array.isArray(messages)) {
    return { ok: false, reason: "messages must be an array" };
  }
  for (let i = 0; i < messages.length; i += 1) {
    const failure = validateMessage(messages[i], i);
    if (failure) return { ok: false, reason: failure };
  }
  if (observation !== undefined) {
    if (observation !== "ACTIVE" && observation !== "PAUSED") {
      return {
        ok: false,
        reason: `illegal observation: ${String(observation)}`,
      };
    }
  }
  let usageSnapshot: SupervisorUsageSnapshot | undefined;
  if (usage !== undefined) {
    if (!isPlainObject(usage)) {
      return { ok: false, reason: "usage must be an object" };
    }
    const {
      input_tokens,
      output_tokens,
      cost_minor_units,
      currency,
      updated_at: usageAt,
    } = usage;
    if (!isNonNegativeInteger(input_tokens)) {
      return {
        ok: false,
        reason: "usage.input_tokens must be a non-negative integer",
      };
    }
    if (!isNonNegativeInteger(output_tokens)) {
      return {
        ok: false,
        reason: "usage.output_tokens must be a non-negative integer",
      };
    }
    if (!isNonNegativeInteger(cost_minor_units)) {
      return {
        ok: false,
        reason: "usage.cost_minor_units must be a non-negative integer",
      };
    }
    if (typeof currency !== "string" || currency.length === 0) {
      return { ok: false, reason: "usage.currency must be a non-empty string" };
    }
    if (!isIsoTimestamp(usageAt)) {
      return { ok: false, reason: "usage.updated_at must be an ISO timestamp" };
    }
    usageSnapshot = {
      input_tokens,
      output_tokens,
      cost_minor_units,
      currency,
      updated_at: usageAt,
    };
  }

  // 逐字段重建，避免把未知键写回权威文件（会话文件只保存已知结构）
  const session: SupervisorSession = {
    schema_version: SUPERVISOR_SESSION_SCHEMA_VERSION,
    session_id,
    created_at,
    updated_at,
    messages: messages as SupervisorMessage[],
    ...(contract_id === undefined ? {} : { contract_id }),
    ...(observation === undefined
      ? {}
      : { observation: observation as SupervisorObservationState }),
    ...(usageSnapshot === undefined ? {} : { usage: usageSnapshot }),
  };
  return { ok: true, session };
}

export class SupervisorSessionManager {
  private readonly sessionsDir: string;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;

  constructor(repoRoot: string, options: SupervisorSessionManagerOptions = {}) {
    this.sessionsDir = path.join(
      path.resolve(repoRoot),
      ".stagent",
      "sessions",
    );
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => `ses_${randomUUID()}`);

    fs.mkdirSync(this.sessionsDir, { recursive: true, mode: 0o700 });
    // 目录可能由旧版本以更宽权限创建，这里强制收紧
    try {
      fs.chmodSync(this.sessionsDir, 0o700);
    } catch {
      // Windows 等平台不支持 POSIX 权限位，退化为尽力而为
    }
  }

  get directory(): string {
    return this.sessionsDir;
  }

  /** 会话文件绝对路径（session_id 先过白名单，杜绝路径穿越） */
  filePath(sessionId: string): string {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      throw new SupervisorSessionIdError(sessionId);
    }
    return path.join(this.sessionsDir, `${sessionId}${SESSION_FILE_EXT}`);
  }

  private nowIso(): string {
    return this.clock().toISOString();
  }

  create(params: { contractId?: string | undefined } = {}): SupervisorSession {
    const now = this.nowIso();
    const session: SupervisorSession = {
      schema_version: SUPERVISOR_SESSION_SCHEMA_VERSION,
      session_id: this.idFactory(),
      created_at: now,
      updated_at: now,
      messages: [],
      observation: "ACTIVE",
      ...(params.contractId === undefined
        ? {}
        : { contract_id: params.contractId }),
    };
    return this.save(session);
  }

  /**
   * 原子保存：校验 → 刷新 updated_at → writeJsonAtomic → 收紧 0600。
   * 校验失败抛出 `SupervisorSessionValidationError`，绝不落盘非法结构。
   */
  save(session: SupervisorSession): SupervisorSession {
    const result = validateSupervisorSession(session);
    if (!result.ok) {
      throw new SupervisorSessionValidationError(result.reason);
    }
    const next: SupervisorSession = {
      ...result.session,
      updated_at: this.nowIso(),
    };
    const file = this.filePath(next.session_id);
    writeJsonAtomic(file, next);
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // 同上：非 POSIX 平台忽略
    }
    return next;
  }

  /** 读取会话；不存在或结构非法均返回 null（上层按「无会话」处理，不吞掉磁盘错误） */
  load(sessionId: string): SupervisorSession | null {
    const file = this.filePath(sessionId);
    let raw: string;
    try {
      raw = fs.readFileSync(file, "utf-8");
    } catch {
      return null;
    }
    if (!raw.trim()) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    const result = validateSupervisorSession(parsed);
    return result.ok ? result.session : null;
  }

  list(): SupervisorSessionSummary[] {
    if (!fs.existsSync(this.sessionsDir)) return [];
    const summaries: SupervisorSessionSummary[] = [];
    for (const entry of fs.readdirSync(this.sessionsDir)) {
      if (!entry.endsWith(SESSION_FILE_EXT)) continue;
      if (entry.startsWith(".")) continue;
      const sessionId = entry.slice(0, -SESSION_FILE_EXT.length);
      const session = this.load(sessionId);
      if (!session) continue;
      summaries.push(this.toSummary(session));
    }
    return summaries.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  private toSummary(session: SupervisorSession): SupervisorSessionSummary {
    return {
      session_id: session.session_id,
      created_at: session.created_at,
      updated_at: session.updated_at,
      message_count: session.messages.length,
      observation: session.observation ?? "ACTIVE",
      file_path: this.filePath(session.session_id),
      ...(session.contract_id === undefined
        ? {}
        : { contract_id: session.contract_id }),
    };
  }

  /** 追加消息并原子落盘 */
  appendMessage(
    sessionId: string,
    message: Omit<SupervisorMessage, "message_id" | "created_at"> & {
      message_id?: string | undefined;
      created_at?: string | undefined;
    },
  ): SupervisorSession {
    const session = this.load(sessionId);
    if (!session) {
      throw new SupervisorSessionValidationError(
        `session not found or unreadable: ${sessionId}`,
      );
    }
    const next: SupervisorMessage = {
      ...message,
      message_id: message.message_id ?? `msg_${randomUUID()}`,
      created_at: message.created_at ?? this.nowIso(),
    };
    return this.save({
      ...session,
      messages: [...session.messages, next],
    });
  }

  /** 用户显式暂停/恢复观察（§2.2 可停止观察） */
  setObservationState(
    sessionId: string,
    state: SupervisorObservationState,
  ): SupervisorSession {
    const session = this.load(sessionId);
    if (!session) {
      throw new SupervisorSessionValidationError(
        `session not found or unreadable: ${sessionId}`,
      );
    }
    return this.save({ ...session, observation: state });
  }

  /** 预算快照镜像（不参与放行判断） */
  updateUsage(
    sessionId: string,
    usage: Omit<SupervisorUsageSnapshot, "updated_at">,
  ): SupervisorSession {
    const session = this.load(sessionId);
    if (!session) {
      throw new SupervisorSessionValidationError(
        `session not found or unreadable: ${sessionId}`,
      );
    }
    return this.save({
      ...session,
      usage: { ...usage, updated_at: this.nowIso() },
    });
  }

  /** 用户清除单个本地会话（§2.2「清除本地会话」） */
  clear(sessionId: string): boolean {
    const file = this.filePath(sessionId);
    try {
      fs.unlinkSync(file);
      return true;
    } catch {
      return false;
    }
  }

  /** 清除全部本地会话，返回删除数量 */
  clearAll(): number {
    if (!fs.existsSync(this.sessionsDir)) return 0;
    let removed = 0;
    for (const entry of fs.readdirSync(this.sessionsDir)) {
      if (!entry.endsWith(SESSION_FILE_EXT) || entry.startsWith(".")) continue;
      try {
        fs.unlinkSync(path.join(this.sessionsDir, entry));
        removed += 1;
      } catch {
        // 单个删除失败不影响其余会话
      }
    }
    return removed;
  }

  /**
   * 崩溃后的原子恢复：
   * 1. 逐个校验会话文件，损坏文件隔离为 `{name}.corrupt-{ts}`（保留证据，不静默删除）；
   * 2. 清理 `writeJsonAtomic` 中断留下的孤儿临时文件（`.{name}.tmp-{pid}-{ts}`）；
   * 3. 返回健康会话（按更新时间倒序）。
   *
   * 由于权威写入是 rename 原子的，恢复时看到的要么是上一份完整版本，
   * 要么是新的完整版本，不存在需要「合并半截内容」的中间态。
   */
  recover(): SupervisorRecoveryReport {
    const report: SupervisorRecoveryReport = {
      sessions: [],
      quarantined: [],
      removed_temp_files: [],
    };
    if (!fs.existsSync(this.sessionsDir)) return report;

    const now = this.clock().getTime();
    for (const entry of fs.readdirSync(this.sessionsDir)) {
      const full = path.join(this.sessionsDir, entry);

      if (TEMP_FILE_PATTERN.test(entry)) {
        try {
          fs.unlinkSync(full);
          report.removed_temp_files.push(entry);
        } catch {
          // 清理失败不阻断恢复
        }
        continue;
      }

      if (!entry.endsWith(SESSION_FILE_EXT) || entry.startsWith(".")) continue;

      let reason: string | null = null;
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(full, "utf-8"));
        const result = validateSupervisorSession(parsed);
        if (result.ok) {
          report.sessions.push(result.session);
          continue;
        }
        reason = result.reason;
      } catch (err) {
        reason = `unreadable: ${(err as Error).message}`;
      }

      const quarantinedAs = `${entry}.corrupt-${now}`;
      try {
        fs.renameSync(full, path.join(this.sessionsDir, quarantinedAs));
      } catch {
        // 隔离失败时保留原文件，只在报告中标记
      }
      const record: SupervisorQuarantineRecord = {
        file: entry,
        reason: reason ?? "unknown",
        quarantined_as: quarantinedAs,
      };
      report.quarantined.push(record);
    }

    report.sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    return report;
  }
}
