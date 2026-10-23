import fs from "node:fs";
import path from "node:path";
import type { SoftwareContract } from "../../../src/lib/contract.schema";
import type { EvidenceBundle } from "../../../src/lib/evidence.schema";
import { execGit } from "../../git/worktree-manager";
import { loadLatestEvidenceSnapshot } from "../../pipeline/merger";
import { unquoteGitPath } from "../../pipeline/untracked-scope-guard";
import { SupervisorSessionManager } from "../session-manager";
import type { SupervisorMessage, SupervisorSession } from "../types";
import { RequirementsStore } from "../specs/requirements-store";
import type { DiffFact, PromptFact, SpecFact, TriadFacts } from "./types";

/**
 * 三方事实抓取管道（TASK-S.5 / 架构 §5.7）。
 *
 * 三路证据全部来自真实物理载体，任何一路缺失都会被显式标注：
 * - Prompt：`SupervisorSessionManager` 的会话文件（`.stagent/sessions/`）；
 * - Spec：`RequirementsStore` 的冻结快照（`.stagent/specs/requirements.md`）；
 * - Diff：受控 Worktree 的 `git status/diff`、Evidence 里的验证退出码与终端尾巴。
 *
 * 本模块只抓事实，不做归因判断；归因在 `classification.ts`。
 * 所有外部依赖均可注入，测试不需要真实 git / 真实会话目录。
 */

const MAX_DIFF_CHARS = 20_000;
const MAX_TERMINAL_LINES = 200;
const MAX_SPEC_ENTRIES = 20;

/**
 * 中文质询没有分词器可用，这里用「停用词剥离 + 2-gram」近似：
 * "订单页面没有满减折扣功能" → 订单 / 满减折扣 / 满减 / 减折 / 折扣。
 * 2-gram 提高召回，停用词剥离避免"没有/功能"这类词把每行都命中。
 */
const STOP_PHRASES: readonly string[] = [
  "为什么",
  "怎么",
  "没有",
  "不是",
  "不能",
  "无法",
  "帮我",
  "请",
  "一下",
  "这个",
  "那个",
  "功能",
  "页面",
  "应该",
  "需要",
  "还是",
  "已经",
  "但是",
  "而且",
  "以及",
  "如果",
  "可以",
  "有没有",
  "问题",
  "缺少",
  "缺了",
  "少了",
  "没看到",
  "看不到",
  "明明",
];

/** 从白话质询中提取用于三方比对的关键词（确定性、无模型） */
export function extractKeywords(text: string): string[] {
  const normalized = text.normalize("NFKC").toLowerCase();
  const chunks = normalized
    .split(/[^\p{Script=Han}a-z0-9]+/u)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  const tokens = new Set<string>();
  for (const chunk of chunks) {
    let cleaned = chunk;
    for (const stop of STOP_PHRASES) {
      cleaned = cleaned.split(stop).join(" ");
    }
    for (const part of cleaned.split(/\s+/)) {
      if (!part) continue;
      if (/^[a-z0-9]+$/.test(part)) {
        if (part.length >= 3) tokens.add(part);
        continue;
      }
      if (part.length >= 2) tokens.add(part);
      for (let i = 0; i + 2 <= part.length; i += 1) {
        tokens.add(part.slice(i, i + 2));
      }
    }
  }

  return [...tokens]
    .filter((token) => token.length >= 2)
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, 40);
}

