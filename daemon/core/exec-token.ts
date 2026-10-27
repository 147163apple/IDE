/**
 * TASK-C.12a / EO-07：双层施工令牌（exec_token + resume_token+jti）。
 *
 * 外部 session-token 仍由 D.1 鉴权；本模块只管「签署后施工写权」：
 * - issueExecToken：绑定 contract_id / worktree / writable scope 摘要
 * - revokeExecToken：PAUSED / 越界时硬吊销；旧令牌一律拒绝
 * - issueResumeToken / consumeResumeToken：一次性 jti
 * - assertExecTokenForWrite：Gateway 写路径校验入口
 *
 * 内存级轻量 Token + 同进程 IPC；不强制 JWT。日志侧只输出指纹，不打印明文。
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const E_EXEC_TOKEN_MISSING = "E_EXEC_TOKEN_MISSING";
export const E_EXEC_TOKEN_REVOKED = "E_EXEC_TOKEN_REVOKED";
export const E_EXEC_TOKEN_MISMATCH = "E_EXEC_TOKEN_MISMATCH";
export const E_RESUME_TOKEN_INVALID = "E_RESUME_TOKEN_INVALID";
export const E_RESUME_TOKEN_REUSED = "E_RESUME_TOKEN_REUSED";

export interface ExecTokenClaims {
  typ: "exec";
  jti: string;
  contract_id: string;
  worktree: string;
  /** writable_paths 摘要（排序后 join），供校验与审计 */
  writable_scope_digest: string;
  issued_at: string;
  revoked: boolean;
}

export interface ResumeTokenClaims {
  typ: "resume";
  jti: string;
  contract_id: string;
  replaces_jti: string;
  issued_at: string;
  consumed: boolean;
}

export interface IssuedExecToken {
  token: string;
  claims: ExecTokenClaims;
}

export interface IssuedResumeToken {
  token: string;
  claims: ResumeTokenClaims;
}

export class ExecTokenError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "ExecTokenError";
    this.code = code;
  }
}

/** 日志安全：只暴露短指纹，永不打印明文 token */
export function tokenFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 12);
}

export function digestWritableScope(paths: readonly string[]): string {
  const normalized = [...paths]
    .map((p) => p.trim())
    .filter(Boolean)
    .sort();
  return createHash("sha256")
    .update(normalized.join("\n"))
    .digest("hex")
    .slice(0, 16);
}

