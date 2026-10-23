import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type {
  LifecycleState,
  SoftwareContract,
} from "../../src/lib/contract.schema";
import {
  evidenceBundleSchema,
  deriveCanMerge,
  type EvidenceBundle,
} from "../../src/lib/evidence.schema";
import { ContractStore } from "./contract-store";
import { ScopedWorktreeGateway } from "../mcp/gateway";
import { CostMonitor } from "../guard/cost-monitor";
import { LoopGuard } from "../guard/loop-guard";
import { isTestPath } from "../guard/test-integrity";
import { computeWorktreeFingerprint } from "../guard/evidence-integrity";
import {
  contractLockPath,
  withContractLock,
  InvalidStateTransitionError,
} from "../core/contract-mutex";
import { killProcessTree } from "../runner/process-tree";
import { writeStateFile } from "../guard/state-store";
import {
  loadCurrentGatewayViolation,
  saveGatewayViolation,
} from "../guard/gateway-violation-store";
import {
  AiWorker,
  type WorkerModelClient,
  type WorkerRunResult,
} from "../worker/ai-worker";
import {
  RuntimeInterceptor,
  type GatewayViolation,
} from "../worker/runtime-interceptor";
import { assessCommandThreat, isRepoTrusted } from "../worker/threat-guard";
import { OpenAiWorkerClient } from "../worker/openai-client";
import { planDependencyStrategy, runIsolatedInstall } from "../deps/strategy";
import { mountDependencySymlink } from "../deps/resolver";
import {
  createTaskWorktree,
  execGit,
  getWorktreePath,
  removeTaskWorktree,
  type WorktreeInfo,
} from "../git/worktree-manager";
import {
  E_OUT_OF_SCOPE_UNTRACKED,
  UntrackedScopeViolationError,
  describeUntrackedViolations,
  enforceUntrackedScope,
  type UntrackedScopePhase,
  type UntrackedScopeReport,
} from "./untracked-scope-guard";
import {
  appendSilentContractRecord,
  intersectWithProtection,
  loadRoundState,
  protectionMode,
  requestApproval,
} from "../protection/protection-list";

/**
 * 服务端合同编排器（规范 §1 / §5.2 / §6）：
 * 审批 → PREPARING（真实 Worktree）→ EXECUTING → VERIFYING（真实命令）
 * → Evidence 生成 → AUDITED（可合并）或 PENDING_RESUME（熔断）。
 */
export interface OrchestratorOptions {
  repoRoot: string;
  /** 主工作区脏时是否已获用户确认 */
  acknowledgeDirty?: boolean;
  /** TASK-C.5：验证命令输出的逐行实时回放（内容已脱敏） */
  onTerminalLine?:
    | ((contractId: string, stream: "stdout" | "stderr", line: string) => void)
    | undefined;
  /** TASK-W.4：Gateway 运行时违规广播出口 */
  onGatewayViolation?: ((violation: GatewayViolation) => void) | undefined;
}

export interface ExecutionOutcome {
  contract: SoftwareContract;
  evidence: EvidenceBundle;
  worktree: WorktreeInfo;
}

/** 单条验证命令的执行事实（写入 Evidence 前的中间形态，TASK-W.2b 复用） */
interface VerificationResultInput {
  alias: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  passed: boolean;
}

/** TASK-D.2：审批前的准入裁决（合同 Scope × 保护清单） */
export type AdmissionDecision =
  "AUTO_APPROVED" | "AUTO_APPROVAL_FAILED" | "NEEDS_APPROVAL" | "SKIPPED";

export interface AdmissionResult {
  decision: AdmissionDecision;
  contract: SoftwareContract;
  /** 白话原因：用于卡片提示与日志，不暴露错误码 */
  reason?: string | undefined;
  /** 命中的受保护条目（无交集时为空） */
  protectedFiles: string[];
  entryNames: string[];
  /** NEEDS_APPROVAL 时的待审批卡 id */
  cardId?: string | undefined;
}

export class ContractOrchestrator {
  private readonly repoRoot: string;
  private readonly store: ContractStore;
  private readonly acknowledgeDirty: boolean;
  private readonly onTerminalLine?:
    | ((contractId: string, stream: "stdout" | "stderr", line: string) => void)
    | undefined;
  private readonly onGatewayViolation?:
    ((violation: GatewayViolation) => void) | undefined;
  /** 在途执行（execute/runWorker）的中止控制器：abort 端点凭此强杀子进程树 */
  private readonly abortControllers = new Map<string, AbortController>();
  /** 已请求中止但执行尚未开始的合同：注册控制器时立即进入已中止态 */
  private readonly abortRequested = new Set<string>();

  constructor(options: OrchestratorOptions) {
    this.repoRoot = path.resolve(options.repoRoot);
    this.store = new ContractStore(this.repoRoot);
    this.acknowledgeDirty = options.acknowledgeDirty ?? false;
    this.onTerminalLine = options.onTerminalLine;
    this.onGatewayViolation = options.onGatewayViolation;
  }

  getStore(): ContractStore {
    return this.store;
  }

