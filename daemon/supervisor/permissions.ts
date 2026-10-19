import fs from "node:fs";
import path from "node:path";

/**
 * Supervisor 运行时权限边界（TASK-S.1 / G-11b）。
 *
 * 规范 A §2.2：Supervisor「无执行授权权」——不能批准合同、修改授权、
 * 调用 Worker 工具、运行主机命令、写业务代码、设置 verdict 或触发合并。
 *
 * 本模块把该约束从「文档约定」落成运行时可执行的拦截：
 * 1. 控制面以**默认拒绝**方式暴露给 Supervisor：只有显式登记为只读的方法可调用；
 * 2. `approveContract` / `mergeContract` / `setVerdict` / `execCommand` 等特权动作
 *    一律先写 `GATEWAY_VIOLATION` 审计事件，再抛 `SupervisorPermissionDeniedError`；
 * 3. 审计事件可注入广播回调（Daemon 侧转发为 WebSocket 帧），也可独立落盘 JSONL，
 *    保证「即使调用方吞掉异常，越权尝试仍留痕」。
 */

/** 规范点名的 4 类特权动作（G-11b 正例断言集合） */
export const SUPERVISOR_PRIVILEGED_ACTIONS = [
  "approveContract",
  "mergeContract",
  "setVerdict",
  "execCommand",
] as const;

export type SupervisorPrivilegedAction =
  (typeof SUPERVISOR_PRIVILEGED_ACTIONS)[number];

/**
 * Supervisor 允许调用的只读控制面方法。
 * 新增只读能力必须先在此登记（白名单显式化），任何未登记方法默认拒绝。
 */
export const SUPERVISOR_READONLY_ACTIONS = [
  "getContract",
  "listContracts",
  "getEvidence",
  "getSession",
  "getStatus",
] as const;

export type SupervisorReadonlyAction =
  (typeof SUPERVISOR_READONLY_ACTIONS)[number];

/**
 * 越权拒绝错误码（§9.3 的 9 码体系）。
 * 常量名加 `SUPERVISOR_` 前缀避免与 `daemon/runner/command-runner` 的同值导出冲突，
 * 错误码字符串本身仍是 `E_UNAUTHORIZED_COMMAND`（上层按 code 统一判定）。
 */
export const SUPERVISOR_PERMISSION_ERROR_CODE = "E_UNAUTHORIZED_COMMAND";

/** 越权审计事件（type 对齐 IPC 帧类型 `GATEWAY_VIOLATION`） */
export interface SupervisorViolationEvent {
  type: "GATEWAY_VIOLATION";
  source: "supervisor";
  action: string;
  contract_id?: string | undefined;
  session_id?: string | undefined;
  message: string;
  occurred_at: string;
}

/** 审计出口：Daemon 侧可注入 `daemon.broadcast("GATEWAY_VIOLATION", payload)` 的包装 */
export type SupervisorAuditSink = (event: SupervisorViolationEvent) => void;

/** 帧载荷结构（与 `src/lib/ipc/frames.ts` 的 GatewayViolationPayload 结构一致） */
export interface GatewayViolationPayloadLike {
  source: string;
  action: string;
  contract_id?: string | undefined;
  message: string;
}

export class SupervisorPermissionDeniedError extends Error {
  readonly code = SUPERVISOR_PERMISSION_ERROR_CODE;
  /** 与 9 码原因码体系对齐：越权命令归属 UNAUTHORIZED_COMMAND */
  readonly reason_code = "UNAUTHORIZED_COMMAND";
  readonly action: string;
  readonly source = "supervisor";

  constructor(action: string) {
    super(
      `[${SUPERVISOR_PERMISSION_ERROR_CODE}] Supervisor has no execution authority; ` +
        `action "${action}" is denied by the control plane (G-11b)`,
    );
    this.name = "SupervisorPermissionDeniedError";
    this.action = action;
  }
}

export function isPrivilegedAction(
  action: string,
): action is SupervisorPrivilegedAction {
  return (SUPERVISOR_PRIVILEGED_ACTIONS as readonly string[]).includes(action);
}

export function isReadonlyAction(
  action: string,
): action is SupervisorReadonlyAction {
  return (SUPERVISOR_READONLY_ACTIONS as readonly string[]).includes(action);
}

export interface SupervisorControlPlaneOptions {
  /** 必填：越权尝试必须留痕，禁止「静默拒绝」 */
  audit: SupervisorAuditSink;
  contractId?: string | undefined;
  sessionId?: string | undefined;
  clock?: (() => Date) | undefined;
}