function mintOpaque(): string {
  return randomBytes(32).toString("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * 进程内令牌账本。单测与 Daemon 均可 new 一份；
 * 不落盘明文（重启即失效 = 需重新签署/恢复，符合 v0.1 本地施工语义）。
 */
export class ExecTokenStore {
  private readonly byToken = new Map<string, ExecTokenClaims>();
  private readonly byContract = new Map<string, string>();
  private readonly resumeByToken = new Map<string, ResumeTokenClaims>();
  private readonly consumedJtis = new Set<string>();
  /** 已消耗 resume 明文指纹：二次提交同 token 时判 REUSED 而非 INVALID */
  private readonly consumedResumeFingerprints = new Set<string>();

  issueExecToken(input: {
    contract_id: string;
    worktree: string;
    writable_paths: readonly string[];
    now?: () => Date;
  }): IssuedExecToken {
    const now = input.now ?? (() => new Date());
    // 同合同旧 exec 一律作废（重签 / 恢复后换新）
    const prev = this.byContract.get(input.contract_id);
    if (prev) {
      const old = this.byToken.get(prev);
      if (old) old.revoked = true;
      this.byToken.delete(prev);
    }

    const token = mintOpaque();
    const claims: ExecTokenClaims = {
      typ: "exec",
      jti: mintOpaque().slice(0, 16),
      contract_id: input.contract_id,
      worktree: input.worktree,
      writable_scope_digest: digestWritableScope(input.writable_paths),
      issued_at: now().toISOString(),
      revoked: false,
    };
    this.byToken.set(token, claims);
    this.byContract.set(input.contract_id, token);
    return { token, claims };
  }

  /** PAUSED / 越界：硬吊销当前合同的 exec_token */
  revokeExecToken(contractId: string): boolean {
    const token = this.byContract.get(contractId);
    if (!token) return false;
    const claims = this.byToken.get(token);
    if (claims) claims.revoked = true;
    this.byToken.delete(token);
    this.byContract.delete(contractId);
    return true;
  }

  peekExecToken(contractId: string): ExecTokenClaims | null {
    const token = this.byContract.get(contractId);
    if (!token) return null;
    return this.byToken.get(token) ?? null;
  }

  /**
   * 恢复施工：签发一次性 resume_token（带 jti）。
   * 消耗成功后会自动签发新的 exec_token。
   */
  issueResumeToken(input: {
    contract_id: string;
    replaces_jti?: string;
    now?: () => Date;
  }): IssuedResumeToken {
    const now = input.now ?? (() => new Date());
    const prev = this.peekExecToken(input.contract_id);
    const token = mintOpaque();
    const claims: ResumeTokenClaims = {
      typ: "resume",
      jti: mintOpaque().slice(0, 16),
      contract_id: input.contract_id,
      replaces_jti: input.replaces_jti ?? prev?.jti ?? "",
      issued_at: now().toISOString(),
      consumed: false,
    };
    this.resumeByToken.set(token, claims);
    return { token, claims };
  }

  /**
   * 消耗 resume_token：jti 用过即废；成功则签发新 exec_token。
   */
  consumeResumeToken(
    resumeToken: string,
    issue: {
      worktree: string;
      writable_paths: readonly string[];
      now?: () => Date;
    },
  ): IssuedExecToken {
    const fp = tokenFingerprint(resumeToken);
    if (this.consumedResumeFingerprints.has(fp)) {
      throw new ExecTokenError(
        E_RESUME_TOKEN_REUSED,
        "resume_token jti 已使用，不得二次恢复",
      );
    }

    const claims = this.resumeByToken.get(resumeToken);
    if (!claims || claims.consumed) {
      throw new ExecTokenError(
        E_RESUME_TOKEN_INVALID,
        "resume_token 无效或已吊销",
      );
    }

    if (this.consumedJtis.has(claims.jti)) {
      throw new ExecTokenError(
        E_RESUME_TOKEN_REUSED,
        "resume_token jti 已使用，不得二次恢复",
      );
    }

    claims.consumed = true;
    this.consumedJtis.add(claims.jti);
    this.consumedResumeFingerprints.add(fp);
    this.resumeByToken.delete(resumeToken);

    // 吊销旧 exec（若仍在）再发新
    this.revokeExecToken(claims.contract_id);
    return this.issueExecToken({
      contract_id: claims.contract_id,
      worktree: issue.worktree,
      writable_paths: issue.writable_paths,
      // exactOptionalPropertyTypes：`now` 可能没传，直接传 `undefined` 不符合
      // 「可选但不接受显式 undefined」的口径，省略键则由被调方回退默认时钟。
      ...(issue.now ? { now: issue.now } : {}),
    });
  }

  /**
   * Gateway 写路径校验：必须持有未吊销、合同/worktree 匹配的 exec_token。
   * session-token 不得冒充施工写权。
   */
  assertExecTokenForWrite(input: {
    token: string | null | undefined;
    contract_id: string;
    worktree: string;
  }): ExecTokenClaims {
    if (!input.token) {
      throw new ExecTokenError(
        E_EXEC_TOKEN_MISSING,
        "签署后写 worktree 需要 exec_token；session-token 不能冒充施工写权",
      );
    }
    const claims = this.byToken.get(input.token);
    if (!claims) {
      // 可能是已吊销（从 map 删除）或从未签发
      throw new ExecTokenError(
        E_EXEC_TOKEN_REVOKED,
        "exec_token 无效或已在 PAUSED 时吊销",
      );
    }
    if (claims.revoked) {
      throw new ExecTokenError(
        E_EXEC_TOKEN_REVOKED,
        "exec_token 已吊销，拒绝写入",
      );
    }
    if (
      claims.contract_id !== input.contract_id ||
      !safeEqual(claims.worktree, input.worktree)
    ) {
      throw new ExecTokenError(
        E_EXEC_TOKEN_MISMATCH,
        "exec_token 与 contract_id/worktree 不匹配",
      );
    }
    return claims;
  }

  /** 供测试：是否仍认这个明文 token */
  hasActiveToken(token: string): boolean {
    const c = this.byToken.get(token);
    return Boolean(c && !c.revoked);
  }
}

/** Daemon 单例入口（懒创建，便于测试替换） */
let sharedStore: ExecTokenStore | null = null;

export function getExecTokenStore(): ExecTokenStore {
  if (!sharedStore) sharedStore = new ExecTokenStore();
  return sharedStore;
}

/** 仅测试用：重置单例 */
export function resetExecTokenStoreForTests(): void {
  sharedStore = new ExecTokenStore();
}