  /**
   * 用户审批：PENDING_APPROVAL/PENDING_REVIEW → APPROVED → PREPARING → EXECUTING。
   * 全程持有合同排他锁：并发的第二次审批会在锁内读到已推进的状态，
   * 抛 E_INVALID_STATE_TRANSITION，杜绝重复建 Worktree / 重复分支。
   */
  async approve(
    contractId: string,
    reviewer: string,
  ): Promise<SoftwareContract> {
    return withContractLock(
      contractLockPath(this.repoRoot, contractId),
      async () => {
        const current = this.store.get(contractId);
        if (!current) throw new Error(`Contract not found: ${contractId}`);
        if (current.lifecycle_state !== "PENDING_APPROVAL") {
          throw new InvalidStateTransitionError(
            current.lifecycle_state,
            ["PENDING_APPROVAL"],
            "approve",
          );
        }

        const approvedAt = new Date().toISOString();
        // 先落审批事实，再进入准备阶段（§9.1.1：避免只更新其中一个字段）
        // approved_revision 绑定被批准的合同版本：任何后续 Scope/预算变更都会
        // 递增 contract_revision，从而让本次审批失效（防 TOCTOU，§9.1）
        this.store.transition({
          contractId,
          lifecycleState: "PREPARING",
          approvalStatus: "APPROVED",
          approvedBy: reviewer,
          approvedAt,
          approvedRevision: current.contract_revision,
        });

        try {
          await createTaskWorktree({
            repoRoot: this.repoRoot,
            contractId,
            baseBranch: current.authorization.git.base_branch,
            acknowledgeDirty: this.acknowledgeDirty,
          });
          // 依赖复用/隔离决策（ADR-002）
          await this.prepareDependencies(contractId);
          return this.store.transition({
            contractId,
            lifecycleState: "EXECUTING",
          });
        } catch (err) {
          // 准备中断：回退等待重新审批，并留存原因
          await this.writeEvidence(current, {
            status: "BLOCKED",
            reasonCode: "PREPARATION_INTERRUPTED",
            summary: `Preparation failed: ${(err as Error).message}`,
            verificationResults: [],
            scopePassed: false,
            forbiddenViolations: [],
            modifiedFiles: [],
          });
          return this.store.transition({
            contractId,
            lifecycleState: "PENDING_APPROVAL",
            approvalStatus: "PENDING_REVIEW",
          });
        }
      },
    );
  }

  /**
   * TASK-D.2 核心目标 1：审批准入裁决（合同 Scope × 全局保护清单）。
   *
   * - **无交集**：写 `.stagent/silent-contracts.jsonl` 备案后直接自动批准并推进到
   *   `PREPARING → EXECUTING`，前端零弹窗、用户零点击；
   * - **有交集**：停在 `PENDING_APPROVAL`，登记一张白话待审批卡，等待用户显式决策；
   * - **失败关闭**：清单读取/规则比对异常一律按「有冲突」阻断，绝不静默放行；
   * - **幂等**：合同不处于待审批态时返回 `SKIPPED`，重复调用不会重建 Worktree。
   */
  async admit(contractId: string): Promise<AdmissionResult> {
    const current = this.store.get(contractId);
    if (!current) throw new Error(`Contract not found: ${contractId}`);

    if (
      current.lifecycle_state !== "PENDING_APPROVAL" ||
      current.approval.status !== "PENDING_REVIEW"
    ) {
      return {
        decision: "SKIPPED",
        contract: current,
        reason: `合同不处于待审批态（${current.lifecycle_state} / ${current.approval.status}）`,
        protectedFiles: [],
        entryNames: [],
      };
    }

    const scope = current.authorization.file_system_scope.writable_paths;
    const verdict = intersectWithProtection(this.repoRoot, scope);

    // 失败关闭：判定过程出错 → 一律视为有冲突，直接阻断（不自动批准、不建 Worktree）
    if (verdict.error) {
      appendSilentContractRecord(this.repoRoot, {
        kind: "contract_admission_fail_closed",
        contract_id: contractId,
        error: verdict.error,
        scope,
      });
      return {
        decision: "NEEDS_APPROVAL",
        contract: current,
        reason: `保护清单判定失败，已按「有冲突」阻断：${verdict.error}`,
        protectedFiles: verdict.files.length > 0 ? verdict.files : scope,
        entryNames: verdict.entryNames,
      };
    }

    const state = loadRoundState(this.repoRoot);
    const approvedThisRound = verdict.files.filter((f) =>
      state.approvedFiles.includes(f),
    );
    const deniedThisRound = verdict.files.filter((f) =>
      state.deniedFiles.includes(f),
    );
    const outstanding = verdict.files.filter(
      (f) => !state.approvedFiles.includes(f) && !state.deniedFiles.includes(f),
    );
    // 只有「每一个交集文件都已在本轮被同意」才允许自动批准；
    // 任一被拒绝即阻断（拒绝优先于同意，绝不被 approvedFiles 掩盖）。
    const allApproved =
      verdict.files.length > 0 &&
      approvedThisRound.length === verdict.files.length;

    // 无交集，或交集文件已全部在本轮被用户明确同意 → 自动批准
    if (
      verdict.files.length === 0 ||
      (allApproved && deniedThisRound.length === 0)
    ) {
      appendSilentContractRecord(this.repoRoot, {
        kind: "contract_auto_approved",
        contract_id: contractId,
        mode: verdict.hit
          ? "PROTECTED_AUTHORIZED"
          : protectionMode(this.repoRoot),
        scope,
        protected_files: verdict.files,
        approved_this_round: approvedThisRound,
      });
      try {
        const approved = await this.approve(contractId, "stagent-auto");
        return {
          decision: "AUTO_APPROVED",
          contract: approved,
          reason: verdict.hit
            ? "合同范围已在本轮获得授权，自动批准"
            : "合同范围未触碰保护清单，自动批准",
          protectedFiles: verdict.files,
          entryNames: verdict.entryNames,
        };
      } catch (err) {
        // 并发下第二次调用会撞上状态机（已推进到 PREPARING/EXECUTING）：
        // 这不是失败，按 SKIPPED 处理，避免把正常并发报成错误。
        if (err instanceof InvalidStateTransitionError) {
          return {
            decision: "SKIPPED",
            contract: this.store.get(contractId) ?? current,
            reason: "合同已被另一次准入推进，跳过重复批准",
            protectedFiles: verdict.files,
            entryNames: verdict.entryNames,
          };
        }
        return {
          decision: "AUTO_APPROVAL_FAILED",
          contract: this.store.get(contractId) ?? current,
          reason: `自动批准未完成：${(err as Error).message}`,
          protectedFiles: verdict.files,
          entryNames: verdict.entryNames,
        };
      }
    }

    // 本轮已拒绝过同一受保护文件：直接阻断，不重复弹卡
    if (deniedThisRound.length > 0) {
      return {
        decision: "NEEDS_APPROVAL",
        contract: current,
        reason: `你本轮已拒绝修改受保护文件：${deniedThisRound.join("、")}`,
        protectedFiles: verdict.files,
        entryNames: verdict.entryNames,
      };
    }

    // 有交集且未授权：登记一张白话卡片（列出本轮全部受保护文件），等待用户显式决策
    const { card } = requestApproval(
      this.repoRoot,
      outstanding,
      verdict.entryNames,
    );
    appendSilentContractRecord(this.repoRoot, {
      kind: "contract_pending_user",
      contract_id: contractId,
      card_id: card.id,
      protected_files: outstanding,
      entry_names: verdict.entryNames,
    });
    return {
      decision: "NEEDS_APPROVAL",
      contract: current,
      reason: "合同范围触碰保护清单，需要你确认后才会开工",
      protectedFiles: outstanding,
      entryNames: verdict.entryNames,
      cardId: card.id,
    };
  }