function buildViolationEvent(
  action: string,
  options: SupervisorControlPlaneOptions,
): SupervisorViolationEvent {
  const at = (options.clock ?? (() => new Date()))().toISOString();
  const reason = isPrivilegedAction(action)
    ? "privileged action is reserved for the Daemon/user approval flow"
    : "action is not in the supervisor readonly allowlist (deny-by-default)";
  return {
    type: "GATEWAY_VIOLATION",
    source: "supervisor",
    action,
    message: `Supervisor attempted "${action}" and was blocked: ${reason}`,
    occurred_at: at,
    ...(options.contractId === undefined
      ? {}
      : { contract_id: options.contractId }),
    ...(options.sessionId === undefined
      ? {}
      : { session_id: options.sessionId }),
  };
}

/**
 * 直接断言某个动作是否被允许（供不经 Proxy 的调用点复用）。
 * 先审计、后抛错：即使调用方捕获并忽略异常，越权尝试仍已留痕。
 */
export function assertSupervisorActionAllowed(
  action: string,
  options: SupervisorControlPlaneOptions,
): void {
  if (isReadonlyAction(action)) return;
  const event = buildViolationEvent(action, options);
  try {
    options.audit(event);
  } catch {
    // 审计通道故障不得让越权调用「意外成功」
  }
  throw new SupervisorPermissionDeniedError(action);
}

/**
 * 把真实控制面包裹成 Supervisor 可见的只读视图：
 * - 只读白名单方法 → 绑定原对象后透传；
 * - 特权方法与其他任何函数属性 → 审计 + 抛 `SupervisorPermissionDeniedError`；
 * - 非函数数据属性 → 原样可读（快照/常量不构成执行能力）。
 */
export function createSupervisorControlPlane<T extends object>(
  controlPlane: T,
  options: SupervisorControlPlaneOptions,
): T {
  const denial = (action: string): ((...args: unknown[]) => never) => {
    return (..._args: unknown[]): never => {
      assertSupervisorActionAllowed(action, options);
      // assertSupervisorActionAllowed 对只读动作会返回；此处不可达
      throw new SupervisorPermissionDeniedError(action);
    };
  };

  return new Proxy(controlPlane, {
    get(target, property, receiver) {
      if (typeof property !== "string") {
        return Reflect.get(target, property, receiver);
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value === "function") {
        if (isReadonlyAction(property)) {
          return value.bind(target) as unknown;
        }
        return denial(property);
      }
      return value;
    },
    set() {
      // 只读视图：任何写入尝试都视为越权
      const action = "set";
      assertSupervisorActionAllowed(action, options);
      return false;
    },
    deleteProperty() {
      assertSupervisorActionAllowed("delete", options);
      return false;
    },
  });
}

/** 转成 IPC 帧载荷（供 `daemon.broadcast("GATEWAY_VIOLATION", payload)`） */
export function toGatewayViolationPayload(
  event: SupervisorViolationEvent,
): GatewayViolationPayloadLike {
  return {
    source: event.source,
    action: event.action,
    message: event.message,
    ...(event.contract_id === undefined
      ? {}
      : { contract_id: event.contract_id }),
  };
}

export interface SupervisorViolationAuditorOptions {
  repoRoot: string;
  /** 额外出口：Daemon 广播 / 测试断言 */
  sink?: SupervisorAuditSink | undefined;
}

export interface SupervisorViolationAuditor {
  /** 直接作为 `createSupervisorControlPlane` 的 audit 出口 */
  record: SupervisorAuditSink;
  /** 读取已落盘的审计事件（测试与排障用） */
  readAll: () => SupervisorViolationEvent[];
  filePath: string;
}

/**
 * 越权审计器：追加写 `<repo>/.stagent/audit/supervisor-violations.jsonl`（0600）。
 * 追加写 + 单行 JSON 保证审计流即使中途崩溃也能保住已写入的条目。
 */
export function createSupervisorViolationAuditor(
  options: SupervisorViolationAuditorOptions,
): SupervisorViolationAuditor {
  const auditDir = path.join(
    path.resolve(options.repoRoot),
    ".stagent",
    "audit",
  );
  const filePath = path.join(auditDir, "supervisor-violations.jsonl");

  fs.mkdirSync(auditDir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(auditDir, 0o700);
  } catch {
    // 非 POSIX 平台忽略
  }

  const record: SupervisorAuditSink = (event) => {
    const fd = fs.openSync(filePath, "a", 0o600);
    try {
      fs.writeFileSync(fd, `${JSON.stringify(event)}\n`);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    try {
      fs.chmodSync(filePath, 0o600);
    } catch {
      // 同上
    }
    options.sink?.(event);
  };

  const readAll = (): SupervisorViolationEvent[] => {
    if (!fs.existsSync(filePath)) return [];
    const events: SupervisorViolationEvent[] = [];
    for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as SupervisorViolationEvent);
      } catch {
        // 单行损坏不影响其余审计条目
      }
    }
    return events;
  };

  return { record, readAll, filePath };
}