/** 关键词命中（大小写不敏感；任一命中即可） */
export function matchesKeywords(
  text: string,
  keywords: readonly string[],
): boolean {
  const haystack = text.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

/** 解析 `git status --porcelain -uall` 的变更路径（含重命名与引号转义） */
export function parseChangedPaths(porcelain: string): string[] {
  const paths = new Set<string>();
  for (const line of porcelain.split("\n")) {
    if (line.length < 4) continue;
    let raw = line.slice(3).trim();
    if (raw === "") continue;
    if (raw.includes(" -> ")) {
      raw = raw.split(" -> ").at(-1) ?? raw;
    }
    if (raw.startsWith('"')) {
      raw = unquoteGitPath(raw);
    }
    if (raw !== "") paths.add(raw);
  }
  return [...paths].sort();
}

export interface SessionFactInput {
  contractId: string;
  challenge?: string | undefined;
  sessionId?: string | undefined;
  keywords: readonly string[];
}

export interface SpecFactInput {
  contract: Pick<
    SoftwareContract,
    "contract_id" | "contract_revision" | "intent"
  >;
  keywords: readonly string[];
}

export interface CodeFactInput {
  contract: SoftwareContract;
  keywords: readonly string[];
}

export interface SessionFactSource {
  collect(input: SessionFactInput): PromptFact;
}

export interface SpecFactSource {
  collect(input: SpecFactInput): SpecFact | null;
}

export interface CodeFactSource {
  collect(input: CodeFactInput): Promise<DiffFact>;
}

/** Worktree 约定路径（与 worktree-manager.ts 保持一致） */
export function worktreePathFor(repoRoot: string, contractId: string): string {
  return path.join(
    path.resolve(repoRoot),
    ".stagent",
    "worktrees",
    `task-${contractId}`,
  );
}

function toPromptMessage(message: SupervisorMessage): {
  message_id: string;
  role: SupervisorMessage["role"];
  text: string;
  created_at: string;
} {
  return {
    message_id: message.message_id,
    role: message.role,
    text: message.text,
    created_at: message.created_at,
  };
}

export class SessionFactSourceImpl implements SessionFactSource {
  private readonly manager: SupervisorSessionManager;

  constructor(repoRoot: string) {
    this.manager = new SupervisorSessionManager(repoRoot);
  }

  private pickSession(input: SessionFactInput): SupervisorSession | null {
    if (input.sessionId !== undefined) {
      return this.manager.load(input.sessionId);
    }
    const latest = this.manager
      .list()
      .find((summary) => summary.contract_id === input.contractId);
    return latest ? this.manager.load(latest.session_id) : null;
  }

  collect(input: SessionFactInput): PromptFact {
    const session = this.pickSession(input);
    if (!session) {
      return {
        session_id: null,
        source: "CHALLENGE_ONLY",
        original_request: null,
        confirmations: [],
        matched_messages: [],
      };
    }

    const messages = session.messages.map(toPromptMessage);
    const userMessages = messages.filter((message) => message.role === "user");
    const original = userMessages[0]?.text.trim() ?? null;
    const confirmations = userMessages.filter((message) =>
      /确认|同意|批准|就按|按这个|没问题|可以，?就/.test(message.text),
    );
    const matched = messages.filter((message) =>
      matchesKeywords(message.text, input.keywords),
    );

    return {
      session_id: session.session_id,
      source: "SESSION",
      original_request: original,
      confirmations,
      matched_messages: matched.slice(-20),
    };
  }
}

export class SpecFactSourceImpl implements SpecFactSource {
  private readonly store: RequirementsStore;

  constructor(repoRoot: string) {
    this.store = new RequirementsStore(repoRoot);
  }

  collect(input: SpecFactInput): SpecFact | null {
    const baseline = this.store.ensureBaseline(input.contract);
    const entries = baseline.content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(
        (line) =>
          line.length > 0 &&
          !line.startsWith("#") &&
          !line.startsWith("- 合同："),
      );

    return {
      snapshot_id: baseline.snapshot.snapshot_id,
      version: baseline.snapshot.version,
      sha256: baseline.snapshot.sha256,
      content: baseline.content,
      matched_entries: entries
        .filter((line) => matchesKeywords(line, input.keywords))
        .slice(0, MAX_SPEC_ENTRIES),
    };
  }
}

function evidenceTerminalLines(evidence: EvidenceBundle | null): string[] {
  if (!evidence) return [];
  const lines: string[] = [];
  for (const result of evidence.verification_results) {
    for (const tail of [result.stdout_tail, result.stderr_tail]) {
      for (const line of tail.split(/\r?\n/)) {
        const trimmed = line.trimEnd();
        if (trimmed !== "") lines.push(`[${result.command_alias}] ${trimmed}`);
      }
    }
  }
  return lines.slice(-MAX_TERMINAL_LINES);
}

export class CodeFactSourceImpl implements CodeFactSource {
  private readonly repoRoot: string;

  constructor(repoRoot: string) {
    this.repoRoot = path.resolve(repoRoot);
  }

  async collect(input: CodeFactInput): Promise<DiffFact> {
    const worktreePath = worktreePathFor(
      this.repoRoot,
      input.contract.contract_id,
    );
    const evidence = loadLatestEvidenceSnapshot(
      this.repoRoot,
      input.contract.contract_id,
    );
    const verification =
      evidence?.verification_results.map((result) => ({
        alias: result.command_alias,
        exit_code: result.exit_code,
        passed: result.passed,
      })) ?? [];

    if (!fs.existsSync(worktreePath)) {
      return {
        worktree_path: worktreePath,
        available: false,
        changed_files: [],
        diff_stat: "",
        diff_excerpt: "",
        commit_sha: null,
        terminal_lines: evidenceTerminalLines(evidence),
        verification_results: verification,
        evidence_id: evidence?.evidence_id ?? null,
        tests_modified: evidence?.tests_modified === true,
      };
    }

    const status = await execGit(
      ["status", "--porcelain", "-uall"],
      worktreePath,
    ).catch(() => null);
    const changed =
      status?.exitCode === 0 ? parseChangedPaths(status.stdout) : [];

    const stat = await execGit(["diff", "--stat", "HEAD"], worktreePath).catch(
      () => null,
    );
    const patch = await execGit(["diff", "HEAD"], worktreePath).catch(
      () => null,
    );
    const head = await execGit(["rev-parse", "HEAD"], worktreePath).catch(
      () => null,
    );

    return {
      worktree_path: worktreePath,
      available: true,
      changed_files: changed,
      diff_stat: stat?.exitCode === 0 ? stat.stdout.trim() : "",
      diff_excerpt:
        patch?.exitCode === 0 ? patch.stdout.slice(0, MAX_DIFF_CHARS) : "",
      commit_sha:
        head !== null && head.exitCode === 0 && head.stdout !== ""
          ? head.stdout
          : null,
      terminal_lines: evidenceTerminalLines(evidence),
      verification_results: verification,
      evidence_id: evidence?.evidence_id ?? null,
      tests_modified: evidence?.tests_modified === true,
    };
  }
}

export interface CollectTriadInput {
  contract: SoftwareContract;
  challenge: string;
  repoRoot: string;
  sessionId?: string | undefined;
}

export interface DisputeFactDeps {
  sessions?: SessionFactSource;
  spec?: SpecFactSource;
  code?: CodeFactSource;
}

/** 抓取三方事实；任一路由调用方注入以便测试 */
export async function collectTriadFacts(
  input: CollectTriadInput,
  deps: DisputeFactDeps = {},
): Promise<TriadFacts> {
  const keywords = extractKeywords(input.challenge);
  const sessions = deps.sessions ?? new SessionFactSourceImpl(input.repoRoot);
  const spec = deps.spec ?? new SpecFactSourceImpl(input.repoRoot);
  const code = deps.code ?? new CodeFactSourceImpl(input.repoRoot);

  const prompt = sessions.collect({
    contractId: input.contract.contract_id,
    keywords,
    ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    challenge: input.challenge,
  });
  const specFact = spec.collect({ contract: input.contract, keywords });
  const codeFact = await code.collect({ contract: input.contract, keywords });

  return {
    challenge: input.challenge,
    keywords,
    prompt,
    spec: specFact,
    code: codeFact,
  };
}