  /**
   * 断点续跑（Chaos 场景 1）：崩溃恢复把 EXECUTING/VERIFYING 挂起到 PENDING_RESUME 后，
   * 必须由用户显式确认才能回到 EXECUTING；Worktree 已丢失则拒绝续跑。
   * 没有这个出口，PENDING_RESUME 就是事实上的永久卡死态。
   */
  async resume(contractId: string): Promise<SoftwareContract> {
    return withContractLock(
      contractLockPath(this.repoRoot, contractId),
      async () => {
        const current = this.store.get(contractId);
        if (!current) throw new Error(`Contract not found: ${contractId}`);
        if (current.lifecycle_state !== "PENDING_RESUME") {
          throw new InvalidStateTransitionError(
            current.lifecycle_state,
            ["PENDING_RESUME"],
            "resume",
          );
        }

        const worktreePath = getWorktreePath(this.repoRoot, contractId);
        if (!fs.existsSync(worktreePath)) {
          throw new Error(
            `Cannot resume ${contractId}: worktree lost at ${worktreePath}`,
          );
        }
        // Worktree 必须仍然是健康的 Git 工作区（崩溃可能留下 index.lock / 断头）
        const head = await execGit(["rev-parse", "HEAD"], worktreePath);
        if (head.exitCode !== 0) {
          throw new Error(
            `Cannot resume ${contractId}: worktree is not a healthy git workspace (${head.stderr || head.stdout})`,
          );
        }

        return this.store.transition({
          contractId,
          lifecycleState: "EXECUTING",
        });
      },
    );
  }

  /**
   * 用户主动中止/驳回（终态 ABORTED）：
   * 1. 不持锁先触发 AbortSignal —— 在途验证命令整树 SIGTERM→3s→SIGKILL 强杀，
   *    后续命令被网关 E_TASK_ABORTED 拒绝，execute 循环立即收尾并释放合同锁；
   * 2. 持锁后合规流转：待审批态走驳回语义（REJECTED），已批准任务保留 APPROVED
   *    （§9.1.1 允许 ABORTED × REJECTED/APPROVED 两种组合）；
   * 3. 清理 Worktree 与任务分支，终态不留现场。
   */
  async abort(
    contractId: string,
    options: { reviewer?: string; reason?: string } = {},
  ): Promise<SoftwareContract> {
    const reviewer = options.reviewer ?? "local-user";
    this.abortRequested.add(contractId);
    this.abortControllers.get(contractId)?.abort();
    try {
      return await withContractLock(
        contractLockPath(this.repoRoot, contractId),
        async () => {
          const current = this.store.get(contractId);
          if (!current) throw new Error(`Contract not found: ${contractId}`);
          const abortable: LifecycleState[] = [
            "DRAFT",
            "PENDING_APPROVAL",
            "PREPARING",
            "EXECUTING",
            "VERIFYING",
            "PENDING_RESUME",
            "AUDITED",
          ];
          if (!abortable.includes(current.lifecycle_state)) {
            throw new InvalidStateTransitionError(
              current.lifecycle_state,
              abortable,
              "abort",
            );
          }

          const worktreePath = getWorktreePath(this.repoRoot, contractId);
          if (fs.existsSync(worktreePath)) {
            await removeTaskWorktree({
              repoRoot: this.repoRoot,
              contractId,
              force: true,
              deleteBranch: true,
            });
          }

          const rejected = current.approval.status !== "APPROVED";
          return this.store.transition({
            contractId,
            lifecycleState: "ABORTED",
            ...(rejected ? { approvalStatus: "REJECTED" as const } : {}),
            rejectionReason: options.reason ?? `Aborted by ${reviewer}`,
          });
        },
      );
    } finally {
      this.abortRequested.delete(contractId);
    }
  }

  /** 注册本次执行的中止控制器；若 abort 已先行到达则直接以中止态注册 */
  private beginAbortable(contractId: string): AbortSignal {
    const controller = new AbortController();
    if (this.abortRequested.has(contractId)) controller.abort();
    this.abortControllers.set(contractId, controller);
    return controller.signal;
  }

  private endAbortable(contractId: string): void {
    this.abortControllers.delete(contractId);
  }

  /**
   * 执行合同验证命令并生成 Evidence。
   * 合同排他锁 + 锁内重读状态：并发的第二次 execute 会看到 VERIFYING/AUDITED，
   * 抛 E_INVALID_STATE_TRANSITION，不会产生两份 Evidence 或重复提交。
   */
  async execute(contractId: string): Promise<ExecutionOutcome> {
    return withContractLock(contractLockPath(this.repoRoot, contractId), () =>
      this.executeInternal(contractId),
    );
  }

  private async executeInternal(contractId: string): Promise<ExecutionOutcome> {
    const signal = this.beginAbortable(contractId);
    try {
      return await this.executeWithSignal(contractId, signal);
    } finally {
      this.endAbortable(contractId);
    }
  }

  private async executeWithSignal(
    contractId: string,
    signal: AbortSignal,
  ): Promise<ExecutionOutcome> {
    const current = this.store.get(contractId);
    if (!current) throw new Error(`Contract not found: ${contractId}`);
    if (current.lifecycle_state !== "EXECUTING") {
      throw new InvalidStateTransitionError(
        current.lifecycle_state,
        ["EXECUTING"],
        "execute",
      );
    }

    const { gateway, costMonitor, loopGuard, worktreePath, interceptor } =
      this.buildRuntime(current, signal);

    this.store.transition({ contractId, lifecycleState: "VERIFYING" });

    // 测试完整性留痕：提交前捕获 Worktree 改动（覆盖外部编辑器等旁路写入）
    // -uall：未跟踪目录不折叠，否则 tests/ 会被折叠成 "tests" 而识别不出测试文件
    const preCommitStatus = await execGit(
      ["status", "--porcelain", "-uall"],
      worktreePath,
    );

    // TASK-W.2b：执行前未跟踪文件守卫。
    // 必须早于 commitWorktree——`git add -A` 一旦把越界文件做进提交，
    // 它们就变成已跟踪文件，`git diff --name-only` 再也区分不出来。
    await this.assertUntrackedScope({
      contract: current,
      worktreePath,
      phase: "PRE_EXECUTION",
      costMonitor,
    });

    // 规范 §5.2：Evidence 必须对应真实任务提交；合并前将 Worktree 改动固化到任务分支
    await this.commitWorktree(worktreePath, contractId);

    const verificationResults: VerificationResultInput[] = [];
    const portConflictAliases: string[] = [];
    const threatBlockedAliases: string[] = [];
    // W.4：执行前信任校验；真实 Worktree 带 .git 文件，视为已信任仓库
    const repoTrusted = isRepoTrusted(worktreePath);

    for (const command of current.verification_spec.commands) {
      // W.4：运行时复检降级后，内部验证调用不再豁免，直接跳过且不产生子进程
      if (interceptor.isStopped() || !interceptor.canProduceEvidence()) {
        threatBlockedAliases.push(command.alias);
        verificationResults.push({
          alias: command.alias,
          exitCode: 1,
          stdout: "",
          stderr: "运行时复检已降级为 UNCONTROLLED_EXTERNAL，受控执行停止",
          durationMs: 0,
          passed: false,
        });
        continue;
      }

      // W.4：威胁守卫必须在创建子进程之前；拒绝即跳过 gateway，不产生任何进程
      const threat = assessCommandThreat({
        executable: command.executable,
        args: command.args,
        worktreeRoot: worktreePath,
        repoTrusted,
      });
      if (!threat.allowed) {
        threatBlockedAliases.push(command.alias);
        verificationResults.push({
          alias: command.alias,
          exitCode: 1,
          stdout: "",
          stderr: threat.reason,
          durationMs: 0,
          passed: false,
        });
        continue;
      }

      const res = await gateway.callTool(
        "stagent_exec_command",
        {
          executable: command.executable,
          args: command.args,
        },
        { internal: true },
      );
      const data = (res.data ?? {}) as {
        exitCode?: number;
        stdout?: string;
        stderr?: string;
        durationMs?: number;
      };
      if (res.error?.code === "E_PORT_CONFLICT") {
        portConflictAliases.push(command.alias);
      }
      verificationResults.push({
        alias: command.alias,
        exitCode: data.exitCode ?? 1,
        stdout: data.stdout ?? "",
        stderr: data.stderr ?? (res.error?.message || ""),
        durationMs: data.durationMs ?? 0,
        passed: !res.isError,
      });
    }

    // 验证命令也可能在 Worktree 内写文件（commit 之后），再次捕获并取并集
    const postVerifyStatus = await execGit(
      ["status", "--porcelain", "-uall"],
      worktreePath,
    );

    // TASK-W.2b：验收前再查一次未跟踪文件。
    // 验证命令（测试脚本、构建脚本）会绕过网关直接落盘，这是网关拦不到的
    // 第二条通道；命中越界同样阻断，绝不产出 PASSED 证据。
    const postVerifyScope = await this.assertUntrackedScope({
      contract: current,
      worktreePath,
      phase: "POST_VERIFICATION",
      costMonitor,
      verificationResults,
    });

    const worktreeChanged = [
      ...parsePorcelainPaths(preCommitStatus.stdout),
      ...parsePorcelainPaths(postVerifyStatus.stdout),
    ];

    const modifiedFiles = [...gateway.getModifiedFiles()];
    const testsModified =
      gateway.wasTestsModified() || worktreeChanged.some(isTestPath);
    const allPassed = verificationResults.every((r) => r.passed);
    const tripped = loopGuard.isTripped() || costMonitor.isTripped();
    // 只有「除端口冲突外没有别的失败」时，才把整轮归因为端口冲突；
    // 若同时存在断言失败，仍按 FAILED/UNSAFE_EXECUTION 处理。
    const failedNonPort = verificationResults.some(
      (r) => !r.passed && !portConflictAliases.includes(r.alias),
    );
    const portConflict = portConflictAliases.length > 0 && !failedNonPort;
    const threatBlocked = threatBlockedAliases.length > 0;
    const interceptorBlocked =
      interceptor.isStopped() ||
      !interceptor.canProduceEvidence() ||
      loadCurrentGatewayViolation(
        this.repoRoot,
        current.contract_id,
        current.contract_revision,
      ) !== null;

    // 端口冲突属于环境问题，不按断言失败处理：BLOCKED + E_PORT_CONFLICT，
    // 由用户清理端口后重跑，而不是让 Worker 误以为用例写错去改代码。
    const status = interceptorBlocked
      ? "BLOCKED"
      : threatBlocked
        ? "BLOCKED"
        : portConflict
          ? "BLOCKED"
          : allPassed
            ? "PASSED"
            : tripped
              ? "BLOCKED"
              : "FAILED";
    const reasonCode = interceptorBlocked
      ? ("UNSAFE_EXECUTION" as const)
      : threatBlocked
        ? ("UNSAFE_EXECUTION" as const)
        : portConflict
          ? ("UNSAFE_EXECUTION" as const)
          : allPassed
            ? undefined
            : costMonitor.isTripped()
              ? ("BUDGET_EXHAUSTED" as const)
              : loopGuard.isTripped()
                ? ("VERIFICATION_RETRY_LIMIT" as const)
                : ("UNSAFE_EXECUTION" as const);

    const evidence = await this.writeEvidence(
      current,
      {
        status,
        ...(reasonCode === undefined ? {} : { reasonCode }),
        workerControlMode: interceptorBlocked
          ? "UNCONTROLLED_EXTERNAL"
          : current.worker_spec.control_mode,
        summary: interceptorBlocked
          ? "运行时复检发现 Adapter 能力漂移或越权通道，已降级为 UNCONTROLLED_EXTERNAL 并停止受控执行"
          : threatBlocked
            ? `验证被威胁守卫阻断（${threatBlockedAliases.join(", ")}）：命令可能在受控边界之外，已拒绝执行且未产生子进程`
            : portConflict
              ? `验证被端口占用阻断（${portConflictAliases.join(", ")}）：这是环境冲突，不是断言失败。请停止占用端口的进程后重试`
              : allPassed
                ? `All ${verificationResults.length} verification command(s) passed`
                : `Verification failed (${verificationResults.filter((r) => !r.passed).length} command(s))`,
        verificationResults,
        // 由 TASK-W.2b 的未跟踪文件审计派生，不再写死 true
        scopePassed: postVerifyScope.passed,
        forbiddenViolations: [],
        modifiedFiles,
        testsModified,
      },
      costMonitor,
      worktreePath,
    );

    const nextState = allPassed
      ? "AUDITED"
      : tripped
        ? "PENDING_RESUME"
        : "EXECUTING";

    const contract = this.store.transition({
      contractId,
      lifecycleState: nextState,
    });
    const worktree = await this.readWorktreeInfo(contractId, worktreePath);

    return { contract, evidence, worktree };
  }

  /**
   * 运行受控 AI Worker：生成代码改动并经网关写入 Worktree。
   * 失败（越权/预算）时整批拒绝；预算耗尽进入 PENDING_RESUME。
   */
  async runWorker(
    contractId: string,
    options: { modelClient?: WorkerModelClient } = {},
  ): Promise<WorkerRunResult> {
    return withContractLock(contractLockPath(this.repoRoot, contractId), () =>
      this.runWorkerInternal(contractId, options),
    );
  }

  private async runWorkerInternal(
    contractId: string,
    options: { modelClient?: WorkerModelClient } = {},
  ): Promise<WorkerRunResult> {
    const signal = this.beginAbortable(contractId);
    try {
      const current = this.store.get(contractId);
      if (!current) throw new Error(`Contract not found: ${contractId}`);
      if (current.lifecycle_state !== "EXECUTING") {
        throw new InvalidStateTransitionError(
          current.lifecycle_state,
          ["EXECUTING"],
          "run-worker",
        );
      }

      const { gateway, costMonitor } = this.buildRuntime(current, signal);
      const modelClient = options.modelClient ?? new OpenAiWorkerClient();
      const worker = new AiWorker({ gateway, costMonitor, modelClient });

      try {
        return await worker.run();
      } catch (err) {
        if (costMonitor.isTripped()) {
          this.store.transition({
            contractId,
            lifecycleState: "PENDING_RESUME",
          });
          await this.writeEvidence(
            current,
            {
              status: "BLOCKED",
              reasonCode: "BUDGET_EXHAUSTED",
              summary: `Worker aborted: ${(err as Error).message}`,
              verificationResults: [],
              scopePassed: false,
              forbiddenViolations: [],
              modifiedFiles: [...gateway.getModifiedFiles()],
              testsModified: gateway.wasTestsModified(),
            },
            costMonitor,
            gateway.getWorktreeRoot(),
          );
        }
        throw err;
      }
    } finally {
      this.endAbortable(contractId);
    }
  }

  /** 将 Worktree 内全部改动提交到任务分支（无改动时静默跳过） */
  private async commitWorktree(
    worktreePath: string,
    contractId: string,
  ): Promise<void> {
    const status = await execGit(["status", "--porcelain"], worktreePath);
    if (status.exitCode !== 0 || status.stdout.trim().length === 0) return;

    await execGit(["add", "-A"], worktreePath);
    const commit = await execGit(
      ["commit", "-m", `chore(stagent): contract ${contractId} changes`],
      worktreePath,
    );
    if (commit.exitCode !== 0) {
      throw new Error(
        `Failed to commit worktree changes: ${commit.stderr || commit.stdout}`,
      );
    }
  }

  /**
   * 依赖准备（ADR-002）：
   * - 锁文件一致 + 写保护可证明 → 建立只读共享 symlink 视图
   * - 锁文件不一致（需变更依赖）→ 等待用户授权，不自动安装
   * - 写保护不可证明 → 在 Worktree 内隔离安装（不污染主工程）
   */
  private async prepareDependencies(contractId: string): Promise<void> {
    const worktreePath = getWorktreePath(this.repoRoot, contractId);
    const plan = await planDependencyStrategy({
      repoRoot: this.repoRoot,
      worktreePath,
    });

    if (plan.strategy === "SHARED_SYMLINK") {
      await mountDependencySymlink({
        repoRoot: this.repoRoot,
        worktreePath,
      });
      return;
    }

    // 需要变更依赖时必须由用户显式授权，先不安装
    if (plan.requiresAuthorization || !plan.lockfile.name) return;

    await runIsolatedInstall({
      worktreePath,
      runner: (command, args, cwd) =>
        new Promise((resolve) => {
          // 独立进程组：包管理器的后代进程（postinstall、node-gyp 等）
          // 必须整树回收，否则会残留占用 Worktree 文件锁
          const child = spawn(command, args, {
            cwd,
            stdio: "ignore",
            env: { ...process.env, CI: "true" },
            detached: true,
          });
          const timer = setTimeout(() => {
            void killProcessTree(child.pid ?? 0, { graceMs: 1_000 }).finally(
              () => resolve({ code: 124 }),
            );
          }, 300_000);
          child.on("close", (code) => {
            clearTimeout(timer);
            resolve({ code: code ?? 1 });
          });
          child.on("error", () => {
            clearTimeout(timer);
            resolve({ code: 1 });
          });
        }),
    });
  }

  private buildRuntime(
    contract: SoftwareContract,
    signal?: AbortSignal,
  ): {
    gateway: ScopedWorktreeGateway;
    costMonitor: CostMonitor;
    loopGuard: LoopGuard;
    worktreePath: string;
    interceptor: RuntimeInterceptor;
  } {
    const worktreePath = getWorktreePath(this.repoRoot, contract.contract_id);
    const guardDir = path.join(this.repoRoot, ".stagent", "guard");
    const costMonitor = new CostMonitor({
      maxCostMinorUnits:
        contract.authorization.cost_limits.max_cost_minor_units,
      currency: contract.authorization.cost_limits.currency,
      ...(contract.authorization.cost_limits.max_input_tokens === undefined
        ? {}
        : {
            maxTotalTokens: contract.authorization.cost_limits.max_input_tokens,
          }),
      statePath: path.join(guardDir, "cost.json"),
    });
    const loopGuard = new LoopGuard({
      maxRetries: contract.authorization.budget_limits.max_verification_retries,
      statePath: path.join(guardDir, "loop.json"),
    });
    const interceptor = new RuntimeInterceptor({
      snapshot: {
        adapter_id: contract.worker_spec.adapter_id,
        control_mode: contract.worker_spec.control_mode,
        tool_interception_supported: true,
        filesystem_permissions: "GATEWAY_ONLY",
        command_permissions: "WHITELIST_ONLY",
        config_fingerprint: `${contract.schema_version}:${contract.contract_revision}:${contract.worker_spec.adapter_id}`,
      },
      worktreeRoot: worktreePath,
      allowedAliases: contract.verification_spec.commands.map((c) => c.alias),
      onDowngrade: (violation) => {
        // 按合同隔离落盘；revision 变化后旧记录自动失效
        saveGatewayViolation(
          this.repoRoot,
          contract.contract_id,
          contract.contract_revision,
          violation,
        );
        this.onGatewayViolation?.(violation);
      },
    });
    const gateway = new ScopedWorktreeGateway(worktreePath, contract, {
      costMonitor,
      loopGuard,
      runtimeInterceptor: interceptor,
      requireRepoTrust: true,
      ...(signal === undefined ? {} : { signal }),
      ...(this.onTerminalLine === undefined
        ? {}
        : {
            onTerminalLine: (stream, line) =>
              this.onTerminalLine?.(contract.contract_id, stream, line),
          }),
    });
    return { gateway, costMonitor, loopGuard, worktreePath, interceptor };
  }

  private async readWorktreeInfo(
    contractId: string,
    worktreePath: string,
  ): Promise<WorktreeInfo> {
    return {
      contractId,
      worktreePath,
      branch: `task/${contractId}`,
      baseBranch: "main",
      createdAt: new Date().toISOString(),
      warnings: [],
    };
  }

  /**
   * TASK-W.2b：未跟踪文件 Scope 守卫。
   *
   * 命中越界时的处置顺序（三者缺一不可）：
   * 1. 先写 BLOCKED 证据——留下可追溯的 `scope_audit` 与违规清单，
   *    否则「阻断」只是一次异常，事后无法解释为什么没合入；
   * 2. 合同回退 `EXECUTING`——保留 Worktree 现场供用户清理或升版重批，
   *    不把合同钉死在 `VERIFYING`（那是死锁，见 §6.4 自愈目录）；
   * 3. 抛 `E_OUT_OF_SCOPE_UNTRACKED`——调用方据此终止本轮，不再产出 PASSED。
   *
   * 未抛错即代表本轮未跟踪文件全部落在合同授权内。
   */
  private async assertUntrackedScope(options: {
    contract: SoftwareContract;
    worktreePath: string;
    phase: UntrackedScopePhase;
    costMonitor?: CostMonitor | undefined;
    verificationResults?: VerificationResultInput[] | undefined;
  }): Promise<UntrackedScopeReport> {
    const report = await enforceUntrackedScope({
      worktreePath: options.worktreePath,
      scope: options.contract.authorization.file_system_scope,
      phase: options.phase,
    });
    if (report.passed) return report;

    // 复用 forbidden_violations 通道承载违规清单：它是证据包里唯一
    // 既能让 deriveCanMerge 归零、又能逐条追溯的字符串数组。
    const violations = report.violations.map((v) => `untracked:${v.path}`);
    await this.writeEvidence(
      options.contract,
      {
        status: "BLOCKED",
        reasonCode: "SCOPE_VIOLATION",
        summary: `[${E_OUT_OF_SCOPE_UNTRACKED}] ${describeUntrackedViolations(report)}`,
        verificationResults: options.verificationResults ?? [],
        scopePassed: false,
        forbiddenViolations: violations,
        modifiedFiles: report.violations.map((v) => v.path),
      },
      options.costMonitor,
      options.worktreePath,
    );

    this.store.transition({
      contractId: options.contract.contract_id,
      lifecycleState: "EXECUTING",
    });

    throw new UntrackedScopeViolationError(report);
  }

  private async writeEvidence(
    contract: SoftwareContract,
    input: {
      status: EvidenceBundle["verdict"]["status"];
      reasonCode?: EvidenceBundle["verdict"]["reason_code"];
      summary: string;
      verificationResults: VerificationResultInput[];
      scopePassed: boolean;
      forbiddenViolations: string[];
      modifiedFiles: string[];
      /** 本任务是否修改过测试文件（写入 Evidence 供核销人预警复核） */
      testsModified?: boolean;
      /** TASK-W.4：运行时降级后 Evidence 记录实际控制模式 */
      workerControlMode?: "GATEWAY_ENFORCED" | "UNCONTROLLED_EXTERNAL";
    },
    costMonitor?: CostMonitor,
    worktreePath?: string,
  ): Promise<EvidenceBundle> {
    const evidenceId = `evi_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const totals = costMonitor?.getTotals();
    const headSha = worktreePath
      ? this.syncGit(worktreePath, ["rev-parse", "HEAD"]) || "unknown"
      : "unknown";
    // 防篡改指纹：HEAD + porcelain 状态 + 变更文件内容哈希。
    // 合并前会重算比对；用户在 Evidence 生成后偷改 Worktree 必然导致指纹不符。
    const fingerprint = worktreePath
      ? await computeWorktreeFingerprint(worktreePath)
      : createHash("sha256").update("no-worktree").digest("hex");
    const patch = worktreePath
      ? this.syncGit(worktreePath, ["diff", "HEAD"]) || ""
      : "";
    const diffStat = worktreePath
      ? this.syncGit(worktreePath, ["diff", "--stat", "HEAD"]) || ""
      : "";

    const bundle: EvidenceBundle = {
      evidence_id: evidenceId,
      contract_id: contract.contract_id,
      generated_at: new Date().toISOString(),
      worker_control_mode:
        input.workerControlMode ?? contract.worker_spec.control_mode,
      usage:
        totals && totals.totalTokens > 0
          ? {
              input_tokens: totals.inputTokens,
              output_tokens: totals.outputTokens,
              currency: totals.currency,
              pricing_version:
                contract.authorization.cost_limits.pricing_version,
              accounting_mode: "ESTIMATED",
              estimated_cost_minor_units: totals.totalCostMinorUnits,
              limit_reached: totals.tripped,
              cumulative_cost_minor_units: totals.totalCostMinorUnits,
            }
          : {
              currency: contract.authorization.cost_limits.currency,
              pricing_version:
                contract.authorization.cost_limits.pricing_version,
              accounting_mode: "UNAVAILABLE",
              limit_reached: costMonitor?.isTripped() ?? false,
            },
      worktree_snapshot: {
        head_sha: headSha,
        snapshot_fingerprint: fingerprint,
        captured_at: new Date().toISOString(),
      },
      verdict: {
        status: input.status,
        // §9.2：can_merge 必须等于完整合并门禁的派生结果，统一走 deriveCanMerge
        can_merge: deriveCanMerge({
          status: input.status,
          scopePassed: input.scopePassed,
          budgetExhausted: costMonitor?.isTripped() ?? false,
          forbiddenViolationCount: input.forbiddenViolations.length,
        }),
        summary: input.summary,
        ...(input.reasonCode === undefined
          ? {}
          : { reason_code: input.reasonCode }),
        verification_retry_count: input.verificationResults.filter(
          (r) => !r.passed,
        ).length,
      },
      scope_audit: {
        passed: input.scopePassed,
        files_changed: input.modifiedFiles.map((p) => ({
          path: p,
          additions: 0,
          deletions: 0,
          binary: false,
        })),
        forbidden_violations: input.forbiddenViolations,
        budget_exhausted: costMonitor?.isTripped() ?? false,
      },
      verification_results: input.verificationResults
        .slice(-MAX_EVIDENCE_VERIFICATION_RESULTS)
        .map((r) => ({
          command_alias: r.alias,
          exit_code: r.exitCode,
          stdout_tail: r.stdout.slice(-MAX_EVIDENCE_TAIL_CHARS),
          stderr_tail: r.stderr.slice(-MAX_EVIDENCE_TAIL_CHARS),
          duration_ms: r.durationMs,
          passed: r.passed,
        })),
      tests_modified: input.testsModified ?? false,
      git_info: {
        base_commit_sha:
          this.syncGit(this.repoRoot, [
            "rev-parse",
            contract.authorization.git.base_branch,
          ]) || "unknown",
        task_commit_sha: headSha,
        diff_stat: diffStat,
        patch_fingerprint: createHash("sha256").update(patch).digest("hex"),
      },
    };

    const validated = evidenceBundleSchema.parse(clampEvidenceSize(bundle));
    const evidenceDir = path.join(this.repoRoot, ".stagent", "evidence");
    fs.mkdirSync(evidenceDir, { recursive: true });
    writeStateFile(
      path.join(
        evidenceDir,
        `${contract.contract_id}-${validated.evidence_id}.json`,
      ),
      validated,
    );
    return validated;
  }

  private syncGit(cwd: string, args: string[]): string | null {
    try {
      return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
    } catch {
      return null;
    }
  }
}

/** 单条验证命令在 Evidence 中保留的日志尾巴字符数 */
export const MAX_EVIDENCE_TAIL_CHARS = 2_000;
/** Evidence 最多保留的验证命令条数（防止狂暴命令把日志灌进存证） */
export const MAX_EVIDENCE_VERIFICATION_RESULTS = 20;
/** Evidence JSON 硬上限：超过则逐级收缩日志尾巴，绝不把几十兆文本塞进存证 */
export const MAX_EVIDENCE_JSON_BYTES = 512 * 1024;

/** 收缩 Evidence 体积直至低于硬上限（保底 200 字符尾巴） */
function clampEvidenceSize(bundle: EvidenceBundle): EvidenceBundle {
  const sizeOf = (b: EvidenceBundle): number =>
    Buffer.byteLength(JSON.stringify(b), "utf-8");

  let tail = MAX_EVIDENCE_TAIL_CHARS;
  let current = bundle;
  while (sizeOf(current) > MAX_EVIDENCE_JSON_BYTES && tail > 200) {
    tail = Math.max(200, Math.floor(tail / 2));
    current = {
      ...current,
      verification_results: current.verification_results.map((r) => ({
        ...r,
        stdout_tail: r.stdout_tail.slice(-tail),
        stderr_tail: r.stderr_tail.slice(-tail),
      })),
    };
  }
  return current;
}

/** 解析 git status --porcelain 输出为相对路径列表（含重命名目标路径） */
function parsePorcelainPaths(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      let p = line.slice(3);
      const arrow = p.indexOf(" -> ");
      if (arrow >= 0) p = p.slice(arrow + 4);
      return p.replace(/^"|"$/g, "").replace(/\/$/, "");
    })
    .filter((p) => p !== "");
}
